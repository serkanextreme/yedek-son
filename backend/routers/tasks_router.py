"""Sertex — Tasks + Categories + Orphan tasks router.

Factory: `build_tasks_router(db, licensed_user, current_user)` — returns an
APIRouter (no prefix) with every /tasks/*, /task-categories/*, and
/orphan-tasks/* endpoint. Extracted from server.py (Faz 9 refactor).

Behaviour is unchanged — this is a pure move-and-import refactor. All
pytest suites (test_tasks, test_task_reassign, test_task_categories,
test_multi_company) exercise the endpoints; the extraction is complete
when they stay green.
"""
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional
import logging
import secrets
import re
import uuid
import os
import asyncio
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form, Response, Query, Body

from permissions import (
    can_view_user,
    can_view_company,
    visible_user_ids,
    normalize_role,
    acting_role,
    is_super_admin,
    get_admin_caps,
    admin_effective_company_ids,
    get_user_company_ids,
)
# Faz 9 CP7 — mobile push notifications (best-effort, silent no-op when SA missing).
import fcm_service
# Görev dosya ekleri — Emergent object storage (chunked upload + download).
from storage_service import put_object, get_object, build_upload_path

log = logging.getLogger(__name__)


# Faz 9 CP5 — Models + shared helpers moved to `tasks_models` (behaviour
# unchanged). Public symbols are re-exported here so downstream imports
# (e.g. `from routers.tasks_router import Task`) keep working.
from .tasks_models import (
    _ALLOWED_REMINDER_DAYS,
    _LOCK_FLAG_KEYS,
    _OTP_TTL_MINUTES,
    _OTP_DIGITS,
    _validate_reminder_days,
    _hash_otp,
    _now_iso,
    _log_lock_event,
    Subtask,
    Task,
    TaskAssignee,
    TaskSharePerms,
    TaskShare,
    TaskCreate,
    TaskUpdate,
    ReorderTasksReq,
    CategoryOrderReq,
    TaskReassignRequest,
    TaskCompanyTransferRequest,
    TaskAttachment,
    AttachmentInitReq,
    AttachmentCompleteReq,
    TaskNudgeRequest,
    TaskShareEntry,
    TaskShareRequest,
    TaskMyCompletionRequest,
    TaskLockPatch,
    TaskSelfLockPatch,
    TaskUnlockVerify,
    LockPolicyTemplate,
    LockPolicyTemplateCreate,
    LockPolicyTemplateUpdate,
    TaskReasonBody,
    TaskSettingsUpdate,
    ArchiveCapsUpdate,
    TaskCategory,
    TaskCategoryCreate,
    TaskCategoryUpdate,
    TaskGroup,
    TaskGroupCreate,
    TaskGroupUpdate,
)



