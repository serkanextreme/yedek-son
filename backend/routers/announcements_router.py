"""Sertex — Global Announcement System.

A lightweight admin-to-fleet broadcast channel. The admin publishes a message
(info / warning / critical) targeted at either everyone, a role, or a
specific company; connected clients receive it instantly via the existing
SSE notification stream and render a banner. Non-connected clients pick it
up on their next `GET /api/announcements/active` poll (banner mount).

Design notes
------------
* Storage is one document per announcement in `announcements`. Delivery
  fan-out is done by pushing an SSE event to every subscriber_id we can
  resolve at publish time (best effort — offline users refetch on load).
* Ack state lives in a separate `announcement_acks` collection so a
  single "who saw this" query stays fast without ballooning the source doc.
* Critical severity forces the client to acknowledge before the banner
  closes; info/warning can be dismissed transiently (client-side).
* Endpoints are prefixed with `/announcements` — parent router mounts
  them under `/api` so the effective path is `/api/announcements/*`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

from notification_pubsub import pubsub as notif_pubsub
import fcm_service  # Faz 9 CP7 — mobile push fan-out (best effort)
from permissions import is_super_admin, admin_effective_company_ids


logger = logging.getLogger(__name__)


# --------------------------------------------------------------------------
# Models
# --------------------------------------------------------------------------
_SEVERITIES = ("info", "warning", "critical")
_TARGET_TYPES = ("all", "role", "company")
_ROLES = ("admin", "manager", "employee")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


class Announcement(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    message: str
    severity: str = "info"              # info | warning | critical
    target_type: str = "all"            # all | role | company
    target_value: Optional[str] = None  # role name or company_id (null for "all")
    require_ack: bool = False           # critical → typically True
    is_active: bool = True
    expires_at: Optional[str] = None    # ISO — banner auto-hides after this
    created_by: str
    created_by_username: Optional[str] = None
    created_at: str = Field(default_factory=_now_iso)
    updated_at: str = Field(default_factory=_now_iso)


class AnnouncementCreate(BaseModel):
    title: str
    message: str
    severity: str = "info"
    target_type: str = "all"
    target_value: Optional[str] = None
    require_ack: bool = False
    expires_at: Optional[str] = None


class AnnouncementUpdate(BaseModel):
    title: Optional[str] = None
    message: Optional[str] = None
    severity: Optional[str] = None
    target_type: Optional[str] = None
    target_value: Optional[str] = None
    require_ack: Optional[bool] = None
    is_active: Optional[bool] = None
    expires_at: Optional[str] = None


# --------------------------------------------------------------------------
# Helpers
# --------------------------------------------------------------------------
def _validate_create(payload: AnnouncementCreate) -> None:
    title = (payload.title or "").strip()
    message = (payload.message or "").strip()
    if not title:
        raise HTTPException(status_code=400, detail="Başlık gerekli")
    if len(title) > 120:
        raise HTTPException(status_code=400, detail="Başlık en fazla 120 karakter")
    if not message:
        raise HTTPException(status_code=400, detail="Mesaj gerekli")
    if len(message) > 2000:
        raise HTTPException(status_code=400, detail="Mesaj en fazla 2000 karakter")
    if payload.severity not in _SEVERITIES:
        raise HTTPException(status_code=400, detail=f"Severity {_SEVERITIES} olmalı")
    if payload.target_type not in _TARGET_TYPES:
        raise HTTPException(status_code=400, detail=f"Target type {_TARGET_TYPES} olmalı")
    if payload.target_type == "role":
        if payload.target_value not in _ROLES:
            raise HTTPException(
                status_code=400,
                detail=f"target_type=role için target_value {_ROLES} olmalı",
            )
    if payload.target_type == "company":
        if not payload.target_value:
            raise HTTPException(
                status_code=400,
                detail="target_type=company için target_value (company_id) gerekli",
            )


def _matches_target(ann: dict, user: dict) -> bool:
    """Does `ann` apply to `user`? Kept in sync with `_resolve_target_users`
    so client-side polling and server-side push behave identically."""
    tt = ann.get("target_type", "all")
    tv = ann.get("target_value")
    if tt == "all":
        return True
    if tt == "role":
        return (user.get("role") or "").lower() == (tv or "").lower()
    if tt == "company":
        return user.get("company_id") == tv
    return False


async def _resolve_target_user_ids(db, ann: dict) -> List[str]:
    """Return every user_id that should receive this announcement's SSE push.
    Used at publish time; DB is the source of truth (no in-memory cache).
    """
    tt = ann.get("target_type", "all")
    tv = ann.get("target_value")
    projection = {"_id": 0, "id": 1}
    if tt == "all":
        cur = db.users.find({}, projection)
    elif tt == "role":
        cur = db.users.find({"role": (tv or "").lower()}, projection)
    elif tt == "company":
        cur = db.users.find({"company_id": tv}, projection)
    else:
        return []
    ids: List[str] = []
    async for u in cur:
        if u.get("id"):
            ids.append(u["id"])
    return ids


def _is_expired(ann: dict) -> bool:
    exp = ann.get("expires_at")
    if not exp:
        return False
    try:
        return datetime.fromisoformat(exp) < datetime.now(timezone.utc)
    except Exception:
        return False


# --------------------------------------------------------------------------
# Router factory
# --------------------------------------------------------------------------
def build_announcements_router(db, licensed_user_dep, current_user_dep, require_admin) -> APIRouter:
    router = APIRouter(prefix="/announcements", tags=["announcements"])

    async def _load_or_404(aid: str) -> dict:
        doc = await db.announcements.find_one({"id": aid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Duyuru bulunamadı")
        return doc

    def _assert_manage_ann(actor: dict, ann: dict):
        """Süper yönetici her duyuruyu yönetir. Yönetici yalnızca kendi
        oluşturduğu VEYA kendi şirketini hedefleyen duyuruları yönetir."""
        if is_super_admin(actor):
            return
        eff = set(admin_effective_company_ids(actor))
        if ann.get("created_by") == actor["id"]:
            return
        if ann.get("target_type") == "company" and ann.get("target_value") in eff:
            return
        raise HTTPException(status_code=403, detail="Bu duyuru üzerinde yetkiniz yok")

    def _scope_create_for_admin(actor: dict, payload: "AnnouncementCreate"):
        """Yönetici (süper değil) yalnızca KENDİ şirketi için duyuru yayınlar.
        Hedef verilmemişse kendi birincil şirketine zorlanır."""
        if is_super_admin(actor):
            return
        eff = set(admin_effective_company_ids(actor))
        if payload.target_type != "company":
            own = actor.get("company_id")
            if not own:
                raise HTTPException(status_code=403, detail="Şirketiniz tanımlı değil — duyuru yayınlayamazsınız")
            payload.target_type = "company"
            payload.target_value = own
        if payload.target_value not in eff:
            raise HTTPException(status_code=403, detail="Yalnızca kendi şirketiniz için duyuru yayınlayabilirsiniz")

    # ----------------- ADMIN: publish -----------------
    @router.post("", response_model=Announcement)
    async def create_announcement(payload: AnnouncementCreate, user: dict = Depends(current_user_dep)):
        require_admin(user)
        _validate_create(payload)
        _scope_create_for_admin(user, payload)
        ann = Announcement(
            title=payload.title.strip(),
            message=payload.message.strip(),
            severity=payload.severity,
            target_type=payload.target_type,
            target_value=payload.target_value,
            require_ack=bool(payload.require_ack),
            expires_at=payload.expires_at,
            created_by=user["id"],
            created_by_username=user.get("username"),
        )
        await db.announcements.insert_one(ann.model_dump())
        # Fan-out via SSE — best effort. Users offline right now will pick
        # up the banner on next mount via GET /announcements/active.
        target_ids: List[str] = []
        try:
            target_ids = await _resolve_target_user_ids(db, ann.model_dump())
            sse_event = {
                "kind": "announcement",
                "announcement": ann.model_dump(),
            }
            for uid in target_ids:
                try:
                    await notif_pubsub.publish(uid, sse_event)
                except Exception:  # pragma: no cover
                    logger.warning("announcement SSE push failed for uid=%s", uid)
        except Exception as exc:  # pragma: no cover
            logger.warning("announcement fan-out skipped: %s", exc)
        # Faz 9 CP7 — parallel FCM push (offline mobile users). Best effort;
        # missing SA JSON → no-op.
        if target_ids:
            try:
                await fcm_service.send_to_users(
                    db,
                    target_ids,
                    title=f"[{ann.severity.upper()}] {ann.title}",
                    body=ann.message[:180],
                    data={
                        "kind": "announcement",
                        "announcement_id": ann.id,
                        "severity": ann.severity,
                    },
                )
            except Exception as exc:  # pragma: no cover
                logger.warning("announcement FCM fan-out skipped: %s", exc)
        return ann

    # ----------------- ADMIN: list all -----------------
    @router.get("", response_model=List[Announcement])
    async def list_announcements(user: dict = Depends(current_user_dep)):
        require_admin(user)
        if is_super_admin(user):
            q: dict = {}
        else:
            eff = admin_effective_company_ids(user)
            q = {"$or": [
                {"created_by": user["id"]},
                {"target_type": "company", "target_value": {"$in": eff}},
            ]}
        cur = db.announcements.find(q, {"_id": 0}).sort("created_at", -1)
        return [doc async for doc in cur]

    # ----------------- USER: active (targeted at me) -----------------
    @router.get("/active", response_model=List[dict])
    async def list_active_for_me(user: dict = Depends(current_user_dep)):
        """Return active announcements targeted at the current user, enriched
        with an `acked` boolean. Client should render un-acked ones as banners.
        """
        cur = db.announcements.find({"is_active": True}, {"_id": 0}).sort("created_at", -1)
        my_acks_cur = db.announcement_acks.find({"user_id": user["id"]}, {"_id": 0, "announcement_id": 1})
        acked_ids = {a["announcement_id"] async for a in my_acks_cur}
        out: List[dict] = []
        async for ann in cur:
            if _is_expired(ann):
                continue
            if not _matches_target(ann, user):
                continue
            enriched = dict(ann)
            enriched["acked"] = ann["id"] in acked_ids
            out.append(enriched)
        return out

    # ----------------- USER: acknowledge -----------------
    @router.post("/{aid}/ack")
    async def ack_announcement(aid: str = Path(...), user: dict = Depends(current_user_dep)):
        ann = await _load_or_404(aid)
        if not _matches_target(ann, user):
            raise HTTPException(status_code=403, detail="Bu duyuru sizin için değil")
        existing = await db.announcement_acks.find_one(
            {"announcement_id": aid, "user_id": user["id"]},
            {"_id": 0, "id": 1},
        )
        if existing:
            return {"ok": True, "already": True}
        await db.announcement_acks.insert_one({
            "id": str(uuid.uuid4()),
            "announcement_id": aid,
            "user_id": user["id"],
            "user_username": user.get("username"),
            "acked_at": _now_iso(),
        })
        return {"ok": True, "already": False}

    # ----------------- ADMIN: update -----------------
    @router.patch("/{aid}", response_model=Announcement)
    async def update_announcement(
        aid: str,
        payload: AnnouncementUpdate,
        user: dict = Depends(current_user_dep),
    ):
        require_admin(user)
        current = await _load_or_404(aid)
        _assert_manage_ann(user, current)
        # Validate incoming diff against the same rules as create.
        merged = {**current, **{k: v for k, v in payload.model_dump(exclude_none=True).items()}}
        if not is_super_admin(user):
            eff = set(admin_effective_company_ids(user))
            if merged.get("target_type") != "company" or merged.get("target_value") not in eff:
                raise HTTPException(status_code=403, detail="Yönetici yalnızca kendi şirket duyurusunu düzenleyebilir")
        # Re-run the shared validator on the merged doc.
        check = AnnouncementCreate(
            title=merged.get("title", ""),
            message=merged.get("message", ""),
            severity=merged.get("severity", "info"),
            target_type=merged.get("target_type", "all"),
            target_value=merged.get("target_value"),
            require_ack=bool(merged.get("require_ack", False)),
            expires_at=merged.get("expires_at"),
        )
        _validate_create(check)
        patch = payload.model_dump(exclude_none=True)
        patch["updated_at"] = _now_iso()
        await db.announcements.update_one({"id": aid}, {"$set": patch})
        return await _load_or_404(aid)

    # ----------------- ADMIN: delete (soft) -----------------
    @router.delete("/{aid}")
    async def delete_announcement(aid: str, user: dict = Depends(current_user_dep)):
        require_admin(user)
        ann = await _load_or_404(aid)
        _assert_manage_ann(user, ann)
        # Soft delete: flip is_active so historical audit stays intact.
        await db.announcements.update_one(
            {"id": aid},
            {"$set": {"is_active": False, "updated_at": _now_iso()}},
        )
        return {"ok": True}

    # ----------------- ADMIN: hard delete + stats -----------------
    @router.delete("/{aid}/purge")
    async def purge_announcement(aid: str, user: dict = Depends(current_user_dep)):
        require_admin(user)
        ann = await _load_or_404(aid)
        _assert_manage_ann(user, ann)
        r = await db.announcements.delete_one({"id": aid})
        if r.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Duyuru bulunamadı")
        await db.announcement_acks.delete_many({"announcement_id": aid})
        return {"ok": True}

    @router.get("/{aid}/stats")
    async def announcement_stats(aid: str, user: dict = Depends(current_user_dep)):
        require_admin(user)
        ann = await _load_or_404(aid)
        _assert_manage_ann(user, ann)
        target_ids = await _resolve_target_user_ids(db, ann)
        ack_count = await db.announcement_acks.count_documents({"announcement_id": aid})
        return {
            "announcement_id": aid,
            "target_count": len(target_ids),
            "ack_count": ack_count,
            "ack_ratio": (ack_count / len(target_ids)) if target_ids else 0.0,
        }

    return router
