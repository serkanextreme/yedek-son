"""Sertex — Admin router (user management, quota, stats).

Extracted from server.py (Faz 9 refactor). Groups all admin-scoped
endpoints together: `/admin/users*`, `/admin/companies`, `/admin/system-quota`,
`/stats/summary`. Also holds the shared BaseModel schemas for admin
mutations.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, Optional
import logging
import secrets
import string
import uuid

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field

from permissions import (
    normalize_role,
    get_or_create_company,
    get_user_company_ids,
    is_super_admin,
    is_privileged,
    acting_role,
    get_admin_caps,
    admin_effective_company_ids,
    _regex_escape,
)
from auth import require_super_admin, require_owner

logger = logging.getLogger(__name__)


# Faz 9 CP4.34 — Cascade cleanup when a user is deleted. Prevents orphaned
# references in the lock system (audit rows still valid, but pending OTPs
# and manager visibility rows targeting the deleted user must go).
async def _cleanup_lock_refs_for_user(db, uid: str, purge: bool = False) -> Dict[str, int]:
    """Invalidate pending OTPs, remove manager_visibility rows, anonymize
    template creator refs. Audit rows are kept intact for KVKK observability.
    `purge=True` also deletes audit rows (used by future GDPR erase flow).
    Returns counts for the caller to log."""
    counts: Dict[str, int] = {}
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        r = await db.task_unlock_otps.update_many(
            {"$or": [{"issued_by": uid}, {"issued_for": uid}], "used_at": None, "invalidated_at": {"$exists": False}},
            {"$set": {"invalidated_at": now_iso, "invalidated_reason": "user_deleted"}},
        )
        counts["otps_invalidated"] = int(getattr(r, "modified_count", 0) or 0)
    except Exception as exc:  # pragma: no cover
        logger.warning("otp cleanup failed for %s: %s", uid, exc)
    try:
        r = await db.manager_visibility.delete_many({"$or": [{"manager_user_id": uid}, {"employee_user_id": uid}]})
        counts["visibility_rows"] = int(getattr(r, "deleted_count", 0) or 0)
    except Exception as exc:  # pragma: no cover
        logger.warning("visibility cleanup failed for %s: %s", uid, exc)
    if purge:
        try:
            r = await db.task_lock_audit.delete_many({"$or": [{"actor_user_id": uid}, {"task_id": f"__user_policy__:{uid}"}]})
            counts["audit_purged"] = int(getattr(r, "deleted_count", 0) or 0)
        except Exception as exc:  # pragma: no cover
            logger.warning("audit purge failed for %s: %s", uid, exc)
    return counts

DEFAULT_SYSTEM_QUOTA_MB = 10 * 1024        # 10 GB
MIN_SYSTEM_QUOTA_MB = 100                  # 100 MB floor
MAX_SYSTEM_QUOTA_MB = 10 * 1024 * 1024     # 10 TB ceiling

# Frontend Error Radar — TTL index'in bir kez kurulduğunu izleyen bayrak.
_CLIENT_LOG_INDEX_READY = {"done": False}


# ---------------------------------------------------------------------------
# Request bodies
# ---------------------------------------------------------------------------
class AdminCreateUserRequest(BaseModel):
    # Password is optional — when omitted (or blank) the backend generates a
    # secure random 10-char temp password and returns it in the response so the
    # admin can share it with the new user. The user can change it later from
    # their own Settings panel.
    username: str
    password: Optional[str] = None
    role: str = "employee"
    with_license: Optional[str] = None
    custom_quota_mb: Optional[int] = Field(default=None, ge=1, le=10485760)
    company_name: Optional[str] = None
    company_id: Optional[str] = None


def _generate_temp_password(length: int = 10) -> str:
    """Generate a readable but secure temp password (mixed case + digits, no ambiguous chars)."""
    alphabet = string.ascii_letters + string.digits
    # Strip visually ambiguous characters (0/O, 1/l/I) so admins can dictate.
    alphabet = "".join(c for c in alphabet if c not in "0O1lI")
    return "".join(secrets.choice(alphabet) for _ in range(length))


class AdminUpdateUserRequest(BaseModel):
    role: Optional[str] = None
    new_password: Optional[str] = None
    custom_quota_mb: Optional[int] = Field(default=None, ge=0, le=10485760)
    company_name: Optional[str] = None
    company_id: Optional[str] = None


class SystemQuotaUpdate(BaseModel):
    quota_mb: int = Field(..., ge=MIN_SYSTEM_QUOTA_MB, le=MAX_SYSTEM_QUOTA_MB)


class ChatPromptUpdate(BaseModel):
    tr: str = Field(default="", max_length=8000)
    en: str = Field(default="", max_length=8000)


class ClientLogRequest(BaseModel):
    # Frontend Error Radar — tarayıcıdan gelen tekil hata kaydı.
    level: Optional[str] = "error"
    message: str = Field(default="", max_length=2000)
    stack: Optional[str] = Field(default=None, max_length=8000)
    source: Optional[str] = Field(default=None, max_length=1000)
    lineno: Optional[int] = None
    colno: Optional[int] = None
    url: Optional[str] = Field(default=None, max_length=1000)
    user_agent: Optional[str] = Field(default=None, max_length=600)
    ts_client: Optional[str] = None


class ClientErrorNotifyUpdate(BaseModel):
    # Süper yönetici — yeni frontend hatası bildirimlerinin cooldown'u (dk) + aç/kapa.
    cooldown_min: int = Field(default=15, ge=1, le=1440)
    enabled: bool = True


class ClientLogResolve(BaseModel):
    # Tek bir hata kaydını çözüldü/aktif olarak işaretle.
    resolved: bool = True


class ClientLogResolveBulk(BaseModel):
    # Aynı mesaja sahip TÜM kayıtları toplu çöz/geri al (grup çözümü).
    message: str = Field(default="", max_length=2000)
    resolved: bool = True


class AdminCapsUpdate(BaseModel):
    # Süper yönetici → bir Yönetici'ye tanınan özel fonksiyonlar.
    extra_company_ids: Optional[list] = None
    can_create_company: Optional[bool] = None
    can_view_company_tasks: Optional[bool] = None


class SuperAdminGrant(BaseModel):
    # Kurucu → süreli süper yönetici ataması. `hours` verilirse şimdi+hours;
    # `until` (ISO) verilirse o ana kadar. En az biri gerekli.
    hours: Optional[int] = Field(default=None, ge=1, le=8760)
    until: Optional[str] = None


def build_admin_router(db, current_user_dep, require_admin, hash_password) -> APIRouter:
    router = APIRouter()

    async def _get_system_quota_mb() -> int:
        doc = await db.system_settings.find_one({"key": "global"}, {"_id": 0})
        if doc and isinstance(doc.get("quota_mb"), (int, float)) and doc["quota_mb"] > 0:
            return int(doc["quota_mb"])
        return DEFAULT_SYSTEM_QUOTA_MB

    async def _find_company_by_name(name: str) -> Optional[dict]:
        return await db.companies.find_one(
            {"name": {"$regex": f"^{_regex_escape(name.strip())}$", "$options": "i"}},
            {"_id": 0},
        )

    async def _resolve_company_for_actor(actor: dict, company_id, company_name):
        """Resolve a (company_id, company_name) target for create/update.
        Super admin: unrestricted. Company admin: only companies in their
        effective set; creating a brand-new company requires the
        `can_create_company` capability."""
        super_ = is_super_admin(actor)
        eff = set(admin_effective_company_ids(actor))
        if company_id:
            comp = await db.companies.find_one({"id": company_id}, {"_id": 0})
            if not comp:
                raise HTTPException(status_code=404, detail="Şirket bulunamadı")
            if not super_ and comp["id"] not in eff:
                raise HTTPException(status_code=403, detail="Bu şirkete kullanıcı atama yetkiniz yok")
            return comp["id"], comp["name"]
        if company_name and company_name.strip():
            existing = await _find_company_by_name(company_name)
            if existing:
                if not super_ and existing["id"] not in eff:
                    raise HTTPException(status_code=403, detail="Bu şirkete kullanıcı atama yetkiniz yok")
                return existing["id"], existing["name"]
            if not super_ and not get_admin_caps(actor).get("can_create_company"):
                raise HTTPException(status_code=403, detail="Yeni şirket açma yetkiniz yok")
            try:
                comp = await get_or_create_company(db, company_name.strip(), created_by=actor["id"])
            except ValueError as e:
                raise HTTPException(status_code=400, detail=str(e))
            return comp["id"], comp["name"]
        return None, None

    def _assert_can_manage_target(actor: dict, target: dict):
        """Owner is untouchable by anyone but themselves. A temp super_admin is
        untouchable by non-owners. A company admin may only manage users inside
        their effective companies."""
        if target.get("is_owner") and not actor.get("is_owner"):
            raise HTTPException(status_code=403, detail="Kurucu üzerinde işlem yapılamaz")
        if is_super_admin(actor):
            return
        # From here the actor is a company admin.
        if target.get("role") == "super_admin":
            raise HTTPException(status_code=403, detail="Süper yönetici üzerinde işlem yapamazsınız")
        eff = set(admin_effective_company_ids(actor))
        tcids = set(get_user_company_ids(target))
        if not eff or not (eff & tcids):
            raise HTTPException(status_code=403, detail="Bu kullanıcı yönetim kapsamınızda değil")


    # ------------------------------------------------------------------
    # Companies list (legacy: distinct company_name)
    # ------------------------------------------------------------------
    @router.get("/admin/companies")
    async def admin_list_companies(user: dict = Depends(current_user_dep)):
        require_admin(user)
        try:
            if is_super_admin(user):
                names = await db.users.distinct("company_name", {"company_name": {"$ne": None, "$exists": True}})
            else:
                eff = admin_effective_company_ids(user)
                if not eff:
                    names = []
                else:
                    comps = await db.companies.find(
                        {"id": {"$in": eff}}, {"_id": 0, "name": 1}).to_list(length=2000)
                    names = [c.get("name") for c in comps]
            names = sorted([n for n in names if n and n.strip()], key=lambda s: s.lower())
        except Exception:
            names = []
        return {"companies": names}

    # ------------------------------------------------------------------
    # Users list + storage roll-up
    # ------------------------------------------------------------------
    @router.get("/admin/users")
    async def admin_list_users(user: dict = Depends(current_user_dep)):
        require_admin(user)
        if is_super_admin(user):
            user_q: Dict[str, Any] = {}
        else:
            # Company admin sees only users in their effective companies (+ self).
            eff = admin_effective_company_ids(user)
            if not eff:
                user_q = {"id": user["id"]}
            else:
                user_q = {"$or": [
                    {"id": user["id"]},
                    {"company_id": {"$in": eff}},
                    {"company_ids": {"$in": eff}},
                ]}
        users = await db.users.find(user_q, {"_id": 0, "password_hash": 0}).sort("created_at", 1).to_list(length=500)
        collections = [
            "tasks", "notes", "files", "conversations", "messages",
            "memories", "email_accounts", "reminders", "file_chunks",
        ]
        totals: Dict[str, int] = {}
        for name in collections:
            try:
                pipeline = [{"$group": {"_id": "$user_id", "total": {"$sum": {"$bsonSize": "$$ROOT"}}}}]
                async for doc in db[name].aggregate(pipeline):
                    uid = doc.get("_id")
                    if not uid:
                        continue
                    totals[uid] = totals.get(uid, 0) + int(doc.get("total", 0) or 0)
            except Exception as exc:
                logger.warning("storage aggregate failed for collection %r: %s", name, exc)
        from license_service import (
            LICENSE_QUOTA_MB, FREE_QUOTA_MB, LICENSE_TYPE_LABELS_TR, get_user_license,
        )
        for u in users:
            used = totals.get(u["id"], 0)
            u["usage_bytes"] = used
            u["usage_mb"] = round(used / (1024 * 1024), 2)
            if u.get("is_owner") or u.get("role") in ("admin", "super_admin"):
                u["quota_mb"] = None
                u["quota_source"] = "system"
                u["quota_percent"] = None
                u["quota_label"] = "Sistem"
                continue
            override = u.get("custom_quota_mb")
            if isinstance(override, (int, float)) and override > 0:
                u["quota_mb"] = int(override)
                u["quota_source"] = "custom"
                u["quota_label"] = "Özel"
            else:
                lic = await get_user_license(db, u["id"])
                if lic:
                    lt = lic.get("type")
                    u["quota_mb"] = LICENSE_QUOTA_MB.get(lt, FREE_QUOTA_MB)
                    u["quota_source"] = "license"
                    u["quota_label"] = LICENSE_TYPE_LABELS_TR.get(lt, lt or "Ücretsiz")
                else:
                    u["quota_mb"] = FREE_QUOTA_MB
                    u["quota_source"] = "free"
                    u["quota_label"] = "Ücretsiz"
            if u["quota_mb"] and u["quota_mb"] > 0:
                u["quota_percent"] = round((u["usage_mb"] / u["quota_mb"]) * 100, 1)
            else:
                u["quota_percent"] = None
        return users

    # ------------------------------------------------------------------
    # System quota
    # ------------------------------------------------------------------
    @router.get("/admin/system-quota")
    async def get_system_quota(user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        return {
            "quota_mb": await _get_system_quota_mb(),
            "min_mb": MIN_SYSTEM_QUOTA_MB,
            "max_mb": MAX_SYSTEM_QUOTA_MB,
            "default_mb": DEFAULT_SYSTEM_QUOTA_MB,
        }

    @router.put("/admin/system-quota")
    async def set_system_quota(req: SystemQuotaUpdate, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        await db.system_settings.update_one(
            {"key": "global"},
            {"$set": {
                "key": "global",
                "quota_mb": int(req.quota_mb),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": user["id"],
            }},
            upsert=True,
        )
        return {"quota_mb": int(req.quota_mb)}

    # ------------------------------------------------------------------
    # Sertex Chat sistem promptu — admin düzenleyebilir (b)
    # ------------------------------------------------------------------
    @router.get("/admin/chat-prompt")
    async def get_chat_prompt(user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        from routers.chat_router import SYSTEM_PROMPT_TR, SYSTEM_PROMPT_EN
        doc = await db.system_settings.find_one({"key": "global"}, {"_id": 0}) or {}
        return {
            "tr": (doc.get("chat_system_prompt_tr") or ""),
            "en": (doc.get("chat_system_prompt_en") or ""),
            "default_tr": SYSTEM_PROMPT_TR,
            "default_en": SYSTEM_PROMPT_EN,
        }

    @router.put("/admin/chat-prompt")
    async def set_chat_prompt(req: ChatPromptUpdate, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        await db.system_settings.update_one(
            {"key": "global"},
            {"$set": {
                "key": "global",
                "chat_system_prompt_tr": (req.tr or "").strip(),
                "chat_system_prompt_en": (req.en or "").strip(),
                "chat_prompt_updated_at": datetime.now(timezone.utc).isoformat(),
                "chat_prompt_updated_by": user["id"],
            }},
            upsert=True,
        )
        return {"tr": (req.tr or "").strip(), "en": (req.en or "").strip()}

    # ------------------------------------------------------------------
    # Sidebar stats summary (feeds NEURAL LINK)
    # ------------------------------------------------------------------
    @router.get("/stats/summary")
    async def stats_summary(user: dict = Depends(current_user_dep)):
        uid = user["id"]
        is_super_scope = is_super_admin(user)
        is_priv = is_privileged(user)
        task_active_q = {
            "user_id": uid,
            "status": {"$ne": "done"},
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        }
        tasks_active = await db.tasks.count_documents(task_active_q)
        tasks_total = await db.tasks.count_documents({"user_id": uid})

        async def _safe_count(coll_name: str) -> int:
            try:
                return await db[coll_name].count_documents({"user_id": uid})
            except Exception:
                return 0

        notes_c = await _safe_count("notes")
        files_c = await _safe_count("files")
        conversations_c = await _safe_count("conversations")
        memories_c = await _safe_count("memories")
        email_accounts_c = await _safe_count("email_accounts")

        async def _sum_bsonsize(match: Optional[dict] = None) -> int:
            collections = [
                "tasks", "notes", "files", "conversations", "messages",
                "memories", "email_accounts", "reminders", "file_chunks",
            ]
            total = 0
            for name in collections:
                try:
                    pipeline = []
                    if match:
                        pipeline.append({"$match": match})
                    pipeline.append({"$group": {"_id": None, "total": {"$sum": {"$bsonSize": "$$ROOT"}}}})
                    res = await db[name].aggregate(pipeline).to_list(length=1)
                    if res:
                        total += int(res[0].get("total", 0) or 0)
                except Exception as exc:
                    logger.warning("per-user storage aggregate failed for collection %r: %s", name, exc)
            return total

        db_bytes = await _sum_bsonsize(None if is_super_scope else {"user_id": uid})
        db_mb = round(db_bytes / (1024 * 1024), 2)

        from license_service import (
            LICENSE_QUOTA_MB, FREE_QUOTA_MB, LICENSE_TYPE_LABELS_TR, get_user_license,
        )
        quota_mb: Optional[int] = None
        quota_percent: Optional[float] = None
        license_type: Optional[str] = None
        license_label: str = "Sistem" if is_priv else "Ücretsiz"
        if is_priv:
            quota_mb = await _get_system_quota_mb()
        else:
            user_doc = await db.users.find_one({"id": uid}, {"_id": 0, "custom_quota_mb": 1})
            override = user_doc.get("custom_quota_mb") if user_doc else None
            if isinstance(override, (int, float)) and override > 0:
                quota_mb = int(override)
                license_label = "Özel (Yönetici)"
            else:
                lic = await get_user_license(db, uid)
                if lic:
                    license_type = lic.get("type")
                    license_label = LICENSE_TYPE_LABELS_TR.get(license_type, license_type or "Ücretsiz")
                    quota_mb = LICENSE_QUOTA_MB.get(license_type, FREE_QUOTA_MB)
                else:
                    quota_mb = FREE_QUOTA_MB
        if quota_mb and quota_mb > 0:
            quota_percent = round((db_mb / quota_mb) * 100, 1)
        return {
            "tasks_active": tasks_active,
            "tasks_total": tasks_total,
            "notes": notes_c,
            "files": files_c,
            "conversations": conversations_c,
            "memories": memories_c,
            "email_accounts": email_accounts_c,
            "db_bytes": db_bytes,
            "db_mb": db_mb,
            "is_admin_scope": is_super_scope,
            "quota_mb": quota_mb,
            "quota_percent": quota_percent,
            "license_type": license_type,
            "license_label": license_label,
        }

    # ------------------------------------------------------------------
    # User CRUD + impersonate
    # ------------------------------------------------------------------
    @router.post("/admin/users")
    async def admin_create_user(req: AdminCreateUserRequest, user: dict = Depends(current_user_dep)):
        require_admin(user)
        uname = req.username.strip()
        if len(uname) < 3:
            raise HTTPException(status_code=400, detail="Kullanıcı adı en az 3 karakter olmalı")
        # Password is optional. If admin left it blank we auto-generate a
        # secure temp password and return it (once) so it can be shared.
        raw_password = (req.password or "").strip()
        temp_password_generated: Optional[str] = None
        if raw_password == "":
            raw_password = _generate_temp_password()
            temp_password_generated = raw_password
        elif len(raw_password) < 6:
            raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı")
        role = normalize_role(req.role)
        if role not in ("admin", "manager", "employee"):
            raise HTTPException(status_code=400, detail="Geçersiz rol")
        if req.with_license:
            from license_service import LICENSE_TYPES as _LT
            if req.with_license not in _LT:
                raise HTTPException(400, f"Bilinmeyen lisans türü: {req.with_license}")
        exists = await db.users.find_one({"username": uname})
        if exists:
            raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten var")
        new_user = {
            "id": str(uuid.uuid4()),
            "username": uname,
            "password_hash": hash_password(raw_password),
            "role": role,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "created_by": user["id"],
            # Track whether the admin picked the password (True) or we
            # auto-generated it (False). Frontend can later prompt the user
            # to reset their password on first login if needed.
            "password_user_set": temp_password_generated is None,
        }
        if req.custom_quota_mb and req.custom_quota_mb > 0:
            new_user["custom_quota_mb"] = int(req.custom_quota_mb)
        if req.company_id:
            cid, cname = await _resolve_company_for_actor(user, req.company_id, None)
            new_user["company_id"] = cid
            new_user["company_name"] = cname
        elif req.company_name and req.company_name.strip():
            cid, cname = await _resolve_company_for_actor(user, None, req.company_name)
            new_user["company_id"] = cid
            new_user["company_name"] = cname
        elif not is_super_admin(user):
            # Company admin must place new users inside a company they manage;
            # default to their own primary company when none was specified.
            own = user.get("company_id")
            if own:
                comp = await db.companies.find_one({"id": own}, {"_id": 0})
                if comp:
                    new_user["company_id"] = comp["id"]
                    new_user["company_name"] = comp["name"]
        await db.users.insert_one(new_user)
        new_user.pop("password_hash", None)
        new_user.pop("_id", None)
        if req.with_license and role != "admin":
            from license_service import create_licenses, redeem_license
            keys = await create_licenses(
                db,
                license_type=req.with_license,
                count=1,
                notes=f"Auto-issued with user '{uname}'",
                created_by=user["username"],
            )
            try:
                lic = await redeem_license(db, new_user, keys[0]["key"])
                new_user["license"] = lic
            except Exception as e:
                await db.licenses.delete_one({"id": keys[0]["id"]})
                logger.warning("with_license redeem failed, cleaned up: %s", e)
                raise
        # Only surface the raw temp password when the backend generated it —
        # never echo an admin-picked password back over the wire.
        if temp_password_generated is not None:
            new_user["temp_password"] = temp_password_generated
        return new_user

    @router.patch("/admin/users/{uid}")
    async def admin_update_user(uid: str, req: AdminUpdateUserRequest, user: dict = Depends(current_user_dep)):
        require_admin(user)
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        _assert_can_manage_target(user, target)
        old_company_id = target.get("company_id")
        updates: Dict[str, Any] = {}
        if req.role is not None:
            new_role = normalize_role(req.role)
            if new_role not in ("admin", "manager", "employee"):
                raise HTTPException(status_code=400, detail="Geçersiz rol (süper yönetici için ayrı akış kullanın)")
            if target.get("is_owner"):
                raise HTTPException(status_code=400, detail="Kurucunun rolü değiştirilemez")
            if target.get("role") == "super_admin":
                raise HTTPException(status_code=400, detail="Süper yönetici rolü buradan değiştirilemez — süper yönetici geri alma akışını kullanın")
            updates["role"] = new_role
        if req.new_password is not None:
            if len(req.new_password) < 6:
                raise HTTPException(status_code=400, detail="Şifre en az 6 karakter olmalı")
            updates["password_hash"] = hash_password(req.new_password)
            updates["password_user_set"] = True
        unset_fields: Dict[str, str] = {}
        if req.custom_quota_mb is not None:
            if req.custom_quota_mb == 0:
                unset_fields["custom_quota_mb"] = ""
            else:
                updates["custom_quota_mb"] = int(req.custom_quota_mb)
        if req.company_id is not None:
            stripped_cid = req.company_id.strip()
            if stripped_cid == "":
                unset_fields["company_id"] = ""
                unset_fields["company_name"] = ""
            else:
                cid, cname = await _resolve_company_for_actor(user, stripped_cid, None)
                updates["company_id"] = cid
                updates["company_name"] = cname
        elif req.company_name is not None:
            stripped = req.company_name.strip()
            if stripped == "":
                unset_fields["company_name"] = ""
                unset_fields["company_id"] = ""
            else:
                cid, cname = await _resolve_company_for_actor(user, None, stripped)
                updates["company_name"] = cname
                updates["company_id"] = cid
        if updates or unset_fields:
            op: Dict[str, Any] = {}
            if updates:
                op["$set"] = updates
            if unset_fields:
                op["$unset"] = unset_fields
            await db.users.update_one({"id": uid}, op)
        # Faz 10 — Offboarding on company change. When an employee's company is
        # changed (or cleared), their tasks tied to the OLD company are handled
        # automatically: finished tasks are archived, unfinished tasks move to
        # the "Yarım Kalan İşler" pool and (if a manager exists) get re-assigned
        # to that company's manager + a notification. Personal / other-company
        # tasks are untouched.
        offboard_summary = None
        new_company_id = updates.get("company_id")
        company_changing = ("company_id" in updates) or ("company_id" in unset_fields)
        if company_changing and old_company_id and old_company_id != new_company_id:
            from team_service import offboard_user_from_company
            offboard_summary = await offboard_user_from_company(
                db, uid, old_company_id, actor=user, target_doc=target,
            )
        if company_changing:
            old_cids = get_user_company_ids(target)
            new_cids = [c for c in old_cids if c != old_company_id]
            if new_company_id and new_company_id not in new_cids:
                new_cids.append(new_company_id)
            await db.users.update_one({"id": uid}, {"$set": {"company_ids": new_cids}})
        updated = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        if offboard_summary:
            updated["_offboard"] = offboard_summary
        return updated

    # ------------------------------------------------------------------
    # Faz 9 CP4 — Production Monitoring
    # ------------------------------------------------------------------
    @router.get("/admin/health")
    async def admin_health(user: dict = Depends(current_user_dep)):
        """Aggregated production health snapshot for the admin dashboard.

        Returns real-time metrics: user counts, task activity, DB stats,
        uptime, and a rolling error window. Non-admins are rejected with
        403 so this can't be used as a reconnaissance surface.
        """
        require_super_admin(user)
        from monitoring_service import build_health_snapshot
        return await build_health_snapshot(db)

    @router.post("/admin/users/{uid}/impersonate")
    async def admin_impersonate(uid: str, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        target = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        if target.get("is_owner") and not user.get("is_owner"):
            raise HTTPException(status_code=403, detail="Kurucunun kılığına giremezsiniz")
        from auth import get_jwt_secret, JWT_ALGORITHM
        import jwt as _jwt
        payload = {
            "sub": target["id"],
            "username": target["username"],
            "exp": datetime.now(timezone.utc) + timedelta(hours=2),
            "type": "access",
            "impersonated_by": user["id"],
            "impersonated_by_username": user["username"],
        }
        token = _jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)
        return {
            "token": token,
            "token_type": "bearer",
            "user": {"id": target["id"], "username": target["username"], "role": target.get("role", "user")},
            "impersonation": True,
        }

    @router.delete("/admin/users/{uid}")
    async def admin_delete_user(
        uid: str,
        mode: str = "hard",
        user: dict = Depends(current_user_dep),
    ):
        """3 modes — soft_orphan | hard | purge. See docstring in server for
        full semantics."""
        require_admin(user)
        if uid == user["id"]:
            raise HTTPException(status_code=400, detail="Kendinizi silemezsiniz")
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        if target.get("is_owner"):
            raise HTTPException(status_code=400, detail="Kurucu silinemez")
        _assert_can_manage_target(user, target)
        if mode not in ("soft_orphan", "hard", "purge"):
            raise HTTPException(status_code=400, detail="Geçersiz mod")
        now_iso = datetime.now(timezone.utc).isoformat()
        target_cids = get_user_company_ids(target)
        if mode == "hard":
            await db.users.delete_one({"id": uid})
            await db.tasks.delete_many({"user_id": uid})
            await db.notes.delete_many({"user_id": uid})
            convs = await db.conversations.find({"user_id": uid}, {"id": 1}).to_list(length=1000)
            conv_ids = [c["id"] for c in convs]
            await db.messages.delete_many({"conversation_id": {"$in": conv_ids}})
            await db.conversations.delete_many({"user_id": uid})
            # Faz 9 CP4.34 — lock-system cascade. Prevent orphaned references.
            await _cleanup_lock_refs_for_user(db, uid, purge=False)
            return {"deleted": True, "mode": "hard"}
        # Faz 10 — S3-A consistency: finished tasks always go to the Archive
        # (not the orphan pool) when a user is soft-deleted or purged.
        await db.tasks.update_many(
            {
                "user_id": uid,
                "status": "done",
                "$or": [{"archived": {"$exists": False}}, {"archived": False}],
            },
            {"$set": {"archived": True, "archived_at": now_iso}},
        )
        active_query = {
            "user_id": uid,
            "status": {"$nin": ["done"]},
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        }
        orphaned_total = 0
        if target_cids:
            for cid in target_cids:
                res = await db.tasks.update_many(
                    {**active_query, "company_id": cid},
                    {"$set": {
                        "orphaned": True,
                        "orphaned_at": now_iso,
                        "orphaned_from_company_id": cid,
                        "prev_assignee_user_id": uid,
                        "prev_assignee_name": target.get("username"),
                    }},
                )
                orphaned_total += res.modified_count if res else 0
        res = await db.tasks.update_many(
            {**active_query, "$and": [
                {"$or": [{"company_id": None}, {"company_id": {"$exists": False}}]},
            ]},
            {"$set": {
                "orphaned": True,
                "orphaned_at": now_iso,
                "orphaned_from_company_id": None,
                "prev_assignee_user_id": uid,
                "prev_assignee_name": target.get("username"),
            }},
        )
        orphaned_total += res.modified_count if res else 0
        if mode == "purge":
            await db.tasks.update_many({"user_id": uid}, {"$set": {"assignee_name": None}})
        await db.users.delete_one({"id": uid})
        await db.notes.delete_many({"user_id": uid})
        convs = await db.conversations.find({"user_id": uid}, {"id": 1}).to_list(length=1000)
        conv_ids = [c["id"] for c in convs]
        await db.messages.delete_many({"conversation_id": {"$in": conv_ids}})
        await db.conversations.delete_many({"user_id": uid})
        # Faz 9 CP4.34 — lock-system cascade (purge mode also nukes audit)
        await _cleanup_lock_refs_for_user(db, uid, purge=(mode == "purge"))
        return {"deleted": True, "mode": mode, "orphaned_tasks": orphaned_total}

    # ------------------------------------------------------------------
    # Frontend Error Radar — sessiz istemci (tarayıcı) hata toplama
    # ------------------------------------------------------------------
    @router.post("/client-log")
    async def client_log(payload: ClientLogRequest, request: Request):
        """Public (opsiyonel-auth) — tarayıcıda oluşan JS hatalarını sessizce
        toplar. Login öncesi hatalar da yakalanabilsin diye token zorunlu
        değildir; token varsa kullanıcı ilişkilendirilir. UX'i hiç etkilemez."""
        username = None
        user_id = None
        auth_header = request.headers.get("Authorization", "")
        if auth_header.startswith("Bearer "):
            try:
                from auth import decode_token
                tok = decode_token(auth_header[7:])
                if tok.get("type") == "access":
                    user_id = tok.get("sub")
                    username = tok.get("username")
            except Exception:
                pass
        msg = (payload.message or "").strip()
        if not msg:
            return {"ok": False}
        now = datetime.now(timezone.utc)
        if not _CLIENT_LOG_INDEX_READY["done"]:
            try:
                await db.client_logs.create_index("ts", expireAfterSeconds=30 * 24 * 3600)
                await db.client_logs.create_index([("created_at", -1)])
            except Exception as exc:
                logger.warning("client_logs index kurulamadı: %s", exc)
            _CLIENT_LOG_INDEX_READY["done"] = True
        doc = {
            "id": str(uuid.uuid4()),
            "level": (payload.level or "error")[:20],
            "message": msg[:2000],
            "stack": payload.stack or None,
            "source": payload.source or None,
            "lineno": payload.lineno,
            "colno": payload.colno,
            "page_url": payload.url or None,
            "user_agent": payload.user_agent or None,
            "user_id": user_id,
            "username": username,
            "ts_client": payload.ts_client,
            "created_at": now.isoformat(),
            "ts": now,  # gerçek Date — TTL index için
        }
        try:
            await db.client_logs.insert_one(doc)
        except Exception as exc:
            logger.warning("client_log insert hatası: %s", exc)
            return {"ok": False}
        # Hata Bildirimi — süper yöneticilere anlık uyarı (best-effort, cooldown'lu).
        try:
            from team_service import notify_super_admins_client_error
            await notify_super_admins_client_error(db, doc)
        except Exception as exc:
            logger.debug("client error notify skipped: %s", exc)
        return {"ok": True}

    @router.get("/admin/client-logs")
    async def admin_client_logs(
        limit: int = 100,
        status: str = "active",
        level: Optional[str] = None,
        user: dict = Depends(current_user_dep),
    ):
        require_super_admin(user)
        limit = max(1, min(int(limit), 500))
        q: Dict[str, Any] = {}
        if status == "active":
            q["resolved"] = {"$ne": True}
        elif status == "resolved":
            q["resolved"] = True
        # status == "all" → çözülmüş filtresi yok
        if level:
            levels = [lv.strip().lower() for lv in level.split(",") if lv.strip()]
            if levels:
                q["level"] = {"$in": levels}
        docs = await db.client_logs.find(
            q, {"_id": 0, "ts": 0},
        ).sort("created_at", -1).to_list(length=limit)
        total = await db.client_logs.count_documents({})
        active = await db.client_logs.count_documents({"resolved": {"$ne": True}})
        cutoff = (datetime.now(timezone.utc) - timedelta(hours=24)).isoformat()
        last_24h = await db.client_logs.count_documents({"created_at": {"$gte": cutoff}})
        return {"logs": docs, "total": total, "active": active, "last_24h": last_24h}

    @router.delete("/admin/client-logs")
    async def admin_clear_client_logs(user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        res = await db.client_logs.delete_many({})
        return {"deleted": int(getattr(res, "deleted_count", 0) or 0)}

    @router.get("/admin/client-logs/notify-settings")
    async def get_client_log_notify_settings(user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        doc = await db.system_settings.find_one({"key": "global"}, {"_id": 0}) or {}
        cd = doc.get("client_error_notify_cooldown_min")
        en = doc.get("client_error_notify_enabled")
        return {
            "cooldown_min": int(cd) if isinstance(cd, (int, float)) and cd else 15,
            "enabled": True if en is None else bool(en),
        }

    @router.put("/admin/client-logs/notify-settings")
    async def set_client_log_notify_settings(req: ClientErrorNotifyUpdate, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        await db.system_settings.update_one(
            {"key": "global"},
            {"$set": {
                "key": "global",
                "client_error_notify_cooldown_min": int(req.cooldown_min),
                "client_error_notify_enabled": bool(req.enabled),
                "updated_at": datetime.now(timezone.utc).isoformat(),
                "updated_by": user["id"],
            }},
            upsert=True,
        )
        try:
            from team_service import invalidate_ce_cfg_cache
            invalidate_ce_cfg_cache()
        except Exception:
            pass
        return {"cooldown_min": int(req.cooldown_min), "enabled": bool(req.enabled)}

    @router.post("/admin/client-logs/resolve-bulk")
    async def resolve_client_logs_bulk(req: ClientLogResolveBulk, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        msg = (req.message or "").strip()
        if not msg:
            return {"updated": 0, "resolved": bool(req.resolved)}
        now = datetime.now(timezone.utc).isoformat()
        if req.resolved:
            upd = {"$set": {"resolved": True, "resolved_at": now, "resolved_by": user.get("username") or user["id"]}}
        else:
            upd = {"$set": {"resolved": False}, "$unset": {"resolved_at": "", "resolved_by": ""}}
        res = await db.client_logs.update_many({"message": msg}, upd)
        return {"updated": int(getattr(res, "modified_count", 0) or 0), "resolved": bool(req.resolved)}

    @router.post("/admin/client-logs/{log_id}/resolve")
    async def resolve_client_log(log_id: str, req: ClientLogResolve, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        now = datetime.now(timezone.utc).isoformat()
        if req.resolved:
            upd = {"$set": {"resolved": True, "resolved_at": now, "resolved_by": user.get("username") or user["id"]}}
        else:
            upd = {"$set": {"resolved": False}, "$unset": {"resolved_at": "", "resolved_by": ""}}
        res = await db.client_logs.update_one({"id": log_id}, upd)
        return {"updated": int(getattr(res, "modified_count", 0) or 0), "resolved": bool(req.resolved)}

    # ------------------------------------------------------------------
    # Süper Yönetici / Kurucu — rol yönetimi
    # ------------------------------------------------------------------
    def _serialize_super(u: dict) -> dict:
        return {
            "id": u["id"],
            "username": u.get("username"),
            "is_owner": bool(u.get("is_owner")),
            "role": u.get("role"),
            "super_admin_until": u.get("super_admin_until"),
            "prev_role": u.get("prev_role"),
        }

    @router.get("/admin/super-admins")
    async def list_super_admins(user: dict = Depends(current_user_dep)):
        """Kurucu + aktif (süreli) süper yöneticiler. Süper yönetici görebilir."""
        require_super_admin(user)
        docs = await db.users.find(
            {"$or": [{"is_owner": True}, {"role": "super_admin"}]},
            {"_id": 0, "password_hash": 0},
        ).to_list(length=500)
        docs.sort(key=lambda d: (not d.get("is_owner"), d.get("username") or ""))
        return {"super_admins": [_serialize_super(d) for d in docs]}

    @router.post("/admin/users/{uid}/super-admin")
    async def grant_super_admin(uid: str, req: SuperAdminGrant, user: dict = Depends(current_user_dep)):
        """Kurucu → birini SÜRELİ süper yönetici yapar. Süre bitince otomatik
        eski rolüne döner (lazy revert). Yalnızca kurucu yapabilir."""
        require_owner(user)
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        if target.get("is_owner"):
            raise HTTPException(status_code=400, detail="Kurucu zaten kalıcı süper yöneticidir")
        # Compute expiry.
        if req.until:
            try:
                exp = datetime.fromisoformat(req.until)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
            except Exception:
                raise HTTPException(status_code=400, detail="Geçersiz tarih (until)")
        elif req.hours:
            exp = datetime.now(timezone.utc) + timedelta(hours=int(req.hours))
        else:
            raise HTTPException(status_code=400, detail="`hours` veya `until` gerekli")
        if exp <= datetime.now(timezone.utc):
            raise HTTPException(status_code=400, detail="Bitiş zamanı gelecekte olmalı")
        # Preserve the role to revert to (don't overwrite an existing temp grant's prev_role).
        prev_role = target.get("prev_role") if target.get("role") == "super_admin" else normalize_role(target.get("role"))
        await db.users.update_one(
            {"id": uid},
            {"$set": {
                "role": "super_admin",
                "super_admin_until": exp.isoformat(),
                "prev_role": prev_role or "employee",
                "super_admin_granted_by": user["id"],
                "super_admin_granted_at": datetime.now(timezone.utc).isoformat(),
                "super_admin_expiry_warned": False,
            }},
        )
        updated = await db.users.find_one({"id": uid}, {"_id": 0, "password_hash": 0})
        return _serialize_super(updated)

    @router.delete("/admin/users/{uid}/super-admin")
    async def revoke_super_admin(uid: str, user: dict = Depends(current_user_dep)):
        """Kurucu → süreli süper yöneticiyi erken geri alır (eski rolüne döner)."""
        require_owner(user)
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        if target.get("is_owner"):
            raise HTTPException(status_code=400, detail="Kurucu geri alınamaz")
        if target.get("role") != "super_admin":
            raise HTTPException(status_code=400, detail="Bu kullanıcı süper yönetici değil")
        reverted = target.get("prev_role") or "employee"
        await db.users.update_one(
            {"id": uid},
            {"$set": {"role": reverted},
             "$unset": {"super_admin_until": "", "prev_role": "",
                        "super_admin_granted_by": "", "super_admin_granted_at": "",
                        "super_admin_expiry_warned": ""}},
        )
        return {"ok": True, "role": reverted}

    @router.patch("/admin/users/{uid}/admin-caps")
    async def set_admin_caps(uid: str, req: AdminCapsUpdate, user: dict = Depends(current_user_dep)):
        """Süper yönetici → bir Yönetici'ye özel fonksiyon tanır/kaldırır:
        ek şirket görme, yeni şirket açma, şirket görevlerini görme."""
        require_super_admin(user)
        target = await db.users.find_one({"id": uid})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        if acting_role(target) != "admin" or target.get("is_owner") or target.get("role") == "super_admin":
            raise HTTPException(status_code=400, detail="Özel fonksiyonlar yalnızca Yönetici rolüne tanınır")
        caps = get_admin_caps(target)
        if req.extra_company_ids is not None:
            valid = await db.companies.find(
                {"id": {"$in": list(req.extra_company_ids)}}, {"_id": 0, "id": 1}).to_list(length=500)
            caps["extra_company_ids"] = [c["id"] for c in valid]
        if req.can_create_company is not None:
            caps["can_create_company"] = bool(req.can_create_company)
        if req.can_view_company_tasks is not None:
            caps["can_view_company_tasks"] = bool(req.can_view_company_tasks)
        await db.users.update_one({"id": uid}, {"$set": {"admin_caps": caps}})
        return {"id": uid, "admin_caps": caps}

    return router