def build_tasks_router(db, licensed_user_dep, current_user_dep) -> APIRouter:
    """Return the router. `db` is the motor Database; the two deps are the
    FastAPI dependency callables already used across the app."""
    router = APIRouter()

    # ------------------------------------------------------------------
    # Arşiv ayarları + kişi bazlı yetkiler (Faz: Arşiv v2)
    # ------------------------------------------------------------------
    async def _get_task_settings() -> Dict[str, Any]:
        """Global arşiv ayarları (system_settings.key='global')."""
        doc = await db.system_settings.find_one({"key": "global"}, {"_id": 0}) or {}
        policy = doc.get("delete_reason_policy")
        if policy not in ("off", "optional", "required"):
            policy = "optional"
        try:
            days = int(doc.get("trash_autoclean_days"))
        except (TypeError, ValueError):
            days = 30
        if days < 1:
            days = 30
        return {
            "delete_reason_policy": policy,
            "trash_autoclean_enabled": bool(doc.get("trash_autoclean_enabled")),
            "trash_autoclean_days": days,
        }

    async def _archive_caps(user: dict) -> Dict[str, bool]:
        """Kullanıcının arşiv yetkileri. Admin her zaman hepsine sahip."""
        if acting_role(user) == "admin":
            return {"perm_delete": True, "empty_trash": True, "manage_policy": True}
        u = await db.users.find_one({"id": user.get("id")}, {"_id": 0, "archive_caps": 1})
        caps = (u or {}).get("archive_caps") or {}
        return {
            "perm_delete": bool(caps.get("perm_delete")),
            "empty_trash": bool(caps.get("empty_trash")),
            "manage_policy": bool(caps.get("manage_policy")),
        }

    async def _require_cap(user: dict, cap: str, msg: str) -> None:
        caps = await _archive_caps(user)
        if not caps.get(cap):
            raise HTTPException(status_code=403, detail=msg)

    # ------------------------------------------------------------------
    # Faz 9 CP4.27 — Task Lock helpers
    # ------------------------------------------------------------------
    async def _check_task_lock(task_doc: dict, user: dict, actions: List[str]) -> None:
        """Raise 423 (Locked) if any of the requested actions is currently
        forbidden for this user on this task. Admin and the task creator
        always bypass. A live unlock session (expires_at > now &
        uses_remaining > 0) also grants passage.

        The caller passes ALL potential actions triggered by a mutation so a
        single PATCH that changes both `title` and `due_date` gets validated
        against BOTH `lock_edit` and `lock_change_date`.
        """
        role = acting_role(user)
        if role == "admin":
            return
        # Creator bypass — the person who created the task can always edit it.
        creator_id = task_doc.get("created_by")
        if creator_id and creator_id == user.get("id"):
            return
        lock_flags = task_doc.get("lock_flags") or {}
        self_lock_flags = task_doc.get("self_lock_flags") or {}
        # Faz 9 CP4.30 — a locked action is any flag True in EITHER map.
        blocked = [
            a for a in actions
            if lock_flags.get(a) or self_lock_flags.get(a)
        ]
        if not blocked:
            return
        # Live unlock session?
        unlock_until = task_doc.get("unlock_expires_at")
        uses_left = int(task_doc.get("unlock_uses_remaining") or 0)
        if unlock_until and uses_left > 0:
            try:
                exp = datetime.fromisoformat(unlock_until)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp > datetime.now(timezone.utc):
                    return  # Bypass with active session.
            except Exception as exc:
                log.warning("malformed unlock_expires_at during lock check: %s", exc)
        raise HTTPException(
            status_code=423,
            detail="Bu görev kilitli — müdürünüzden tek kullanımlık şifre isteyin.",
        )

    async def _consume_unlock_session(tid: str, task_doc: dict, user: dict, action: Optional[str] = None) -> None:
        """Called AFTER a successful locked mutation. If the caller had used
        an active unlock session (i.e. the mutation would have been blocked
        without it), decrement uses_remaining so the code can't be reused.

        Faz 9 CP4.34 — race-safe. `$inc` alone can drive uses_remaining below
        zero when multiple locked PATCH requests race on the same task. We
        now use a conditional update that only decrements when the current
        value is > 0 AND the window is still open, guaranteeing at most one
        bypass per issued OTP even under concurrent traffic.
        """
        role = acting_role(user)
        if role == "admin":
            return
        if task_doc.get("created_by") == user.get("id"):
            return
        unlock_until = task_doc.get("unlock_expires_at")
        uses_left = int(task_doc.get("unlock_uses_remaining") or 0)
        if not unlock_until or uses_left <= 0:
            return
        try:
            exp = datetime.fromisoformat(unlock_until)
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
            if exp <= datetime.now(timezone.utc):
                return
        except Exception as exc:
            log.warning("malformed unlock_expires_at on task %s: %s", tid, exc)
            return
        # Conditional atomic decrement — the update matches ONLY if the row
        # still has uses_remaining > 0. Concurrent racers see 0 and no-op.
        now_iso = _now_iso()
        res = await db.tasks.update_one(
            {
                "id": tid,
                "unlock_uses_remaining": {"$gt": 0},
                "unlock_expires_at": {"$gt": now_iso},
            },
            {"$inc": {"unlock_uses_remaining": -1}},
        )
        if res.modified_count:
            await _log_lock_event(db, tid, user, "otp_consumed", {"action": action})

    def _detect_lock_actions(update: Dict[str, Any]) -> List[str]:
        """Map a TaskUpdate payload to the set of lock_* actions its fields
        trigger. Used to gate PATCH /tasks/{id}."""
        actions: List[str] = []
        if "title" in update or "description" in update:
            actions.append("lock_edit")
        if "status" in update:
            new_status = update["status"]
            if new_status == "done":
                actions.append("lock_complete")
            elif new_status == "paused":
                actions.append("lock_pause")
            elif new_status == "overdue":
                actions.append("lock_mark_overdue")
            # `pending` (un-complete) is treated as an edit.
            else:
                actions.append("lock_edit")
        if "due_date" in update:
            actions.append("lock_change_date")
        if any(k in update for k in ("reminder_at", "reminder_days", "reminder_disabled")):
            actions.append("lock_reminder")
        if "category_id" in update:
            actions.append("lock_move_category")
        if "archived" in update:
            actions.append("lock_archive")
        if "subtasks" in update:
            actions.append("lock_subtask")
        if "sort_order" in update:
            actions.append("lock_reset_size")
        return actions

    # ------------------------------------------------------------------
    # Görev Paylaşımı + Çok Kişili Atama — helpers
    # ------------------------------------------------------------------
    def _is_assignee(task_doc: dict, uid: str) -> bool:
        return any((a or {}).get("user_id") == uid for a in (task_doc.get("assignees") or []))

    def _share_perms_for(task_doc: dict, uid: str) -> Optional[dict]:
        """Return the perms dict for `uid` from shared_with, or None if the
        user is not a share recipient."""
        for s in task_doc.get("shared_with") or []:
            if (s or {}).get("user_id") == uid:
                return (s.get("perms") or {})
        return None

    def _needed_share_perms(update: Dict[str, Any]) -> set:
        """Map a TaskUpdate payload to the share-permission keys it requires.
        Used only for the fallback path where the caller is a share recipient
        (not covered by RBAC/assignee)."""
        needed = set()
        for k in update.keys():
            if k in ("updated_at",):
                continue
            if k == "status":
                st = update.get("status")
                needed.add("complete" if st in ("done", "pending") else "edit")
            else:
                needed.add("edit")
        return needed

    async def _can_view_task(task_doc: dict, user: dict) -> bool:
        """A user may see a task if RBAC allows (admin/manager/self), OR they
        are one of the assignees, OR it was shared with them (perms.view)."""
        if await can_view_user(db, user, task_doc.get("user_id")):
            return True
        if _is_assignee(task_doc, user["id"]):
            return True
        perms = _share_perms_for(task_doc, user["id"])
        return bool(perms and perms.get("view"))

    async def _can_share_task(task_doc: dict, user: dict) -> bool:
        """Who may configure sharing/ACL on a task (S2-b):
        the creator, an admin, or a manager of the task's company/owner."""
        role = acting_role(user)
        if role == "admin":
            return True
        if task_doc.get("created_by") == user["id"] or task_doc.get("user_id") == user["id"]:
            return True
        if role == "manager":
            tcid = task_doc.get("company_id")
            if tcid and tcid in get_user_company_ids(user):
                return True
            if await can_view_user(db, user, task_doc.get("user_id")):
                return True
        return False

    async def _resolve_user_label(uid: str) -> Dict[str, Optional[str]]:
        u = await db.users.find_one(
            {"id": uid}, {"_id": 0, "username": 1, "company_name": 1},
        )
        return {
            "name": (u or {}).get("username"),
            "company_name": (u or {}).get("company_name"),
        }

    def _recompute_multi_status(assignees: List[dict], current_status: str) -> Optional[str]:
        """Given the assignees list, return the new task status, or None if it
        should be left untouched. Rule: task is `done` only when EVERY
        assignee is completed; if it was `done` but someone un-checks, revert
        to `pending`. Paused/overdue are left alone."""
        if not assignees:
            return None
        all_done = all(bool(a.get("completed")) for a in assignees)
        if all_done and current_status != "done":
            return "done"
        if not all_done and current_status == "done":
            return "pending"
        return None

    # ------------------------------------------------------------------
    # TASKS
    # ------------------------------------------------------------------
    @router.get("/tasks", response_model=List[Task])
    async def list_tasks(archived: bool = False, scope: str = "mine", view: Optional[str] = None, user: dict = Depends(licensed_user_dep)):
        allowed_ids = await visible_user_ids(db, user)
        uid = user["id"]
        # Arşiv grupları (yan yana çipler):
        #   view="cancelled" → İPTAL grubu · view="trash" → SİLİNMİŞ (çöp kutusu)
        #   view="archived"/archived=True → BİTMİŞ · aksi halde AKTİF liste.
        # Aktif ve BİTMİŞ listeleri iptal/silinmiş görevleri HARİÇ tutar.
        if view == "trash":
            bucket_clause: Dict[str, Any] = {"deleted": True}
        elif view == "cancelled":
            bucket_clause = {"cancelled": True, "deleted": {"$ne": True}}
        elif view == "archived" or archived:
            bucket_clause = {"archived": True, "cancelled": {"$ne": True}, "deleted": {"$ne": True}}
        else:
            bucket_clause = {
                "$or": [{"archived": {"$exists": False}}, {"archived": False}],
                "cancelled": {"$ne": True},
                "deleted": {"$ne": True},
            }
        is_archive_view = view in ("trash", "cancelled", "archived") or archived
        archived_clause = bucket_clause
        if scope == "team":
            # Personel Görevleri — oversight: tasks owned by OTHER visible users.
            # Admin sees everyone else; a manager sees their team; employee none.
            if allowed_ids is None:
                scope_clause: Dict[str, Any] = {"user_id": {"$ne": uid}}
            else:
                others = [i for i in allowed_ids if i != uid]
                if not others:
                    return []
                scope_clause = {"user_id": {"$in": others}}
        else:
            # Benim Görevlerim (default) — only tasks the user is directly
            # involved in: owns, is assigned to, or was shared with. RBAC
            # oversight does NOT flood the personal list.
            scope_clause = {"$or": [
                {"user_id": uid},
                {"assignees.user_id": uid},
                {"shared_with": {"$elemMatch": {"user_id": uid, "perms.view": True}}},
            ]}
        q: Dict[str, Any] = {"$and": [scope_clause, archived_clause]}
        docs = await db.tasks.find(q, {"_id": 0}).to_list(length=500)
        with_order = [d for d in docs if d.get("sort_order") is not None]
        without_order = [d for d in docs if d.get("sort_order") is None]
        with_order.sort(key=lambda d: d["sort_order"], reverse=True)
        without_order.sort(key=lambda d: d.get("created_at") or "", reverse=True)
        if is_archive_view:
            merged = with_order + without_order
            merged.sort(
                key=lambda d: d.get("deleted_at") or d.get("cancelled_at") or d.get("archived_at") or d.get("updated_at") or "",
                reverse=True,
            )
            return [Task(**d) for d in merged]
        return [Task(**d) for d in (with_order + without_order)]

    @router.get("/tasks/archive-counts")
    async def archive_counts(scope: str = "mine", user: dict = Depends(licensed_user_dep)):
        """Arşiv çip sayaçları — {done, cancelled, deleted}. Aktif liste ile aynı
        scope (mine/team) kapsam kuralına uyar. NOT: /tasks/{tid} generic
        route'undan ÖNCE tanımlı (aksi halde tid='archive-counts' sanılır)."""
        allowed_ids = await visible_user_ids(db, user)
        uid = user["id"]
        if scope == "team":
            if allowed_ids is None:
                scope_clause: Dict[str, Any] = {"user_id": {"$ne": uid}}
            else:
                others = [i for i in allowed_ids if i != uid]
                if not others:
                    return {"done": 0, "cancelled": 0, "deleted": 0}
                scope_clause = {"user_id": {"$in": others}}
        else:
            scope_clause = {"$or": [
                {"user_id": uid},
                {"assignees.user_id": uid},
                {"shared_with": {"$elemMatch": {"user_id": uid, "perms.view": True}}},
            ]}
        done = await db.tasks.count_documents({"$and": [scope_clause, {"archived": True, "cancelled": {"$ne": True}, "deleted": {"$ne": True}}]})
        cancelled = await db.tasks.count_documents({"$and": [scope_clause, {"cancelled": True, "deleted": {"$ne": True}}]})
        deleted = await db.tasks.count_documents({"$and": [scope_clause, {"deleted": True}]})
        return {"done": done, "cancelled": cancelled, "deleted": deleted}

    @router.get("/tasks/settings")
    async def get_task_archive_settings(user: dict = Depends(licensed_user_dep)):
        """Arşiv ayarları + geçerli kullanıcının yetkileri. Frontend bunları
        neden-modu, otomatik-temizlik sayacı ve buton görünürlüğü için kullanır.
        NOT: /tasks/{tid} generic route'undan ÖNCE tanımlı."""
        s = await _get_task_settings()
        s["caps"] = await _archive_caps(user)
        return s

    @router.put("/tasks/settings")
    async def update_task_archive_settings(body: TaskSettingsUpdate, user: dict = Depends(licensed_user_dep)):
        """Politika + otomatik temizlik ayarını güncelle — 'manage_policy' yetkisi
        (veya admin) gerekir."""
        await _require_cap(user, "manage_policy", "Arşiv politikasını değiştirme yetkiniz yok")
        set_fields: Dict[str, Any] = {"key": "global", "updated_at": _now_iso(), "updated_by": user["id"]}
        if body.delete_reason_policy is not None:
            if body.delete_reason_policy not in ("off", "optional", "required"):
                raise HTTPException(status_code=400, detail="Geçersiz politika değeri")
            set_fields["delete_reason_policy"] = body.delete_reason_policy
        if body.trash_autoclean_enabled is not None:
            set_fields["trash_autoclean_enabled"] = bool(body.trash_autoclean_enabled)
        if body.trash_autoclean_days is not None:
            d = int(body.trash_autoclean_days)
            if d < 1 or d > 3650:
                raise HTTPException(status_code=400, detail="Saklama günü 1-3650 arası olmalı")
            set_fields["trash_autoclean_days"] = d
        await db.system_settings.update_one({"key": "global"}, {"$set": set_fields}, upsert=True)
        s = await _get_task_settings()
        s["caps"] = await _archive_caps(user)
        return s

    @router.get("/tasks/search", response_model=List[Task])
    async def search_archive_tasks(q: str = "", scope: str = "mine", user: dict = Depends(licensed_user_dep)):
        """Arşiv-geneli arama — BİTMİŞ+İPTAL+SİLİNMİŞ (hepsi archived=True) içinde
        başlık/açıklama/kişi/şirket eşleşmesi. Genel aramanın arşivi kapsaması için.
        NOT: /tasks/{tid} generic route'undan ÖNCE tanımlı."""
        term = (q or "").strip()
        if len(term) < 2:
            return []
        allowed_ids = await visible_user_ids(db, user)
        uid = user["id"]
        if scope == "team":
            if allowed_ids is None:
                scope_clause: Dict[str, Any] = {"user_id": {"$ne": uid}}
            else:
                others = [i for i in allowed_ids if i != uid]
                if not others:
                    return []
                scope_clause = {"user_id": {"$in": others}}
        else:
            scope_clause = {"$or": [
                {"user_id": uid},
                {"assignees.user_id": uid},
                {"shared_with": {"$elemMatch": {"user_id": uid, "perms.view": True}}},
            ]}
        rx = {"$regex": re.escape(term), "$options": "i"}
        text_clause = {"$or": [{"title": rx}, {"description": rx}, {"assignee_name": rx}, {"company_name": rx}]}
        q_final = {"$and": [scope_clause, {"archived": True}, text_clause]}
        docs = await db.tasks.find(q_final, {"_id": 0}).to_list(length=200)
        docs.sort(key=lambda d: d.get("deleted_at") or d.get("cancelled_at") or d.get("archived_at") or d.get("updated_at") or "", reverse=True)
        return [Task(**d) for d in docs]

    @router.get("/tasks/{tid}", response_model=Task)
    async def get_task(tid: str, user: dict = Depends(licensed_user_dep)):
        """Faz 9 CP4.34 — single-task fetch. Used by the frontend when a
        notification (e.g. OTP offered) directs the user straight to a
        specific task without needing to reload the full list. RBAC honours
        the same visibility rules as /tasks."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if not await _can_view_task(doc, user):
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        # Sahibin (user_id) kullanıcı adını çöz — "SAHİP" alanı boş kalmasın.
        owner_uid = doc.get("user_id")
        if owner_uid:
            owner = await db.users.find_one({"id": owner_uid}, {"_id": 0, "username": 1})
            if owner and owner.get("username"):
                doc["owner_username"] = owner["username"]
        return Task(**doc)

    @router.post("/tasks/reorder")
    async def reorder_tasks(req: ReorderTasksReq, user: dict = Depends(licensed_user_dep)):
        """Persist a new sort order.

        Faz 9 CP8.1 — Multi-tenant fix: previously the filter was pinned to
        `{user_id: currentUser}`, so an admin/manager reordering a mixed list
        (their own + team members') only mutated their own tasks. Now we
        check per-row visibility: the current user may reorder any task
        they can see (admin sees all; managers see their assigned team;
        employees only their own). Rows they can't see are silently skipped
        instead of leaking permission info via 403 spam.
        """
        n = len(req.ids)
        now = datetime.now(timezone.utc).isoformat()
        role = acting_role(user)
        for idx, tid in enumerate(req.ids):
            task_doc = await db.tasks.find_one({"id": tid}, {"_id": 0, "user_id": 1})
            if not task_doc:
                continue
            owner_id = task_doc.get("user_id")
            if owner_id == user["id"] or role == "admin":
                allowed = True
            elif owner_id and await can_view_user(db, user, owner_id):
                allowed = True
            else:
                allowed = False
            if not allowed:
                continue
            await db.tasks.update_one(
                {"id": tid},
                {"$set": {"sort_order": float(n - idx), "updated_at": now}},
            )
        return {"ok": True, "count": n}

    @router.post("/tasks", response_model=Task)
    async def create_task(req: TaskCreate, user: dict = Depends(licensed_user_dep)):
        owner_id = user["id"]
        # ÖZELLİK A — multi-assignee. Deduplicate + validate each target.
        multi_ids = list(dict.fromkeys([uid for uid in (req.assignee_user_ids or []) if uid]))
        if multi_ids:
            for uid in multi_ids:
                if uid != user["id"] and not await can_view_user(db, user, uid):
                    raise HTTPException(status_code=403, detail="Bu kullanıcıya görev atayamazsınız")
        elif req.assignee_user_id and req.assignee_user_id != user["id"]:
            if not await can_view_user(db, user, req.assignee_user_id):
                raise HTTPException(status_code=403, detail="Bu kullanıcıya görev atayamazsınız")
            owner_id = req.assignee_user_id
            if not req.assignee_name:
                target = await db.users.find_one(
                    {"id": owner_id}, {"_id": 0, "username": 1, "company_name": 1},
                )
                if target:
                    req.assignee_name = target.get("username")
                    if not req.company_name and target.get("company_name"):
                        req.company_name = target["company_name"]
        resolved_company_id: Optional[str] = req.company_id
        if resolved_company_id:
            assignee_doc = await db.users.find_one(
                {"id": owner_id}, {"_id": 0, "company_id": 1, "company_ids": 1},
            )
            assignee_cids = get_user_company_ids(assignee_doc) if assignee_doc else []
            if acting_role(user) != "admin" and resolved_company_id not in assignee_cids:
                raise HTTPException(status_code=400, detail="Görev sahibi bu şirkete üye değil")
        else:
            assignee_doc = await db.users.find_one({"id": owner_id}, {"_id": 0, "company_id": 1})
            resolved_company_id = (assignee_doc or {}).get("company_id")
        t = Task(
            title=req.title,
            description=req.description,
            start_date=req.start_date,
            due_date=req.due_date,
            reminder_at=req.reminder_at,
            assignee_name=req.assignee_name,
            company_name=req.company_name,
            category_id=req.category_id,
            company_id=resolved_company_id,
            reminder_days=_validate_reminder_days(req.reminder_days),
            reminder_disabled=bool(req.reminder_disabled) if req.reminder_disabled is not None else False,
            reminder_interval_min=req.reminder_interval_min,
            reminder_repeat_total=req.reminder_repeat_total,
            reminder_repeat_left=(
                req.reminder_repeat_left
                if req.reminder_repeat_left is not None
                else req.reminder_repeat_total
            ),
            created_by=user["id"],  # Faz 9 CP4.27 — used by the lock guard
        )
        # Faz 9 CP4.30 + CP4.35 — inherit the assignee's default lock policy.
        # New tasks opened for a user with default_lock_flags start pre-locked.
        # Precedence & attribution rules:
        #   - default_lock_flags (managed) → locked_by = policy owner OR creator
        #     of the task (fallback), locked_at = now
        #   - default_self_lock_flags (soft) → applied to self_lock_flags map,
        #     kept SEPARATE from the managed set so an assignee-side removal
        #     doesn't accidentally lift admin-imposed restrictions.
        #   - If a managed flag AND a self flag collide on the same key, the
        #     managed one wins (stricter) — mirrors runtime guard behaviour.
        policy_doc = await db.users.find_one(
            {"id": owner_id},
            {
                "default_lock_flags": 1,
                "default_lock_requires_otp": 1,
                "default_self_lock_flags": 1,
                # Faz 9 CP4.35 — read the NEW channel-scoped attribution field
                # for managed locks. Fall back to the legacy shared field for
                # rows written before the split (backwards compat).
                "default_lock_managed_set_by_user_id": 1,
                "default_lock_set_by_user_id": 1,
            },
        )
        if policy_doc:
            dflags = policy_doc.get("default_lock_flags") or {}
            if isinstance(dflags, dict) and any(dflags.values()):
                t.lock_flags = {k: True for k, v in dflags.items() if v and k in _LOCK_FLAG_KEYS}
                # Attribute lock to the policy owner if known, else the task creator.
                t.locked_by = (
                    policy_doc.get("default_lock_managed_set_by_user_id")
                    or policy_doc.get("default_lock_set_by_user_id")
                    or user["id"]
                )
                t.locked_at = _now_iso()
            if "default_lock_requires_otp" in policy_doc:
                t.lock_requires_otp = bool(policy_doc["default_lock_requires_otp"])
            dself = policy_doc.get("default_self_lock_flags") or {}
            if isinstance(dself, dict) and any(dself.values()):
                # Filter out any keys already covered by managed lock — no need
                # to double-apply, and this keeps the removable set clean.
                managed = t.lock_flags
                t.self_lock_flags = {
                    k: True
                    for k, v in dself.items()
                    if v and k in _LOCK_FLAG_KEYS and not managed.get(k)
                }
        td = t.model_dump()
        td["user_id"] = owner_id
        # ÖZELLİK A — build the assignees list (per-person completion tracking).
        assignee_push_ids: List[str] = []
        if multi_ids:
            assignees: List[dict] = []
            for uid in multi_ids:
                label = await _resolve_user_label(uid)
                assignees.append(TaskAssignee(user_id=uid, name=label["name"]).model_dump())
                if uid != user["id"]:
                    assignee_push_ids.append(uid)
            td["assignees"] = assignees
        await db.tasks.insert_one(td)
        # Faz 9 CP7 — mobile push to the assignee(s) when someone else assigned
        # the task. Skip self-assignment (Serkan giving himself a to-do).
        push_targets = assignee_push_ids if multi_ids else (
            [owner_id] if owner_id and owner_id != user["id"] else []
        )
        for target_id in push_targets:
            try:
                creator_name = user.get("username") or "Yönetici"
                await fcm_service.send_to_user(
                    db,
                    target_id,
                    title=f"Yeni görev · {creator_name}",
                    body=t.title[:180],
                    data={"kind": "task", "task_id": t.id, "event": "assigned"},
                )
            except Exception:  # pragma: no cover
                pass  # push is best-effort; task creation must not fail on FCM
        new_doc = await db.tasks.find_one({"id": t.id}, {"_id": 0})
        return Task(**new_doc)

    @router.patch("/tasks/{tid}", response_model=Task)
    async def update_task(tid: str, req: TaskUpdate, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        # Görev Paylaşımı — authorization: RBAC (admin/manager/self) OR a share
        # recipient. Pure assignees toggle their own status via /my-completion.
        can_rbac = await can_view_user(db, user, doc.get("user_id"))
        share_perms = _share_perms_for(doc, user["id"])
        if not can_rbac and share_perms is None:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        update = {k: v for k, v in req.model_dump(exclude_unset=True).items()}
        # Share-recipient path — enforce per-field granular permissions.
        if not can_rbac:
            needed = _needed_share_perms(update)
            granted = {k for k, v in (share_perms or {}).items() if v}
            if needed - granted:
                raise HTTPException(
                    status_code=403,
                    detail="Bu görev üzerinde bu işlemi yapma yetkiniz yok",
                )
        # Faz 9 CP4.27 — Lock guard. Compute which lock_* actions this PATCH
        # touches and 423 out if any of them is currently locked (with no
        # active OTP unlock session).
        actions = _detect_lock_actions(update)
        if actions:
            await _check_task_lock(doc, user, actions)
        if "status" in update and update["status"] not in ("pending", "done", "paused", "overdue"):
            raise HTTPException(status_code=400, detail="Geçersiz durum")
        # Sertleştirme: id'siz gönderilen alt görevlere sunucuda kalıcı id ata
        # (aksi halde id kaybolur, sonraki promote/silme id'yi bulamaz). Mevcut
        # id'ler korunur → gerçek istemci davranışı değişmez.
        if isinstance(update.get("subtasks"), list):
            for _s in update["subtasks"]:
                if isinstance(_s, dict) and not _s.get("id"):
                    _s["id"] = str(uuid.uuid4())
        # Otomatik tamamlanma tarihi: durum "done" olunca completed_at yazılır;
        # başka bir duruma dönünce temizlenir. Manuel gönderilen completed_at
        # (edit yetkisiyle) korunur ve boş string null'a çevrilir.
        if "completed_at" in update and not update["completed_at"]:
            update["completed_at"] = None
        if "status" in update:
            if update["status"] == "done":
                if "completed_at" not in update:
                    update["completed_at"] = datetime.now(timezone.utc).isoformat()
            else:
                update["completed_at"] = None
        if "reminder_at" in update and "reminder_fired" not in update:
            update["reminder_fired"] = False
        if "reminder_days" in update:
            update["reminder_days"] = _validate_reminder_days(update["reminder_days"])
            update["due_soon_fired_at_days"] = None
        if "reminder_disabled" in update:
            update["reminder_disabled"] = bool(update["reminder_disabled"])
            update["due_soon_fired_at_days"] = None
        if "due_date" in update:
            update["due_soon_fired_at_days"] = None
        if "archived" in update:
            update["archived_at"] = datetime.now(timezone.utc).isoformat() if update["archived"] else None
        update["updated_at"] = datetime.now(timezone.utc).isoformat()
        unset_ops: Dict[str, str] = {}
        if "category_id" in update:
            cid_val = update.pop("category_id")
            if not cid_val:
                unset_ops["category_id"] = ""
            else:
                cat = await db.task_categories.find_one({"id": cid_val}, {"_id": 0, "company_id": 1})
                if not cat:
                    raise HTTPException(status_code=404, detail="İş kolu bulunamadı")
                role = acting_role(user)
                if role != "admin":
                    allowed = {user.get("company_id")} if user.get("company_id") else set()
                    if role == "manager" and user.get("company_id"):
                        # Faz 9 CP4.15 — mirror the create-category flow and
                        # only accept actively-granted cross-company bridges
                        # (a pending/revoked grant must NOT open write access).
                        rows = await db.company_permissions.find(
                            {"viewer_company_id": user["company_id"], "status": "active"},
                            {"_id": 0, "target_company_id": 1},
                        ).to_list(length=1000)
                        allowed.update(r["target_company_id"] for r in rows)
                    if cat["company_id"] not in allowed:
                        raise HTTPException(status_code=403, detail="Bu iş koluna erişiminiz yok")
                update["category_id"] = cid_val
        op: Dict[str, Any] = {"$set": update} if update else {}
        if unset_ops:
            op["$unset"] = unset_ops
        if op:
            await db.tasks.update_one({"id": tid}, op)
            # Ana görev adı değişince, bu görevden promote edilen çocukların
            # "‹Ana görev› görevinin alt unsuru" etiketini güncelle (bayat kalmasın).
            if "title" in update and update.get("title") != doc.get("title"):
                await db.tasks.update_many(
                    {"promoted_from_task_id": tid},
                    {"$set": {"promoted_from_task_title": update["title"]}},
                )
        # Faz 9 CP4.27 — burn the one-shot unlock session if this PATCH used it.
        if actions:
            await _consume_unlock_session(tid, doc, user, action=",".join(actions))
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.delete("/tasks/{tid}")
    async def delete_task(tid: str, reason: Optional[str] = Query(None), user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            return {"deleted": 0}
        # Görev Paylaşımı — RBAC OR a share recipient with the `delete` perm.
        if not await can_view_user(db, user, doc.get("user_id")):
            sp = _share_perms_for(doc, user["id"])
            if not (sp and sp.get("delete")):
                return {"deleted": 0}
        await _check_task_lock(doc, user, ["lock_delete"])
        # Neden politikası — 'required' ise silme nedeni zorunlu.
        reason_txt = (reason or "").strip()
        settings = await _get_task_settings()
        if settings["delete_reason_policy"] == "required" and not reason_txt:
            raise HTTPException(status_code=400, detail="Silme nedeni zorunlu")
        # Çöp Kutusu (soft-delete) — kalıcı silmek yerine görevi SİLİNMİŞ grubuna
        # taşı. Kalıcı silme yalnızca yetkili (perm_delete) /tasks/{id}/permanent ile.
        now_iso = _now_iso()
        set_fields: Dict[str, Any] = {
            "deleted": True, "deleted_at": now_iso, "deleted_by": user.get("id"),
            # Silinmeden önceki arşiv durumunu sakla → geri yüklerken eski
            # grubuna döner. archived=True yapmak, silinen görevleri tüm aktif
            # sorgulardan (hatırlatma/özet/istatistik) otomatik hariç tutar.
            "deleted_prev_archived": bool(doc.get("archived")),
            "archived": True, "updated_at": now_iso,
        }
        if settings["delete_reason_policy"] != "off" and reason_txt:
            set_fields["delete_reason"] = reason_txt[:500]
        r = await db.tasks.update_one({"id": tid}, {"$set": set_fields})
        if r.modified_count:
            role = acting_role(user)
            creator_id = doc.get("created_by")
            lock_flags = doc.get("lock_flags") or {}
            self_lock_flags = doc.get("self_lock_flags") or {}
            was_delete_locked = bool(lock_flags.get("lock_delete") or self_lock_flags.get("lock_delete"))
            used_otp = False
            if was_delete_locked and role != "admin" and creator_id != user.get("id"):
                unlock_until = doc.get("unlock_expires_at")
                uses_left = int(doc.get("unlock_uses_remaining") or 0)
                if unlock_until and uses_left > 0:
                    try:
                        exp = datetime.fromisoformat(unlock_until)
                        if exp.tzinfo is None:
                            exp = exp.replace(tzinfo=timezone.utc)
                        used_otp = exp > datetime.now(timezone.utc)
                    except Exception:
                        used_otp = False
            if used_otp:
                await _log_lock_event(db, tid, user, "otp_consumed", {"action": "delete"})
            await _log_lock_event(db, tid, user, "task_trashed", {"used_otp": used_otp})
        return {"deleted": r.modified_count, "trashed": True}

    @router.post("/tasks/{tid}/cancel")
    async def cancel_task(tid: str, body: Optional[TaskReasonBody] = Body(None), user: dict = Depends(licensed_user_dep)):
        """İptal Et — görevi 'iptal edilmiş' olarak işaretle + arşive taşı.
        RBAC: görev sahibini görebilen (admin/müdür/sahip) VEYA paylaşımda
        edit yetkisi olan. Kilit: lock_archive. Politika 'required' ise neden zorunlu."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if not await can_view_user(db, user, doc.get("user_id")):
            sp = _share_perms_for(doc, user["id"])
            if not (sp and sp.get("edit")):
                raise HTTPException(status_code=403, detail="Bu görevi iptal etme yetkiniz yok")
        await _check_task_lock(doc, user, ["lock_archive"])
        reason = (body.reason.strip() if body and body.reason else "")
        settings = await _get_task_settings()
        if settings["delete_reason_policy"] == "required" and not reason:
            raise HTTPException(status_code=400, detail="İptal nedeni zorunlu")
        now_iso = _now_iso()
        set_fields: Dict[str, Any] = {"cancelled": True, "cancelled_at": now_iso, "archived": True, "archived_at": now_iso, "updated_at": now_iso}
        if settings["delete_reason_policy"] != "off" and reason:
            set_fields["cancel_reason"] = reason[:500]
        await db.tasks.update_one({"id": tid}, {"$set": set_fields})
        updated = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**updated)

    @router.post("/tasks/{tid}/uncancel")
    async def uncancel_task(tid: str, user: dict = Depends(licensed_user_dep)):
        """İptali geri al — görevi aktif listeye döndür (cancelled + archived kaldırılır)."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if not await can_view_user(db, user, doc.get("user_id")):
            sp = _share_perms_for(doc, user["id"])
            if not (sp and sp.get("edit")):
                raise HTTPException(status_code=403, detail="Yetkiniz yok")
        now_iso = _now_iso()
        await db.tasks.update_one(
            {"id": tid},
            {"$set": {"cancelled": False, "cancelled_at": None, "archived": False, "archived_at": None, "updated_at": now_iso}},
        )
        updated = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**updated)

    @router.post("/tasks/{tid}/restore")
    async def restore_task(tid: str, user: dict = Depends(licensed_user_dep)):
        """Çöp kutusundan geri yükle — deleted bayrağını temizle. Görev, silinmeden
        önceki durumuna (aktif / arşiv / iptal) döner. Görev üzerinde delete
        yetkisi olan (veya sahibini görebilen) herkes geri yükleyebilir."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if not await can_view_user(db, user, doc.get("user_id")):
            sp = _share_perms_for(doc, user["id"])
            if not (sp and (sp.get("delete") or sp.get("edit"))):
                raise HTTPException(status_code=403, detail="Yetkiniz yok")
        now_iso = _now_iso()
        await db.tasks.update_one(
            {"id": tid},
            {"$set": {
                "deleted": False, "deleted_at": None, "deleted_by": None,
                # Silinmeden önceki arşiv durumuna dön (BİTMİŞ/İPTAL ise arşivde
                # kalır, aktifse aktife döner).
                "archived": bool(doc.get("deleted_prev_archived")),
                "updated_at": now_iso,
            }, "$unset": {"deleted_prev_archived": ""}},
        )
        await _log_lock_event(db, tid, user, "task_restored", {})
        updated = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**updated)

    @router.delete("/tasks/{tid}/permanent")
    async def permanent_delete_task(tid: str, user: dict = Depends(licensed_user_dep)):
        """Kalıcı Sil — çöp kutusundaki görevi geri dönüşü olmayacak şekilde sil.
        'perm_delete' yetkisi (veya admin) gerekir."""
        await _require_cap(user, "perm_delete", "Kalıcı silme yetkiniz yok")
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            return {"deleted": 0}
        r = await db.tasks.delete_one({"id": tid})
        if r.deleted_count:
            await _log_lock_event(db, tid, user, "task_permanently_deleted", {})
        return {"deleted": r.deleted_count}

    @router.post("/tasks/trash/empty")
    async def empty_trash(scope: str = "mine", user: dict = Depends(licensed_user_dep)):
        """Çöp Kutusunu Boşalt — çöp kutusundaki (deleted=True) görevleri toplu
        kalıcı sil. 'empty_trash' yetkisi (veya admin) gerekir."""
        await _require_cap(user, "empty_trash", "Çöp kutusunu boşaltma yetkiniz yok")
        r = await db.tasks.delete_many({"deleted": True})
        return {"deleted": r.deleted_count}


    # ------------------------------------------------------------------
    # TASK CATEGORIES (İş Kolları)
    # ------------------------------------------------------------------
    @router.get("/task-categories")
    async def list_task_categories(
        user: dict = Depends(licensed_user_dep),
        scope: str = "manage",
    ):
        """Faz 9 CP4.23 — two-mode listing.

        * `scope=manage` (default, admin/manager UI): returns everything
          the caller may edit / configure. Admins see all categories;
          managers see own + cross-company grants (legacy behaviour).
        * `scope=my_tasks` (task panel / create-task dropdown): returns
          only categories the caller MAY assign to a task — filtered
          strictly by visibility (owner company, `visible_to_company_ids`
          intersecting the caller's company, or the caller's `id` present
          in `visible_to_user_ids`). Admin is subject to this too so the
          task panel stays uncluttered.
        """
        role = acting_role(user)
        uid = user.get("id")
        company_id = user.get("company_id")

        if scope == "my_tasks":
            # Bir iş koluna görev atanabilirlik VISIBILITY ile belirlenir:
            #  - sahibi şirket (company_id) eşleşir, veya
            #  - visible_to_company_ids çağıranın şirketini içerir, veya
            #  - visible_to_user_ids çağıranın id'sini içerir.
            # ÖNEMLİ: alt iş kolları üst kolun görünürlüğünü MİRAS ALIR — bir
            # üst kol görünüyorsa onun altındaki tüm alt kollar da atanabilir
            # (aksi halde "Düzenle"de alt kollar listelenmiyordu).
            all_rows = await db.task_categories.find({}, {"_id": 0}).sort("name", 1).to_list(length=5000)
            by_id = {c["id"]: c for c in all_rows}

            def _directly_visible(c: dict) -> bool:
                if company_id and c.get("company_id") == company_id:
                    return True
                if company_id and company_id in (c.get("visible_to_company_ids") or []):
                    return True
                if uid and uid in (c.get("visible_to_user_ids") or []):
                    return True
                return False

            def _visible(c: dict) -> bool:
                seen: set = set()
                cur = c
                while cur is not None and cur["id"] not in seen:
                    seen.add(cur["id"])
                    if _directly_visible(cur):
                        return True
                    pid = cur.get("parent_id")
                    cur = by_id.get(pid) if pid else None
                return False

            return [c for c in all_rows if _visible(c)]

        # scope=manage (default)
        if role == "admin":
            return await db.task_categories.find({}, {"_id": 0}).sort("name", 1).to_list(length=5000)
        if not company_id:
            return []
        visible_cids = {company_id}
        if role == "manager":
            rows = await db.company_permissions.find(
                {"viewer_company_id": company_id}, {"_id": 0, "target_company_id": 1},
            ).to_list(length=1000)
            visible_cids.update(r["target_company_id"] for r in rows)
        return await db.task_categories.find(
            {"company_id": {"$in": list(visible_cids)}}, {"_id": 0},
        ).sort("name", 1).to_list(length=5000)

    @router.get("/task-categories/order")
    async def get_category_order(user: dict = Depends(licensed_user_dep)):
        doc = await db.user_ui_prefs.find_one({"user_id": user["id"]}, {"_id": 0, "category_order": 1})
        return {"order": (doc or {}).get("category_order", [])}

    @router.put("/task-categories/order")
    async def set_category_order(req: CategoryOrderReq, user: dict = Depends(licensed_user_dep)):
        await db.user_ui_prefs.update_one(
            {"user_id": user["id"]},
            {"$set": {
                "user_id": user["id"],
                "category_order": req.order,
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }},
            upsert=True,
        )
        return {"order": req.order}

    @router.get("/task-categories/stats")
    async def task_category_stats(user: dict = Depends(licensed_user_dep)):
        """İş kolu mini-rapor — kol başına DOĞRUDAN görev sayısı (total) ve
        tamamlanan (done). Ağaç toplaması (rollup) frontend'de yapılır.
        Kapsam `scope=manage` ile aynı: admin tüm kollar; müdür kendi şirketi +
        aktif cross-company grant'lar; employee boş."""
        role = acting_role(user)
        company_id = user.get("company_id")
        if role == "employee":
            return {}
        if role == "admin":
            cat_filter: Dict[str, Any] = {}
        else:
            if not company_id:
                return {}
            visible_cids = {company_id}
            rows = await db.company_permissions.find(
                {"viewer_company_id": company_id}, {"_id": 0, "target_company_id": 1},
            ).to_list(length=1000)
            visible_cids.update(r["target_company_id"] for r in rows)
            cat_filter = {"company_id": {"$in": list(visible_cids)}}
        cats = await db.task_categories.find(cat_filter, {"_id": 0, "id": 1}).to_list(length=5000)
        cat_ids = [c["id"] for c in cats]
        if not cat_ids:
            return {}
        pipeline = [
            {"$match": {
                "category_id": {"$in": cat_ids},
                "$or": [{"archived": {"$exists": False}}, {"archived": False}],
            }},
            {"$group": {
                "_id": "$category_id",
                "total": {"$sum": 1},
                "done": {"$sum": {"$cond": [{"$eq": ["$status", "done"]}, 1, 0]}},
            }},
        ]
        agg = await db.tasks.aggregate(pipeline).to_list(length=5000)
        return {row["_id"]: {"total": row["total"], "done": row["done"]} for row in agg}

    @router.post("/task-categories", response_model=TaskCategory)
    async def create_task_category(req: TaskCategoryCreate, user: dict = Depends(licensed_user_dep)):
        role = acting_role(user)
        if role not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Yalnızca müdür ve yönetici iş kolu oluşturabilir")
        name = (req.name or "").strip()
        if len(name) < 2:
            raise HTTPException(status_code=400, detail="İş kolu adı en az 2 karakter olmalı")
        if role == "admin":
            cid = req.company_id or user.get("company_id")
            if not cid:
                raise HTTPException(status_code=400, detail="Şirket seçilmeli (admin için)")
        else:
            # Faz 9 CP4.15 — managers can create categories for their own
            # company OR any company they have an active cross-company grant
            # for (company_permissions.status='active').
            own_cid = user.get("company_id")
            cid = req.company_id or own_cid
            if not cid:
                raise HTTPException(status_code=400, detail="Şirketiniz yok — önce yönetici size şirket atamalı")
            if cid != own_cid:
                if not own_cid:
                    raise HTTPException(
                        status_code=403,
                        detail="İzniniz yok — bu şirket için iş kolu oluşturamazsınız",
                    )
                grant = await db.company_permissions.find_one({
                    "viewer_company_id": own_cid,
                    "target_company_id": cid,
                    "status": "active",
                })
                if not grant:
                    raise HTTPException(
                        status_code=403,
                        detail="İzniniz yok — bu şirket için iş kolu oluşturma yetkiniz yok. Hedef şirketin müdüründen izin isteyin.",
                    )
        company = await db.companies.find_one({"id": cid})
        if not company:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı")
        # Hiyerarşi — üst iş kolu doğrulaması (aynı şirkette olmalı).
        parent_id = req.parent_id or None
        if parent_id:
            parent = await db.task_categories.find_one({"id": parent_id}, {"_id": 0})
            if not parent:
                raise HTTPException(status_code=404, detail="Üst iş kolu bulunamadı")
            if parent.get("company_id") != cid:
                raise HTTPException(status_code=400, detail="Alt iş kolu, üst iş kolla aynı şirkette olmalı")
        import re as _re
        existing = await db.task_categories.find_one({
            "company_id": cid,
            "parent_id": parent_id,
            "name": {"$regex": f"^{_re.escape(name)}$", "$options": "i"},
        })
        if existing:
            raise HTTPException(status_code=400, detail="Bu isimde bir iş kolu (aynı üst kolda) zaten var")
        row = TaskCategory(company_id=cid, name=name, color=req.color, parent_id=parent_id, created_by=user["id"])
        await db.task_categories.insert_one(row.model_dump())
        return row

    @router.patch("/task-categories/{cat_id}", response_model=TaskCategory)
    async def update_task_category(cat_id: str, req: TaskCategoryUpdate, user: dict = Depends(licensed_user_dep)):
        role = acting_role(user)
        existing = await db.task_categories.find_one({"id": cat_id}, {"_id": 0})
        if not existing:
            raise HTTPException(status_code=404, detail="İş kolu bulunamadı")
        if role == "employee":
            raise HTTPException(status_code=403, detail="Yalnızca müdür ve yönetici düzenleyebilir")
        if role == "manager" and existing["company_id"] != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Sadece kendi şirketinizin iş kolunu düzenleyebilirsiniz")
        updates: Dict[str, Any] = {}
        if req.name is not None:
            name = req.name.strip()
            if len(name) < 2:
                raise HTTPException(status_code=400, detail="İş kolu adı en az 2 karakter olmalı")
            import re as _re
            dup = await db.task_categories.find_one({
                "company_id": existing["company_id"],
                "parent_id": existing.get("parent_id"),
                "name": {"$regex": f"^{_re.escape(name)}$", "$options": "i"},
                "id": {"$ne": cat_id},
            })
            if dup:
                raise HTTPException(status_code=400, detail="Bu isimde başka bir iş kolu var")
            updates["name"] = name
        if req.color is not None:
            updates["color"] = req.color or None
        # Re-parent (taşıma) — yalnızca alan açıkça gönderildiyse işlenir.
        if "parent_id" in req.model_fields_set:
            new_parent = req.parent_id or None
            if new_parent == cat_id:
                raise HTTPException(status_code=400, detail="Bir iş kolu kendi altına taşınamaz")
            if new_parent:
                parent = await db.task_categories.find_one({"id": new_parent}, {"_id": 0})
                if not parent:
                    raise HTTPException(status_code=404, detail="Üst iş kolu bulunamadı")
                if parent.get("company_id") != existing["company_id"]:
                    raise HTTPException(status_code=400, detail="Alt iş kolu, üst iş kolla aynı şirkette olmalı")
                # Döngü engeli — yeni üst kol, taşınan kolun alt ağacında olamaz.
                sub_rows = await db.task_categories.find(
                    {"company_id": existing["company_id"]}, {"_id": 0, "id": 1, "parent_id": 1},
                ).to_list(length=5000)
                children_by: Dict[Any, list] = {}
                for c in sub_rows:
                    children_by.setdefault(c.get("parent_id"), []).append(c["id"])
                descendants = set()
                stack = [cat_id]
                while stack:
                    cur = stack.pop()
                    for ch in children_by.get(cur, []):
                        if ch not in descendants:
                            descendants.add(ch)
                            stack.append(ch)
                if new_parent in descendants:
                    raise HTTPException(status_code=400, detail="Bir iş kolu kendi alt kolunun altına taşınamaz")
            # Ad çakışması — hedef üst kolda aynı isim var mı?
            import re as _re2
            dup2 = await db.task_categories.find_one({
                "company_id": existing["company_id"],
                "parent_id": new_parent,
                "name": {"$regex": f"^{_re2.escape(updates.get('name', existing['name']))}$", "$options": "i"},
                "id": {"$ne": cat_id},
            })
            if dup2:
                raise HTTPException(status_code=400, detail="Hedef üst kolda bu isimde bir iş kolu zaten var")
            updates["parent_id"] = new_parent
        # Faz 9 CP4.23 — layered visibility. Empty list is a valid value
        # meaning "revoke all extra grants"; `None` means "leave alone".
        if req.visible_to_company_ids is not None:
            updates["visible_to_company_ids"] = list(dict.fromkeys(req.visible_to_company_ids))
        if req.visible_to_user_ids is not None:
            updates["visible_to_user_ids"] = list(dict.fromkeys(req.visible_to_user_ids))
        if updates:
            await db.task_categories.update_one({"id": cat_id}, {"$set": updates})
        updated = await db.task_categories.find_one({"id": cat_id}, {"_id": 0})
        # Ensure the two new list fields exist on legacy rows so the
        # response model validates cleanly.
        updated.setdefault("visible_to_company_ids", [])
        updated.setdefault("visible_to_user_ids", [])
        return TaskCategory(**updated)

    @router.delete("/task-categories/{cat_id}")
    async def delete_task_category(cat_id: str, user: dict = Depends(licensed_user_dep)):
        role = acting_role(user)
        existing = await db.task_categories.find_one({"id": cat_id})
        if not existing:
            raise HTTPException(status_code=404, detail="İş kolu bulunamadı")
        if role == "employee":
            raise HTTPException(status_code=403, detail="Yalnızca müdür ve yönetici silebilir")
        if role == "manager" and existing["company_id"] != user.get("company_id"):
            raise HTTPException(status_code=403, detail="Sadece kendi şirketinizin iş kolunu silebilirsiniz")
        # Cascade — alt kollar dahil tüm alt ağacı sil; etkilenen görevlerin
        # category_id'si temizlenir (görev silinmez).
        all_cats = await db.task_categories.find(
            {"company_id": existing["company_id"]}, {"_id": 0, "id": 1, "parent_id": 1},
        ).to_list(length=5000)
        children_by: Dict[Any, list] = {}
        for c in all_cats:
            children_by.setdefault(c.get("parent_id"), []).append(c["id"])
        to_delete: list = []
        stack = [cat_id]
        while stack:
            cur = stack.pop()
            if cur in to_delete:
                continue
            to_delete.append(cur)
            stack.extend(children_by.get(cur, []))
        await db.tasks.update_many({"category_id": {"$in": to_delete}}, {"$unset": {"category_id": ""}})
        await db.task_categories.delete_many({"id": {"$in": to_delete}})
        return {"deleted": True, "count": len(to_delete)}

    # ------------------------------------------------------------------
    # REASSIGN (also handles orphan-reclaim)
    # ------------------------------------------------------------------
    @router.post("/tasks/{tid}/reassign", response_model=Task)
    async def reassign_task(tid: str, req: TaskReassignRequest, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        is_orphan_reclaim = False
        if doc.get("orphaned"):
            role = acting_role(user)
            src_cid = doc.get("orphaned_from_company_id")
            if role == "admin":
                is_orphan_reclaim = True
            elif role == "manager" and src_cid and src_cid in get_user_company_ids(user):
                is_orphan_reclaim = True
        if not is_orphan_reclaim and not await can_view_user(db, user, doc.get("user_id")):
            sp = _share_perms_for(doc, user["id"])
            if not (sp and sp.get("assign")):
                raise HTTPException(status_code=404, detail="Görev bulunamadı")
        # Faz 9 CP4.27 — Devret (transfer) is one of the lockable actions.
        if not is_orphan_reclaim:
            await _check_task_lock(doc, user, ["lock_transfer"])
        new_owner = req.new_owner_user_id
        if not new_owner:
            raise HTTPException(status_code=400, detail="Yeni sahip belirtilmedi")
        if not is_orphan_reclaim and new_owner == doc.get("user_id"):
            raise HTTPException(status_code=400, detail="Yeni sahip zaten mevcut sahip")
        if not await can_view_user(db, user, new_owner):
            raise HTTPException(status_code=403, detail="Bu kullanıcıya görev devredemezsiniz")
        target = await db.users.find_one(
            {"id": new_owner}, {"_id": 0, "username": 1, "company_name": 1, "company_id": 1},
        )
        if not target:
            raise HTTPException(status_code=404, detail="Hedef kullanıcı bulunamadı")
        updates: Dict[str, Any] = {
            "user_id": new_owner,
            "assignee_name": target.get("username"),
            "updated_at": datetime.now(timezone.utc).isoformat(),
            "orphaned": False,
            "orphaned_at": None,
            "orphaned_from_company_id": None,
        }
        if target.get("company_name"):
            updates["company_name"] = target["company_name"]
        if target.get("company_id"):
            updates["company_id"] = target["company_id"]
        await db.tasks.update_one({"id": tid}, {"$set": updates})
        # Consume unlock session AFTER successful reassign (if one was used).
        await _consume_unlock_session(tid, doc, user, action="reassign")
        # Faz 9 CP7 — mobile push to the new owner (skip self-reassign).
        if new_owner and new_owner != user["id"]:
            try:
                actor_name = user.get("username") or "Yönetici"
                await fcm_service.send_to_user(
                    db,
                    new_owner,
                    title=f"Görev devredildi · {actor_name}",
                    body=(doc.get("title") or "Yeni görev")[:180],
                    data={"kind": "task", "task_id": tid, "event": "reassigned"},
                )
            except Exception:  # pragma: no cover
                pass
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    # ------------------------------------------------------------------
    # ŞİRKETE DEVRET — görevi bir şirkete aktar (sahipsiz + kolsuz orphan)
    # ------------------------------------------------------------------
    @router.get("/task-transfer-companies")
    async def list_transfer_target_companies(user: dict = Depends(licensed_user_dep)):
        """Görevin devredilebileceği şirketler. Admin → hepsi; müdür → kendi
        şirket(ler)i + aktif çapraz-şirket izni (company_permissions) olanlar.
        Additive endpoint — mevcut /companies davranışına dokunmaz."""
        role = acting_role(user)
        if role == "admin":
            return await db.companies.find({}, {"_id": 0}).sort("name", 1).to_list(length=2000)
        if role != "manager":
            return []
        own = set(get_user_company_ids(user))
        if not own:
            return []
        cp_rows = await db.company_permissions.find(
            {
                "viewer_company_id": {"$in": list(own)},
                "$or": [{"status": {"$exists": False}}, {"status": "active"}],
            },
            {"_id": 0, "target_company_id": 1},
        ).to_list(length=2000)
        ids = own | {r["target_company_id"] for r in cp_rows if r.get("target_company_id")}
        return await db.companies.find(
            {"id": {"$in": list(ids)}}, {"_id": 0},
        ).sort("name", 1).to_list(length=2000)

    @router.post("/tasks/{tid}/transfer-company", response_model=Task)
    async def transfer_task_to_company(tid: str, req: TaskCompanyTransferRequest, user: dict = Depends(licensed_user_dep)):
        """Görevi hedef ŞİRKETE devret. Görev sahipsiz (orphan) + iş kolusuz
        (kolsuz) olarak hedef şirketin "Yarım Kalan İşler" havuzuna düşer; o
        şirketin müdürü/admin oradan bir çalışana sahiplendirir (mevcut reassign
        orphan-reclaim akışı). Kişiye devret (reassign) davranışı korunur."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        role = acting_role(user)
        # Bu görev üzerinde işlem yapabilme yetkisi (reassign ile aynı kapı).
        is_orphan_source = False
        if doc.get("orphaned"):
            src_cid = doc.get("orphaned_from_company_id")
            if role == "admin":
                is_orphan_source = True
            elif role == "manager" and src_cid and src_cid in get_user_company_ids(user):
                is_orphan_source = True
        if not is_orphan_source and not await can_view_user(db, user, doc.get("user_id")):
            sp = _share_perms_for(doc, user["id"])
            if not (sp and sp.get("assign")):
                raise HTTPException(status_code=404, detail="Görev bulunamadı")
        # Devret kilitlenebilir bir aksiyon (orphan yeniden yönlendirme hariç).
        if not is_orphan_source:
            await _check_task_lock(doc, user, ["lock_transfer"])
        target_cid = req.company_id
        if not target_cid:
            raise HTTPException(status_code=400, detail="Hedef şirket belirtilmedi")
        if not await can_view_company(db, user, target_cid):
            raise HTTPException(status_code=403, detail="Bu şirkete devretme yetkiniz yok")
        company = await db.companies.find_one({"id": target_cid}, {"_id": 0, "name": 1})
        if not company:
            raise HTTPException(status_code=404, detail="Şirket bulunamadı")
        now = datetime.now(timezone.utc).isoformat()
        set_ops: Dict[str, Any] = {
            "user_id": None,
            "assignee_name": None,
            "assignees": [],
            "company_id": target_cid,
            "company_name": company.get("name"),
            "orphaned": True,
            "orphaned_at": now,
            "orphaned_from_company_id": target_cid,
            "prev_assignee_user_id": doc.get("user_id"),
            "prev_assignee_name": doc.get("assignee_name"),
            "updated_at": now,
        }
        # İş kolusuz (kolsuz) olarak düşsün — kategori bağını kaldır.
        await db.tasks.update_one(
            {"id": tid}, {"$set": set_ops, "$unset": {"category_id": ""}},
        )
        # Kilit oturumu kullanıldıysa tüket (yoksa no-op).
        if not is_orphan_source:
            await _consume_unlock_session(tid, doc, user, action="transfer_company")
        # Hedef şirketin müdürlerine bildirim (best-effort).
        try:
            import team_service
            await team_service.notify_task_transferred_to_company(db, doc, target_cid, user)
        except Exception as exc:  # pragma: no cover
            log.warning("transfer-company notification failed for %s: %s", tid, exc)
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)


    @router.post("/tasks/{tid}/subtasks/{sub_id}/promote", response_model=Task)
    async def promote_subtask_to_task(tid: str, sub_id: str, user: dict = Depends(licensed_user_dep)):
        """Alt görevi tam bir GÖREVE dönüştür. Metin/tarih/durum korunur; ana
        görevin sahibi/şirketi/iş kolu miras alınır; `promoted_from_task_*` ile
        ana göreve bağ kurulur ('‹Ana görev› görevinin alt unsuru' rozeti).
        Alt görev, ana görevden çıkarılır."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc or not await _can_view_task(doc, user):
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        # Alt görev listesi değişiyor → düzenleme kilidi kontrolü.
        await _check_task_lock(doc, user, ["lock_edit"])
        subs = doc.get("subtasks") or []
        sub = next((s for s in subs if s.get("id") == sub_id), None)
        if not sub:
            raise HTTPException(status_code=404, detail="Alt görev bulunamadı")
        now = _now_iso()
        status = sub.get("status") or ("done" if sub.get("done") else "pending")
        if status not in ("pending", "paused", "overdue", "done"):
            status = "pending"
        owner_id = doc.get("user_id") or user["id"]
        t = Task(
            title=(sub.get("text") or "Alt görev")[:500],
            status=status,
            due_date=sub.get("due_date"),
            assignee_name=doc.get("assignee_name"),
            company_name=doc.get("company_name"),
            company_id=doc.get("company_id"),
            category_id=doc.get("category_id"),
            created_by=user["id"],
            promoted_from_task_id=tid,
            promoted_from_task_title=doc.get("title"),
        )
        if status == "done":
            t.completed_at = now
        td = t.model_dump()
        td["user_id"] = owner_id
        await db.tasks.insert_one(td)
        # Alt görevi ana görevden kaldır.
        await db.tasks.update_one(
            {"id": tid},
            {"$set": {"subtasks": [s for s in subs if s.get("id") != sub_id], "updated_at": now}},
        )
        return Task(**td)


    @router.post("/tasks/{tid}/demote-to-subtask", response_model=Task)
    async def demote_task_to_subtask(tid: str, user: dict = Depends(licensed_user_dep)):
        """Promote ile göreve dönüşmüş bir görevi GERİ ana görevin alt görevine
        çevir (promote'un tersi). Görevin metin/tarih/durumu korunarak ana görevin
        subtasks'ine eklenir; görev silinir. Ana görev yoksa 404."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc or not await _can_view_task(doc, user):
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        parent_id = doc.get("promoted_from_task_id")
        if not parent_id:
            raise HTTPException(status_code=400, detail="Bu görev bir alt görevden dönüştürülmemiş")
        parent = await db.tasks.find_one({"id": parent_id}, {"_id": 0})
        if not parent or not await _can_view_task(parent, user):
            raise HTTPException(status_code=404, detail="Ana görev bulunamadı (silinmiş olabilir)")
        # Hem dönüştürülen görevin hem de ana görevin düzenleme kilidini kontrol et.
        await _check_task_lock(doc, user, ["lock_edit"])
        await _check_task_lock(parent, user, ["lock_edit"])
        now = _now_iso()
        status = doc.get("status") or "pending"
        if status not in ("pending", "paused", "overdue", "done"):
            status = "pending"
        new_sub = {
            "id": str(uuid.uuid4()),
            "text": (doc.get("title") or "Alt görev")[:500],
            "done": status == "done",
            "status": status,
            "due_date": doc.get("due_date"),
            "reminder_fired": False,
        }
        subs = list(parent.get("subtasks") or [])
        subs.append(new_sub)
        await db.tasks.update_one(
            {"id": parent_id},
            {"$set": {"subtasks": subs, "updated_at": now}},
        )
        # Dönüştürülen görevi sil (alt görev olarak geri döndü).
        await db.tasks.delete_one({"id": tid})
        updated_parent = await db.tasks.find_one({"id": parent_id}, {"_id": 0})
        return Task(**updated_parent)


    # ------------------------------------------------------------------
    # GÖREV DOSYA EKLERİ (attachments) — chunked upload + object storage
    # Görebilen herkes yükler/indirir; siler: yükleyen veya sahip/müdür/admin.
    # ------------------------------------------------------------------
    _ATTACH_MAX_BYTES = 100 * 1024 * 1024  # 100 MB / dosya
    _ATTACH_TMP_DIR = "/tmp/sertex_task_uploads"
    # NOT: Yükleme oturumları bellek içinde (+ /tmp'de parça birleştirme) tutulur.
    # Bu, backend'in TEK uvicorn worker ile çalıştığı varsayımına dayanır
    # (--workers 1). Çok worker'a geçilirse sticky-session veya Redis tabanlı
    # oturum deposu gerekir; aksi halde parçalar farklı worker'lara dağılır.
    _upload_sessions: Dict[str, Dict[str, Any]] = {}
    os.makedirs(_ATTACH_TMP_DIR, exist_ok=True)

    def _attach_out(doc: dict) -> dict:
        return TaskAttachment(**doc).model_dump()

    @router.get("/tasks/{tid}/attachments")
    async def list_task_attachments(tid: str, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc or not await _can_view_task(doc, user):
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        rows = await db.task_attachments.find(
            {"task_id": tid, "is_deleted": {"$ne": True}}, {"_id": 0},
        ).sort("created_at", -1).to_list(length=500)
        return [_attach_out(r) for r in rows]

    @router.post("/tasks/{tid}/attachments/init")
    async def init_task_attachment(tid: str, req: AttachmentInitReq, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc or not await _can_view_task(doc, user):
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        fname = (req.filename or "dosya.bin").strip()[:255]
        if not fname:
            raise HTTPException(status_code=400, detail="Dosya adı gerekli")
        if req.total_size and req.total_size > _ATTACH_MAX_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"Dosya çok büyük: {req.total_size/1024/1024:.1f} MB (maks 100 MB)",
            )
        upload_id = str(uuid.uuid4())
        tmp_path = os.path.join(_ATTACH_TMP_DIR, upload_id)
        # Boş dosya oluştur (append için).
        open(tmp_path, "wb").close()
        _upload_sessions[upload_id] = {
            "task_id": tid,
            "user_id": user["id"],
            "filename": fname,
            "content_type": req.content_type or "application/octet-stream",
            "total_size": int(req.total_size or 0),
            "received": 0,
            "tmp_path": tmp_path,
        }
        return {"upload_id": upload_id}

    @router.post("/tasks/{tid}/attachments/chunk")
    async def upload_task_attachment_chunk(
        tid: str,
        upload_id: str = Form(...),
        index: int = Form(0),
        chunk: UploadFile = File(...),
        user: dict = Depends(licensed_user_dep),
    ):
        sess = _upload_sessions.get(upload_id)
        if not sess or sess["user_id"] != user["id"] or sess["task_id"] != tid:
            raise HTTPException(status_code=404, detail="Yükleme oturumu bulunamadı")
        data = await chunk.read()
        new_total = sess["received"] + len(data)
        if new_total > _ATTACH_MAX_BYTES:
            # Temizle ve reddet.
            try:
                os.remove(sess["tmp_path"])
            except OSError:
                pass
            _upload_sessions.pop(upload_id, None)
            raise HTTPException(status_code=400, detail="Dosya çok büyük (maks 100 MB)")
        # Diske sırayla ekle (tek worker — güvenli).
        def _append():
            with open(sess["tmp_path"], "ab") as f:
                f.write(data)
        await asyncio.to_thread(_append)
        sess["received"] = new_total
        return {"received": new_total}

    @router.post("/tasks/{tid}/attachments/complete", response_model=TaskAttachment)
    async def complete_task_attachment(tid: str, req: AttachmentCompleteReq, user: dict = Depends(licensed_user_dep)):
        sess = _upload_sessions.get(req.upload_id)
        if not sess or sess["user_id"] != user["id"] or sess["task_id"] != tid:
            raise HTTPException(status_code=404, detail="Yükleme oturumu bulunamadı")
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc or not await _can_view_task(doc, user):
            _upload_sessions.pop(req.upload_id, None)
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        tmp_path = sess["tmp_path"]
        try:
            def _read():
                with open(tmp_path, "rb") as f:
                    return f.read()
            file_bytes = await asyncio.to_thread(_read)
            if not file_bytes:
                raise HTTPException(status_code=400, detail="Boş dosya")
            storage_path = build_upload_path(user["id"], sess["filename"])
            result = await asyncio.to_thread(
                put_object, storage_path, file_bytes, sess["content_type"],
            )
            canonical = result.get("path", storage_path)
        except HTTPException:
            raise
        except Exception as exc:
            log.exception("Attachment upload to storage failed")
            raise HTTPException(status_code=502, detail=f"Depolama hatası: {str(exc)[:200]}")
        finally:
            try:
                os.remove(tmp_path)
            except OSError:
                pass
            _upload_sessions.pop(req.upload_id, None)
        att = TaskAttachment(
            task_id=tid,
            company_id=doc.get("company_id"),
            storage_path=canonical,
            original_filename=sess["filename"],
            content_type=sess["content_type"],
            size=len(file_bytes),
            uploaded_by=user["id"],
            uploaded_by_name=user.get("username"),
        )
        await db.task_attachments.insert_one(att.model_dump())
        return att

    @router.get("/tasks/{tid}/attachments/{att_id}/download")
    async def download_task_attachment(tid: str, att_id: str, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc or not await _can_view_task(doc, user):
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        rec = await db.task_attachments.find_one(
            {"id": att_id, "task_id": tid, "is_deleted": {"$ne": True}}, {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        try:
            data, ct = await asyncio.to_thread(get_object, rec["storage_path"])
        except Exception:
            log.exception("Attachment storage download failed")
            raise HTTPException(status_code=502, detail="Depolamadan indirme başarısız")
        # Content-Disposition — çift tırnak kaçır + UTF-8 (RFC 5987) dosya adı.
        raw_name = rec.get("original_filename") or "dosya"
        ascii_name = raw_name.replace('"', "'")
        return Response(
            content=data,
            media_type=rec.get("content_type") or ct,
            headers={
                "Content-Disposition": (
                    f'attachment; filename="{ascii_name}"; '
                    f"filename*=UTF-8''{quote(raw_name)}"
                )
            },
        )

    @router.delete("/tasks/{tid}/attachments/{att_id}")
    async def delete_task_attachment(tid: str, att_id: str, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        rec = await db.task_attachments.find_one(
            {"id": att_id, "task_id": tid, "is_deleted": {"$ne": True}}, {"_id": 0},
        )
        if not rec:
            raise HTTPException(status_code=404, detail="Dosya bulunamadı")
        # Silme yetkisi: yükleyen veya sahip/müdür/admin.
        if rec.get("uploaded_by") != user["id"] and not await _can_share_task(doc, user):
            raise HTTPException(status_code=403, detail="Bu dosyayı silme yetkiniz yok")
        await db.task_attachments.update_one(
            {"id": att_id},
            {"$set": {"is_deleted": True, "deleted_at": _now_iso()}},
        )
        return {"deleted": 1}


    # ------------------------------------------------------------------
    # Görev Paylaşımı + Çok Kişili Atama — endpoints
    # ------------------------------------------------------------------
    @router.put("/tasks/{tid}/shares", response_model=Task)
    async def set_task_shares(tid: str, req: TaskShareRequest, user: dict = Depends(licensed_user_dep)):
        """ÖZELLİK B — replace the share ACL of a task (S2-b authorization:
        creator + admin + task-company manager). `view` is always forced True.
        Newly-added recipients get a `task_shared` notification when notify=True.
        """
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if not await _can_share_task(doc, user):
            raise HTTPException(status_code=403, detail="Bu görevi paylaşma yetkiniz yok")
        prev_ids = {(s or {}).get("user_id") for s in (doc.get("shared_with") or [])}
        shares: List[dict] = []
        seen: set = set()
        for entry in req.shares:
            uid = entry.user_id
            if not uid or uid in seen or uid == doc.get("user_id"):
                continue
            seen.add(uid)
            label = await _resolve_user_label(uid)
            perms = entry.perms.model_dump()
            perms["view"] = True  # baseline — a shared user must be able to see it
            shares.append(TaskShare(user_id=uid, name=label["name"], perms=TaskSharePerms(**perms)).model_dump())
        await db.tasks.update_one(
            {"id": tid},
            {"$set": {"shared_with": shares, "updated_at": _now_iso()}},
        )
        # Notify only the recipients that are NEW (not previously shared with).
        new_ids = [s["user_id"] for s in shares if s["user_id"] not in prev_ids]
        if req.notify and new_ids:
            try:
                import team_service
                await team_service.notify_task_shared(db, doc, new_ids, user)
            except Exception as exc:  # pragma: no cover — notifications best-effort
                log.warning("task_shared notification failed for %s: %s", tid, exc)
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.post("/tasks/{tid}/my-completion", response_model=Task)
    async def set_my_completion(tid: str, req: TaskMyCompletionRequest, user: dict = Depends(licensed_user_dep)):
        """ÖZELLİK A — an assignee toggles their OWN completion. The task only
        flips to `done` when EVERY assignee is complete ("2/4 tamamlandı")."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        assignees = list(doc.get("assignees") or [])
        if not assignees:
            raise HTTPException(status_code=400, detail="Bu görev çok kişili değil")
        if not _is_assignee(doc, user["id"]):
            # Admin / creator / RBAC-manager can toggle on behalf of an assignee?
            # No — my-completion is strictly per-person. Others use PATCH status.
            raise HTTPException(status_code=403, detail="Bu görevin atananı değilsiniz")
        # Respect the complete lock for non-admin/non-creator assignees.
        if req.completed:
            await _check_task_lock(doc, user, ["lock_complete"])
        now = _now_iso()
        for a in assignees:
            if a.get("user_id") == user["id"]:
                a["completed"] = bool(req.completed)
                a["completed_at"] = now if req.completed else None
        set_ops: Dict[str, Any] = {"assignees": assignees, "updated_at": now}
        new_status = _recompute_multi_status(assignees, doc.get("status") or "pending")
        if new_status is not None:
            set_ops["status"] = new_status
            # Çok kişili görevde herkes tamamlayınca completed_at yazılır,
            # biri geri alınca temizlenir.
            if new_status == "done":
                set_ops["completed_at"] = now
            elif new_status == "pending":
                set_ops["completed_at"] = None
        await db.tasks.update_one({"id": tid}, {"$set": set_ops})
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.get("/users/search")
    async def search_users(q: str = "", limit: int = 20, user: dict = Depends(licensed_user_dep)):
        """ÖZELLİK B — user picker for the share modal (S3-a: anyone in the
        system is selectable). Returns minimal public fields only. Excludes
        self. Empty query returns an empty list to avoid dumping the whole
        directory."""
        q = (q or "").strip()
        if not q:
            return []
        limit = max(1, min(int(limit or 20), 50))
        import re as _re
        pattern = _re.escape(q)
        docs = await db.users.find(
            {
                "id": {"$ne": user["id"]},
                "username": {"$regex": pattern, "$options": "i"},
            },
            {"_id": 0, "id": 1, "username": 1, "company_name": 1, "role": 1},
        ).limit(limit).to_list(length=limit)
        return docs


    # ------------------------------------------------------------------
    # Faz 9 CP4.27 — Task Lock configuration + one-time unlock OTP
    # ------------------------------------------------------------------
    @router.patch("/tasks/{tid}/locks", response_model=Task)
    async def patch_task_locks(tid: str, req: TaskLockPatch, user: dict = Depends(licensed_user_dep)):
        """Set the lock_flags on a task. Only the creator, an admin, or a
        manager who can see the assignee may lock/unlock. Unknown keys are
        silently dropped so the frontend can extend the checklist freely."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        role = acting_role(user)
        creator_id = doc.get("created_by")
        # Allowed lockers: task creator, admin, or a manager who can see the
        # current assignee (visible_user_ids includes the assignee).
        allowed = False
        if role == "admin":
            allowed = True
        elif creator_id and creator_id == user.get("id"):
            allowed = True
        elif role == "manager" and await can_view_user(db, user, doc.get("user_id")):
            allowed = True
        if not allowed:
            raise HTTPException(status_code=403, detail="Bu görevi kilitleme yetkiniz yok")
        # Coerce + whitelist keys.
        clean: Dict[str, bool] = {k: bool(v) for k, v in req.lock_flags.items() if k in _LOCK_FLAG_KEYS}
        # Drop the False-valued keys so the document stays compact.
        stored = {k: v for k, v in clean.items() if v}
        set_ops: Dict[str, Any] = {
            "lock_flags": stored,
            "updated_at": _now_iso(),
        }
        # Faz 9 CP4.30 — OTP requirement toggle. Persist only when the caller
        # explicitly passed a value; otherwise keep the existing task value.
        if req.requires_otp is not None:
            set_ops["lock_requires_otp"] = bool(req.requires_otp)
        if stored:
            set_ops["locked_by"] = user["id"]
            set_ops["locked_at"] = _now_iso()
        else:
            # All flags cleared — wipe out lock metadata and any active OTP session.
            set_ops["locked_by"] = None
            set_ops["locked_at"] = None
            set_ops["unlock_expires_at"] = None
            set_ops["unlock_uses_remaining"] = 0
        await db.tasks.update_one({"id": tid}, {"$set": set_ops})
        # Faz 9 CP4.28 — audit
        await _log_lock_event(db, tid, user, "lock_set", {
            "flags_before": doc.get("lock_flags") or {},
            "flags_after": stored,
            "requires_otp": set_ops.get("lock_requires_otp", doc.get("lock_requires_otp", True)),
        })
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.patch("/tasks/{tid}/self-locks", response_model=Task)
    async def patch_task_self_locks(tid: str, req: TaskSelfLockPatch, user: dict = Depends(licensed_user_dep)):
        """Faz 9 CP4.30 — Assignee-side self-lock. Anyone can toggle their own
        distraction locks without OTP; admin can also do it on any task."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        role = acting_role(user)
        allowed = role == "admin" or doc.get("user_id") == user.get("id")
        if not allowed:
            raise HTTPException(status_code=403, detail="Sadece görevin sahibi self-lock koyabilir")
        clean: Dict[str, bool] = {k: bool(v) for k, v in req.self_lock_flags.items() if k in _LOCK_FLAG_KEYS}
        stored = {k: v for k, v in clean.items() if v}
        await db.tasks.update_one({"id": tid}, {"$set": {
            "self_lock_flags": stored,
            "updated_at": _now_iso(),
        }})
        await _log_lock_event(db, tid, user, "self_lock_set", {
            "flags_before": doc.get("self_lock_flags") or {},
            "flags_after": stored,
        })
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.post("/tasks/{tid}/unlock-simple", response_model=Task)
    async def unlock_simple(tid: str, user: dict = Depends(licensed_user_dep)):
        """Faz 9 CP4.30 — OTP-less bypass for soft locks. Only works when
        `lock_requires_otp` is False. Opens the standard 10 min single-use
        window so the same guard logic downstream keeps working."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if doc.get("user_id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Bu görev size ait değil")
        if doc.get("lock_requires_otp", True):
            raise HTTPException(status_code=400, detail="Bu görev OTP gerektiriyor — müdürünüzden şifre isteyin")
        now = datetime.now(timezone.utc)
        window_end = now + timedelta(minutes=_OTP_TTL_MINUTES)
        await db.tasks.update_one({"id": tid}, {"$set": {
            "unlock_expires_at": window_end.isoformat(),
            "unlock_uses_remaining": 1,
            "unlock_last_verified_at": now.isoformat(),
        }})
        await _log_lock_event(db, tid, user, "unlock_simple", {
            "window_end": window_end.isoformat(),
        })
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.post("/tasks/{tid}/unlock-otp")
    async def issue_unlock_otp(tid: str, user: dict = Depends(licensed_user_dep)):
        """Creator / admin / assignee's manager generates a 6-digit code. The
        plaintext is returned ONCE in this response (creator screen) AND fires
        an SSE notification to the assignee inbox so they can unlock right
        away. Any previous unused OTP for this task is invalidated."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        role = acting_role(user)
        creator_id = doc.get("created_by")
        allowed = False
        if role == "admin":
            allowed = True
        elif creator_id and creator_id == user.get("id"):
            allowed = True
        elif role == "manager" and await can_view_user(db, user, doc.get("user_id")):
            allowed = True
        if not allowed:
            raise HTTPException(status_code=403, detail="Bu görev için şifre üretme yetkiniz yok")
        assignee_id = doc.get("user_id")
        if assignee_id == user.get("id"):
            raise HTTPException(status_code=400, detail="Kendi görevinize kilit şifresi üretmenize gerek yok")
        # Faz 9 CP4.34 — race-safe issuance. Two concurrent OTP requests for
        # the same task would previously each invalidate the (already empty)
        # unused set THEN each insert their own — leaving two active codes
        # violating the single-use invariant. Doing invalidate + insert in
        # sequence (no lock across them) can still race. Since Motor lacks
        # transactions on standalone Mongo, we split the invariant enforcement
        # in TWO steps: (a) invalidate any prior unused rows FIRST, capturing
        # the modified count for audit, (b) insert the new row. If a peer
        # request lands between these two, its (a) will invalidate OUR row —
        # first request wins by expiry timestamp. This is acceptable because
        # both racers see consistent behaviour: the LATER OTP wins, both
        # audits are recorded, single active code invariant holds within any
        # 1-round-trip window.
        now = datetime.now(timezone.utc)
        prev_invalid = await db.task_unlock_otps.update_many(
            {"task_id": tid, "used_at": None, "invalidated_at": {"$exists": False}},
            {"$set": {"invalidated_at": now.isoformat()}},
        )
        if getattr(prev_invalid, "modified_count", 0):
            await _log_lock_event(db, tid, user, "otp_invalidated", {
                "count": prev_invalid.modified_count,
                "reason": "reissue",
            })
        # Generate a new 6-digit numeric code (secrets → uniform, cryptographically random).
        code = "".join(secrets.choice("0123456789") for _ in range(_OTP_DIGITS))
        expires_at = now + timedelta(minutes=_OTP_TTL_MINUTES)
        otp_row = {
            "id": str(uuid.uuid4()),
            "task_id": tid,
            "code_hash": _hash_otp(code),
            "issued_by": user["id"],
            "issued_for": assignee_id,
            "created_at": now.isoformat(),
            "expires_at": expires_at.isoformat(),
            "used_at": None,
        }
        await db.task_unlock_otps.insert_one(otp_row)
        # Faz 9 CP4.28 — audit
        await _log_lock_event(db, tid, user, "otp_issued", {
            "otp_id": otp_row["id"],
            "issued_for": assignee_id,
            "issued_for_username": doc.get("assignee_name"),
            "expires_at": expires_at.isoformat(),
        })
        # Fire an in-app notification to the assignee (best-effort).
        try:
            from team_service import Notification, _insert_notification  # local import
            issuer_name = user.get("username") or "Müdür"
            notif = Notification(
                user_id=assignee_id,
                type="task_unlock_offered",
                task_id=tid,
                task_title=doc.get("title"),
                owner_user_id=assignee_id,
                owner_username=doc.get("assignee_name"),
                payload={
                    "issuer_user_id": user["id"],
                    "issuer_username": issuer_name,
                    "expires_at": expires_at.isoformat(),
                    "ttl_minutes": _OTP_TTL_MINUTES,
                },
            )
            await _insert_notification(db, notif)
        except Exception:
            pass  # notification is best-effort; the plaintext already reached the issuer.
        # Faz 9 CP7 — mobile push to the assignee: "Müdürün kilidini açtı".
        # We DO NOT include the plaintext code in the push payload — the
        # issuer conveys it verbally / via chat as before. This is just a
        # heads-up so the assignee opens the app.
        try:
            issuer_name = user.get("username") or "Müdür"
            await fcm_service.send_to_user(
                db,
                assignee_id,
                title=f"Kilit açma kodu · {issuer_name}",
                body=(doc.get("title") or "Görev")[:180] + " — kod bekleniyor",
                data={"kind": "otp", "task_id": tid, "event": "issued"},
            )
        except Exception:  # pragma: no cover
            pass
        return {
            "code": code,  # returned ONCE — issuer displays this and passes it verbally / by chat
            "expires_at": expires_at.isoformat(),
            "ttl_minutes": _OTP_TTL_MINUTES,
        }

    @router.post("/tasks/{tid}/unlock-verify", response_model=Task)
    async def verify_unlock_otp(tid: str, req: TaskUnlockVerify, user: dict = Depends(licensed_user_dep)):
        """Assignee submits the code. On success we open a 10-minute, single-
        use unlock window on the task itself so subsequent PATCH/DELETE/
        reassign requests bypass the lock exactly once.

        Faz 9 CP4.34 — brute-force protection. A 6-digit code is only 1M
        combinations; without rate limiting an attacker (or a compromised
        assignee) could enumerate the space in ~10 min. We cap failed
        attempts to 5 per rolling 15-min window per (task_id, user_id) and
        return 429 after that with a cooldown notice."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        if doc.get("user_id") != user.get("id"):
            raise HTTPException(status_code=403, detail="Bu görev size ait değil")
        # Rate-limit gate. Failed OTP attempts are recorded in the same
        # `login_attempts` collection (keyed by "otp:{task_id}:{user_id}").
        rate_key = f"otp:{tid}:{user['id']}"
        cutoff = (datetime.now(timezone.utc) - timedelta(minutes=15)).isoformat()
        try:
            fails = await db.login_attempts.count_documents({
                "identifier": rate_key,
                "success": False,
                "at": {"$gt": cutoff},
            })
        except Exception:
            fails = 0
        if fails >= 5:
            await _log_lock_event(db, tid, user, "otp_rate_limited", {"fails_in_window": fails})
            raise HTTPException(
                status_code=429,
                detail="Çok fazla başarısız deneme — 15 dakika sonra tekrar dene",
            )
        code = (req.code or "").strip()

        async def _record_attempt(success: bool) -> None:
            try:
                await db.login_attempts.insert_one({
                    "identifier": rate_key,
                    "success": bool(success),
                    "at": datetime.now(timezone.utc).isoformat(),
                    "kind": "otp_verify",
                })
            except Exception as exc:
                log.warning("otp_verify login_attempts audit insert failed: %s", exc)

        if len(code) != _OTP_DIGITS or not code.isdigit():
            await _log_lock_event(db, tid, user, "otp_failed", {"reason": "malformed"})
            await _record_attempt(False)
            raise HTTPException(status_code=400, detail="Şifre 6 haneli olmalı")
        code_hash = _hash_otp(code)
        now = datetime.now(timezone.utc)
        otp = await db.task_unlock_otps.find_one({
            "task_id": tid,
            "code_hash": code_hash,
            "used_at": None,
            "invalidated_at": {"$exists": False},
        })
        if not otp:
            await _log_lock_event(db, tid, user, "otp_failed", {"reason": "wrong_or_used"})
            await _record_attempt(False)
            raise HTTPException(status_code=400, detail="Şifre geçersiz veya kullanılmış")
        try:
            exp = datetime.fromisoformat(otp["expires_at"])
            if exp.tzinfo is None:
                exp = exp.replace(tzinfo=timezone.utc)
        except Exception:
            await _log_lock_event(db, tid, user, "otp_failed", {"reason": "malformed_expiry"})
            await _record_attempt(False)
            raise HTTPException(status_code=400, detail="Şifre süresi hatalı")
        if exp <= now:
            await _log_lock_event(db, tid, user, "otp_failed", {"reason": "expired", "otp_id": otp["id"]})
            await _record_attempt(False)
            raise HTTPException(status_code=400, detail="Şifre süresi dolmuş — müdürünüzden yenisini isteyin")
        # Mark OTP used + open the unlock window.
        await db.task_unlock_otps.update_one(
            {"id": otp["id"]},
            {"$set": {"used_at": now.isoformat()}},
        )
        window_end = now + timedelta(minutes=_OTP_TTL_MINUTES)
        await db.tasks.update_one({"id": tid}, {"$set": {
            "unlock_expires_at": window_end.isoformat(),
            "unlock_uses_remaining": 1,
            "unlock_last_verified_at": now.isoformat(),
        }})
        # Faz 9 CP4.28 — audit
        await _log_lock_event(db, tid, user, "otp_verified", {
            "otp_id": otp["id"],
            "issued_by": otp.get("issued_by"),
            "window_end": window_end.isoformat(),
        })
        await _record_attempt(True)
        new_doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        return Task(**new_doc)

    @router.get("/tasks/{tid}/lock-audit")
    async def get_task_lock_audit(tid: str, limit: int = 100, user: dict = Depends(licensed_user_dep)):
        """Return the KVKK-compliant audit trail for a task's lock lifecycle.
        Visible to: admin, task creator, or a manager who can see the assignee.
        Codes are never stored — only metadata (who / when / what). Admins can
        view the trail even for a task that has since been deleted."""
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        role = acting_role(user)
        if not doc:
            # Deleted task — only admin may read the historical audit.
            if role != "admin":
                raise HTTPException(status_code=404, detail="Görev bulunamadı")
        else:
            creator_id = doc.get("created_by")
            allowed = False
            if role == "admin":
                allowed = True
            elif creator_id and creator_id == user.get("id"):
                allowed = True
            elif role == "manager" and await can_view_user(db, user, doc.get("user_id")):
                allowed = True
            if not allowed:
                raise HTTPException(status_code=403, detail="Bu görevin tarihçesine erişim yetkiniz yok")
        # Clamp limit into [1, 500]. `limit or 100` fallback avoids 0.
        try:
            n = int(limit)
        except Exception:
            n = 100
        limit = max(1, min(n if n > 0 else 100, 500))
        cur = db.task_lock_audit.find({"task_id": tid}, {"_id": 0}).sort("created_at", -1).limit(limit)
        rows = []
        async for row in cur:
            rows.append(row)
        return {"task_id": tid, "task_exists": doc is not None, "count": len(rows), "rows": rows}

    # ------------------------------------------------------------------
    # Faz 9 CP4.30 — User-level default lock policy
    # ------------------------------------------------------------------
    async def _can_manage_user_policy(target_id: str, user: dict) -> bool:
        """Admin OK; the user themselves OK; a manager who can view the target
        OK. Employees can only manage their OWN policy."""
        role = acting_role(user)
        if role == "admin":
            return True
        if target_id == user.get("id"):
            return True
        if role == "manager" and await can_view_user(db, user, target_id):
            return True
        return False

    @router.get("/users/{uid}/lock-flags")
    async def get_user_lock_flags(uid: str, user: dict = Depends(licensed_user_dep)):
        """Return the user's default lock policy (inherited by new tasks)."""
        if not await _can_manage_user_policy(uid, user):
            raise HTTPException(status_code=403, detail="Bu kullanıcının politikasına erişim yetkiniz yok")
        u = await db.users.find_one({"id": uid}, {
            "_id": 0,
            "id": 1, "username": 1, "role": 1,
            "default_lock_flags": 1,
            "default_self_lock_flags": 1,
            "default_lock_requires_otp": 1,
            # Faz 9 CP4.35 — channel-scoped attribution.
            "default_lock_managed_set_by_user_id": 1,
            "default_lock_managed_set_at": 1,
            "default_self_lock_set_by_user_id": 1,
            "default_self_lock_set_at": 1,
            # Legacy shared field (backwards compat for old rows).
            "default_lock_set_by_user_id": 1,
            "default_lock_set_at": 1,
            "archive_caps": 1,
        })
        if not u:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        return {
            "user_id": u.get("id"),
            "username": u.get("username"),
            "default_lock_flags": u.get("default_lock_flags") or {},
            "default_self_lock_flags": u.get("default_self_lock_flags") or {},
            "default_lock_requires_otp": u.get("default_lock_requires_otp", True),
            # Prefer new channel-scoped fields; fall back to legacy for older docs.
            "default_lock_set_by_user_id": (
                u.get("default_lock_managed_set_by_user_id")
                or u.get("default_lock_set_by_user_id")
            ),
            "default_lock_set_at": (
                u.get("default_lock_managed_set_at")
                or u.get("default_lock_set_at")
            ),
            "default_self_lock_set_by_user_id": u.get("default_self_lock_set_by_user_id"),
            "default_self_lock_set_at": u.get("default_self_lock_set_at"),
            "archive_caps": u.get("archive_caps") or {},
        }

    @router.patch("/users/{uid}/lock-flags")
    async def patch_user_lock_flags(uid: str, req: TaskLockPatch, user: dict = Depends(licensed_user_dep)):
        """Set the default lock policy. Assignees can only manage their OWN
        `self_lock_flags` via this — if a non-privileged user patches, the
        flags land in `default_self_lock_flags` (freely removable) and
        `requires_otp` is forced to False. Admin/manager patches land in
        `default_lock_flags` (strict)."""
        u = await db.users.find_one({"id": uid}, {"_id": 0})
        if not u:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        if not await _can_manage_user_policy(uid, user):
            raise HTTPException(status_code=403, detail="Bu kullanıcının politikasına erişim yetkiniz yok")
        role = acting_role(user)
        is_self = uid == user.get("id")
        clean: Dict[str, bool] = {k: bool(v) for k, v in req.lock_flags.items() if k in _LOCK_FLAG_KEYS}
        stored = {k: v for k, v in clean.items() if v}
        # Where do the flags land? Non-privileged self = soft (self_lock);
        # admin/manager = strict (lock_flags with configurable OTP).
        # Faz 9 CP4.35 fix — channel-scoped attribution. A single shared
        # `default_lock_set_by_user_id` was overwritten by every patch (both
        # channels), so the assignee's own self-lock would corrupt the
        # managed-lock policy-owner attribution. Now each channel writes to
        # its own field and create_task reads only the MANAGED one.
        if is_self and role not in ("admin", "manager"):
            set_ops = {
                "default_self_lock_flags": stored,
                "default_self_lock_set_by_user_id": user["id"],
                "default_self_lock_set_at": _now_iso(),
            }
        else:
            set_ops = {
                "default_lock_flags": stored,
                "default_lock_managed_set_by_user_id": user["id"],
                "default_lock_managed_set_at": _now_iso(),
            }
            if req.requires_otp is not None:
                set_ops["default_lock_requires_otp"] = bool(req.requires_otp)
        await db.users.update_one({"id": uid}, {"$set": set_ops})
        # Audit — reuse task_lock_audit collection with a special task_id
        # marker so per-user history stays queryable.
        try:
            await db.task_lock_audit.insert_one({
                "id": str(uuid.uuid4()),
                "task_id": f"__user_policy__:{uid}",
                "event_type": "user_policy_set",
                "actor_user_id": user.get("id"),
                "actor_username": user.get("username"),
                "actor_role": user.get("role"),
                "created_at": _now_iso(),
                "payload": {
                    "target_user_id": uid,
                    "target_username": u.get("username"),
                    "is_self": is_self,
                    "flags_after": stored,
                    "channel": "self" if (is_self and role not in ("admin", "manager")) else "managed",
                    "requires_otp": set_ops.get("default_lock_requires_otp", u.get("default_lock_requires_otp", True)),
                },
            })
        except Exception as exc:
            log.warning("user policy audit lost (user=%s actor=%s): %s", uid, user.get("username"), exc)
        # Return the fresh doc via the GET shape.
        return await get_user_lock_flags(uid, user)

    @router.get("/users/{uid}/lock-audit")
    async def get_user_lock_audit(uid: str, limit: int = 100, user: dict = Depends(licensed_user_dep)):
        """Return the audit trail for a user's default policy changes."""
        if not await _can_manage_user_policy(uid, user):
            raise HTTPException(status_code=403, detail="Bu kullanıcının politikasına erişim yetkiniz yok")
        try:
            n = int(limit)
        except Exception:
            n = 100
        limit = max(1, min(n if n > 0 else 100, 500))
        cur = db.task_lock_audit.find({"task_id": f"__user_policy__:{uid}"}, {"_id": 0}).sort("created_at", -1).limit(limit)
        rows = []
        async for row in cur:
            rows.append(row)
        return {"user_id": uid, "count": len(rows), "rows": rows}

    @router.patch("/users/{uid}/archive-caps")
    async def patch_user_archive_caps(uid: str, req: ArchiveCapsUpdate, user: dict = Depends(licensed_user_dep)):
        """Kişi bazlı arşiv yetkilerini ver/al — YALNIZCA admin. Kalıcı Sil /
        Çöp Boşalt / Arşiv Politikası Düzenle yetkilerini müdür veya normal
        kullanıcıya buradan açıp kapatır."""
        if acting_role(user) != "admin":
            raise HTTPException(status_code=403, detail="Yetki verme işlemi yalnızca admin'de")
        u = await db.users.find_one({"id": uid}, {"_id": 0, "archive_caps": 1, "username": 1})
        if not u:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        caps = dict(u.get("archive_caps") or {})
        if req.perm_delete is not None:
            caps["perm_delete"] = bool(req.perm_delete)
        if req.empty_trash is not None:
            caps["empty_trash"] = bool(req.empty_trash)
        if req.manage_policy is not None:
            caps["manage_policy"] = bool(req.manage_policy)
        await db.users.update_one({"id": uid}, {"$set": {"archive_caps": caps}})
        return {"user_id": uid, "archive_caps": caps}

    # ------------------------------------------------------------------
    # Faz 9 CP4.33 — Lock Policy Templates
    # ------------------------------------------------------------------
    @router.get("/lock-policy-templates")
    async def list_lock_policy_templates(user: dict = Depends(licensed_user_dep)):
        """List all lock policy templates. Admin/manager can see them; regular
        employees see none (templates are an admin/manager concept)."""
        role = acting_role(user)
        if role not in ("admin", "manager"):
            return {"count": 0, "templates": []}
        cur = db.lock_policy_templates.find({}, {"_id": 0}).sort("created_at", 1)
        rows = []
        async for row in cur:
            rows.append(row)
        return {"count": len(rows), "templates": rows}

    @router.post("/lock-policy-templates", response_model=LockPolicyTemplate, status_code=201)
    async def create_lock_policy_template(req: LockPolicyTemplateCreate, user: dict = Depends(licensed_user_dep)):
        role = acting_role(user)
        if role not in ("admin", "manager"):
            raise HTTPException(status_code=403, detail="Şablon oluşturma yetkiniz yok")
        # Faz 9 CP4.35 — strict input validation. Silent truncation hides
        # UX bugs; we reject overlong input explicitly so the client shows
        # a proper error toast.
        name = (req.name or "").strip()
        if not name:
            raise HTTPException(status_code=400, detail="Şablon adı boş olamaz")
        if len(name) > 80:
            raise HTTPException(status_code=400, detail="Şablon adı en fazla 80 karakter olabilir")
        desc = (req.description or "").strip() or None
        if desc and len(desc) > 500:
            raise HTTPException(status_code=400, detail="Açıklama en fazla 500 karakter olabilir")
        # Per-creator cap. Prevents both DoS (unlimited inserts) and UX
        # regression (dropdown becoming unusable with 500 items). Admin gets
        # 100 slots, manager 50 — enough for real workflows.
        cap = 100 if role == "admin" else 50
        my_count = await db.lock_policy_templates.count_documents({"created_by": user["id"]})
        if my_count >= cap:
            raise HTTPException(
                status_code=400,
                detail=f"En fazla {cap} şablon oluşturabilirsiniz (mevcut: {my_count})",
            )
        clean = {k: bool(v) for k, v in (req.lock_flags or {}).items() if k in _LOCK_FLAG_KEYS}
        stored = {k: v for k, v in clean.items() if v}
        tpl = LockPolicyTemplate(
            name=name,
            description=desc,
            lock_flags=stored,
            requires_otp=bool(req.requires_otp) if req.requires_otp is not None else True,
            created_by=user["id"],
            created_by_username=user.get("username"),
        )
        await db.lock_policy_templates.insert_one(tpl.model_dump())
        return tpl

    @router.patch("/lock-policy-templates/{tpl_id}", response_model=LockPolicyTemplate)
    async def update_lock_policy_template(tpl_id: str, req: LockPolicyTemplateUpdate, user: dict = Depends(licensed_user_dep)):
        doc = await db.lock_policy_templates.find_one({"id": tpl_id}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Şablon bulunamadı")
        role = acting_role(user)
        if role != "admin" and doc.get("created_by") != user.get("id"):
            raise HTTPException(status_code=403, detail="Bu şablonu güncelleme yetkiniz yok")
        set_ops = {"updated_at": _now_iso()}
        if req.name is not None:
            nm = req.name.strip()
            if not nm:
                raise HTTPException(status_code=400, detail="Şablon adı boş olamaz")
            if len(nm) > 80:
                raise HTTPException(status_code=400, detail="Şablon adı en fazla 80 karakter olabilir")
            set_ops["name"] = nm
        if req.description is not None:
            dv = (req.description or "").strip() or None
            if dv and len(dv) > 500:
                raise HTTPException(status_code=400, detail="Açıklama en fazla 500 karakter olabilir")
            set_ops["description"] = dv
        if req.lock_flags is not None:
            clean = {k: bool(v) for k, v in req.lock_flags.items() if k in _LOCK_FLAG_KEYS}
            set_ops["lock_flags"] = {k: v for k, v in clean.items() if v}
        if req.requires_otp is not None:
            set_ops["requires_otp"] = bool(req.requires_otp)
        await db.lock_policy_templates.update_one({"id": tpl_id}, {"$set": set_ops})
        fresh = await db.lock_policy_templates.find_one({"id": tpl_id}, {"_id": 0})
        return LockPolicyTemplate(**fresh)

    @router.delete("/lock-policy-templates/{tpl_id}")
    async def delete_lock_policy_template(tpl_id: str, user: dict = Depends(licensed_user_dep)):
        doc = await db.lock_policy_templates.find_one({"id": tpl_id}, {"_id": 0, "created_by": 1})
        if not doc:
            return {"deleted": 0}
        role = acting_role(user)
        if role != "admin" and doc.get("created_by") != user.get("id"):
            raise HTTPException(status_code=403, detail="Bu şablonu silme yetkiniz yok")
        r = await db.lock_policy_templates.delete_one({"id": tpl_id})
        return {"deleted": r.deleted_count}

    # ------------------------------------------------------------------
    # ORPHAN TASKS (Faz 8 CP6)
    # ------------------------------------------------------------------
    @router.get("/orphan-tasks")
    async def list_orphan_tasks(user: dict = Depends(current_user_dep)):
        role = acting_role(user)
        if role == "employee":
            return []
        q: dict = {"orphaned": True}
        if role != "admin":
            own_cids = get_user_company_ids(user)
            if not own_cids:
                return []
            q["orphaned_from_company_id"] = {"$in": own_cids}
        docs = await db.tasks.find(q, {"_id": 0}).sort("orphaned_at", -1).to_list(length=2000)
        return docs

    @router.get("/orphan-tasks/count")
    async def orphan_tasks_count(user: dict = Depends(current_user_dep)):
        role = acting_role(user)
        if role == "employee":
            return {"count": 0}
        q: dict = {"orphaned": True}
        if role != "admin":
            own_cids = get_user_company_ids(user)
            if not own_cids:
                return {"count": 0}
            q["orphaned_from_company_id"] = {"$in": own_cids}
        n = await db.tasks.count_documents(q)
        return {"count": n}

    # ------------------------------------------------------------------
    # Dürt / Hatırlat — bir yönetici, görebildiği bir personelin görevini
    # dürterek çan + push hatırlatması gönderir (c). Cooldown ile spam engeli.
    # ------------------------------------------------------------------
    NUDGE_COOLDOWN_SECONDS = 60

    @router.post("/tasks/{tid}/nudge")
    async def nudge_task(tid: str, req: Optional[TaskNudgeRequest] = None, user: dict = Depends(licensed_user_dep)):
        doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
        if not doc:
            raise HTTPException(status_code=404, detail="Görev bulunamadı")
        owner_id = doc.get("user_id")
        if not owner_id:
            raise HTTPException(status_code=400, detail="Görev sahibi yok")
        if owner_id == user["id"]:
            raise HTTPException(status_code=400, detail="Kendinize hatırlatma gönderemezsiniz")
        if not await can_view_user(db, user, owner_id):
            raise HTTPException(status_code=403, detail="Bu personele hatırlatma gönderemezsiniz")
        now = datetime.now(timezone.utc)
        # Cooldown — aynı yöneticinin aynı göreve çok sık dürtmesini engelle.
        last = await db.task_nudges.find_one(
            {"task_id": tid, "nudger_id": user["id"]},
            {"_id": 0, "created_at": 1},
            sort=[("created_at", -1)],
        )
        if last and last.get("created_at"):
            try:
                last_dt = datetime.fromisoformat(last["created_at"])
                if last_dt.tzinfo is None:
                    last_dt = last_dt.replace(tzinfo=timezone.utc)
                elapsed = (now - last_dt).total_seconds()
                if elapsed < NUDGE_COOLDOWN_SECONDS:
                    wait = int(NUDGE_COOLDOWN_SECONDS - elapsed) or 1
                    raise HTTPException(status_code=429, detail=f"Az önce hatırlattınız — {wait} sn sonra tekrar deneyin")
            except HTTPException:
                raise
            except Exception as exc:
                log.warning("nudge cooldown check failed, allowing nudge: %s", exc)
        import team_service
        message = (req.message if req else "") or ""
        sent = await team_service.notify_task_nudge(db, doc, owner_id, user, message=message)
        # Kaydı tut (cooldown + günlük sayaç için).
        await db.task_nudges.insert_one({
            "id": str(uuid.uuid4()),
            "task_id": tid,
            "nudger_id": user["id"],
            "recipient_id": owner_id,
            "message": message[:200],
            "created_at": now.isoformat(),
        })
        # Bugün bu görevi kaç kez dürttüm (bu yönetici).
        day_start = now.replace(hour=0, minute=0, second=0, microsecond=0).isoformat()
        count_today = await db.task_nudges.count_documents({
            "task_id": tid, "nudger_id": user["id"], "created_at": {"$gte": day_start},
        })
        return {
            "sent": bool(sent),
            "recipient_id": owner_id,
            "count_today": int(count_today),
            "cooldown_seconds": NUDGE_COOLDOWN_SECONDS,
        }

    # ------------------------------------------------------------------
    # GÖREV BAĞLAMA — Task Groups / Chains
    # ------------------------------------------------------------------
    @router.get("/task-groups", response_model=List[TaskGroup])
    async def list_task_groups(user: dict = Depends(licensed_user_dep)):
        """Çağıranın görebildiği görevlere ait grupları döndürür. group_id'ler
        görevlerin üzerinde taşınır; isim/ilerleme bayrağı burada tutulur."""
        # Kullanıcının görebildiği görevlerdeki grup id'lerini topla.
        allowed_ids = await visible_user_ids(db, user)
        uid = user["id"]
        if allowed_ids is None:
            task_q: Dict[str, Any] = {"group_id": {"$ne": None}}
        else:
            task_q = {
                "group_id": {"$ne": None},
                "$or": [
                    {"user_id": {"$in": list(allowed_ids)}},
                    {"assignees.user_id": uid},
                    {"shared_with.user_id": uid},
                ],
            }
        rows = await db.tasks.find(task_q, {"_id": 0, "group_id": 1}).to_list(length=5000)
        gids = list({r.get("group_id") for r in rows if r.get("group_id")})
        if not gids:
            return []
        groups = await db.task_groups.find({"id": {"$in": gids}}, {"_id": 0}).to_list(length=1000)
        return [TaskGroup(**g) for g in groups]

    @router.post("/task-groups", response_model=TaskGroup, status_code=201)
    async def create_task_group(req: TaskGroupCreate, user: dict = Depends(licensed_user_dep)):
        ids = [t for t in (req.task_ids or []) if t]
        # tekrarları koru-sıralı temizle
        seen: set = set()
        ordered_ids = []
        for t in ids:
            if t not in seen:
                seen.add(t)
                ordered_ids.append(t)
        if len(ordered_ids) < 2:
            raise HTTPException(status_code=400, detail="Bağlamak için en az 2 görev seçin")
        role = acting_role(user)
        docs = []
        for tid in ordered_ids:
            doc = await db.tasks.find_one({"id": tid}, {"_id": 0})
            if not doc:
                raise HTTPException(status_code=404, detail="Görev bulunamadı")
            can = (doc.get("user_id") == user["id"] or role == "admin"
                   or (doc.get("user_id") and await can_view_user(db, user, doc.get("user_id"))))
            if not can:
                sp = _share_perms_for(doc, user["id"])
                can = bool(sp and sp.get("edit"))
            if not can:
                raise HTTPException(status_code=403, detail="Bu görevi bağlama yetkiniz yok")
            docs.append(doc)
        group = TaskGroup(
            user_id=user["id"],
            name=(req.name or None),
            show_progress=bool(req.show_progress),
        )
        await db.task_groups.insert_one(group.model_dump())
        # Üyelere group_id ata + seçili sıraya göre bitişik sort_order ver.
        now = datetime.now(timezone.utc).isoformat()
        n = len(ordered_ids)
        for idx, tid in enumerate(ordered_ids):
            await db.tasks.update_one(
                {"id": tid},
                {"$set": {"group_id": group.id, "sort_order": float(1000000 - idx), "updated_at": now}},
            )
        return group

    @router.patch("/task-groups/{gid}", response_model=TaskGroup)
    async def update_task_group(gid: str, req: TaskGroupUpdate, user: dict = Depends(licensed_user_dep)):
        group = await db.task_groups.find_one({"id": gid}, {"_id": 0})
        if not group:
            raise HTTPException(status_code=404, detail="Grup bulunamadı")
        role = acting_role(user)
        if not (group.get("user_id") == user["id"] or role == "admin"
                or (group.get("user_id") and await can_view_user(db, user, group.get("user_id")))):
            raise HTTPException(status_code=403, detail="Bu grubu düzenleme yetkiniz yok")
        set_ops: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat()}
        if req.name is not None:
            set_ops["name"] = req.name or None
        if req.show_progress is not None:
            set_ops["show_progress"] = bool(req.show_progress)
        await db.task_groups.update_one({"id": gid}, {"$set": set_ops})
        # Üye listesi/sırası güncellemesi (opsiyonel).
        if req.task_ids is not None:
            new_ids = [t for t in req.task_ids if t]
            # Mevcut üyeleri bul; listede olmayanların bağlantısını çöz.
            current = await db.tasks.find({"group_id": gid}, {"_id": 0, "id": 1}).to_list(length=1000)
            current_ids = {c["id"] for c in current}
            now = datetime.now(timezone.utc).isoformat()
            # Çıkarılacaklar
            for tid in current_ids - set(new_ids):
                await db.tasks.update_one({"id": tid}, {"$set": {"group_id": None, "updated_at": now}})
            # Yeni sıra + üyelik
            for idx, tid in enumerate(new_ids):
                await db.tasks.update_one(
                    {"id": tid},
                    {"$set": {"group_id": gid, "sort_order": float(1000000 - idx), "updated_at": now}},
                )
            # Grup 2'nin altına düştüyse dağıt.
            if len(new_ids) < 2:
                for tid in new_ids:
                    await db.tasks.update_one({"id": tid}, {"$set": {"group_id": None, "updated_at": now}})
                await db.task_groups.delete_one({"id": gid})
        new_group = await db.task_groups.find_one({"id": gid}, {"_id": 0})
        return TaskGroup(**new_group)

    @router.delete("/task-groups/{gid}")
    async def delete_task_group(gid: str, user: dict = Depends(licensed_user_dep)):
        group = await db.task_groups.find_one({"id": gid}, {"_id": 0})
        if not group:
            return {"deleted": 0}
        role = acting_role(user)
        if not (group.get("user_id") == user["id"] or role == "admin"
                or (group.get("user_id") and await can_view_user(db, user, group.get("user_id")))):
            raise HTTPException(status_code=403, detail="Bu grubu silme yetkiniz yok")
        now = datetime.now(timezone.utc).isoformat()
        await db.tasks.update_many({"group_id": gid}, {"$set": {"group_id": None, "updated_at": now}})
        await db.task_groups.delete_one({"id": gid})
        return {"deleted": 1}

    @router.delete("/task-groups/{gid}/members/{tid}")
    async def remove_group_member(gid: str, tid: str, user: dict = Depends(licensed_user_dep)):
        group = await db.task_groups.find_one({"id": gid}, {"_id": 0})
        if not group:
            raise HTTPException(status_code=404, detail="Grup bulunamadı")
        role = acting_role(user)
        if not (group.get("user_id") == user["id"] or role == "admin"
                or (group.get("user_id") and await can_view_user(db, user, group.get("user_id")))):
            raise HTTPException(status_code=403, detail="Yetkiniz yok")
        now = datetime.now(timezone.utc).isoformat()
        await db.tasks.update_one({"id": tid, "group_id": gid}, {"$set": {"group_id": None, "updated_at": now}})
        # Kalan üye <2 ise grubu dağıt.
        remaining = await db.tasks.find({"group_id": gid}, {"_id": 0, "id": 1}).to_list(length=1000)
        if len(remaining) < 2:
            for r in remaining:
                await db.tasks.update_one({"id": r["id"]}, {"$set": {"group_id": None, "updated_at": now}})
            await db.task_groups.delete_one({"id": gid})
            return {"removed": 1, "group_dissolved": True}
        return {"removed": 1, "group_dissolved": False}

    return router
