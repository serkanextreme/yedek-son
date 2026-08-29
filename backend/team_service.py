"""Faz 8 · Team Faz 2 — overdue task scanner + heat-map aggregation.

Overdue scanner
---------------
Runs as a background asyncio loop kicked off in server.startup. Every
`OVERDUE_SCAN_INTERVAL_S` seconds it walks the `tasks` collection looking for
non-done, non-archived rows whose `due_date` has passed. For each newly
detected overdue row it inserts one notification per stakeholder:
  * the task owner (personal reminder)
  * every manager who may see that owner (fan-out via
    `permissions.managers_who_can_see`)

De-duplication is enforced by a compound unique index
`(user_id, task_id, type)` so restarts, jitter, and clock skew don't
double-notify.

Due-soon scanner (Faz 8 CP5)
----------------------------
Second pass over the same collection: for each non-overdue task with a
`due_date` in the future, compute the resolved reminder threshold via the
priority chain (task > user > company > system default 3). If the task is
within the threshold window, insert a `due_soon_task` notification for the
owner + fan-out to visible managers. The `tasks.due_soon_fired_at_days`
field is used to avoid re-firing the same layer when the scanner runs
again on an already-warned task.

Heat map
--------
`build_heatmap(db, viewer, days)` returns a per-member list of daily task
completion counts over the last N days. Uses a single mongo aggregation
grouped by `(user_id, YYYY-MM-DD)` on `tasks.updated_at` where `status='done'`.
"""
from __future__ import annotations

import asyncio
import logging
import os
import time
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from permissions import managers_who_can_see, visible_user_ids

logger = logging.getLogger(__name__)

# --------------------------------------------------------------------------
# Config
# --------------------------------------------------------------------------
# How often the scanner wakes up. Kept short so overdue notifications appear
# within the same session where the task expired; the scanner is O(N) and
# idempotent so this stays cheap.
OVERDUE_SCAN_INTERVAL_S = int(os.environ.get("SERTEX_OVERDUE_SCAN_INTERVAL_S", "300"))
NOTIF_TYPE_OVERDUE = "overdue_task"
NOTIF_TYPE_DUE_SOON = "due_soon_task"
NOTIF_TYPE_OVERDUE_DAILY = "overdue_daily"   # her sabah tekrar (tarih bazlı dedup)
DEFAULT_DIGEST_HOUR = int(os.environ.get("SERTEX_OVERDUE_PUSH_HOUR", "9"))
# Faz 9 CP1 — Cross-company permission workflow notification types.
NOTIF_TYPE_CROSS_PERM_REQUEST = "cross_perm_request"     # sent to target-company managers
NOTIF_TYPE_CROSS_PERM_RESPONSE = "cross_perm_response"   # sent back to the requester
NOTIF_TYPE_CROSS_PERM_REVOKED = "cross_perm_revoked"     # sent when an active grant is revoked
# Faz 10 — sent to a company manager when an employee leaves the company and
# their unfinished tasks are moved to the "Yarım Kalan İşler" pool.
NOTIF_TYPE_TASKS_ORPHANED = "tasks_orphaned"
# Görev Paylaşımı — sent to a user when a task is shared with them (ÖZELLİK B).
NOTIF_TYPE_TASK_SHARED = "task_shared"
NOTIF_TYPE_TASK_NUDGE = "task_nudge"          # manager pokes an employee about a task
# 2026-06 — Süreli süper yönetici uyarıları. `expiring` = süre dolmadan (varsayılan
# 60 dk önce) hem kişiye hem kurucuya; `expired` = süre dolunca (proaktif geri
# dönüş + bilgi). task_id yok → dedup, kullanıcı üzerindeki `super_admin_expiry_warned`
# bayrağı + geri dönüşte rol değişimi ile sağlanır.
NOTIF_TYPE_SUPER_EXPIRING = "super_admin_expiring"
NOTIF_TYPE_SUPER_EXPIRED = "super_admin_expired"
SUPER_EXPIRY_WARN_MINUTES = int(os.environ.get("SERTEX_SUPER_EXPIRY_WARN_MIN", "60"))
# Frontend Hata Radarı — yeni istemci (tarayıcı/mobil) hatası düşünce
# süper yöneticilere anlık bildirim. Spam'i önlemek için AYARLANABİLİR cooldown
# (dk): aynı pencerede biriken hatalar tek bildirimde toplanır. Değer
# system_settings.key='global' → client_error_notify_cooldown_min içinde tutulur.
NOTIF_TYPE_CLIENT_ERROR = "client_error"
CLIENT_ERROR_NOTIFY_DEFAULT_COOLDOWN_MIN = 15
# System-wide fallback (must match server.SYSTEM_DEFAULT_REMINDER_DAYS).
SYSTEM_DEFAULT_REMINDER_DAYS = 3
_ALLOWED_THRESHOLD_DAYS = {1, 2, 3, 5, 7, 14}


# --------------------------------------------------------------------------
# Model
# --------------------------------------------------------------------------
class Notification(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: str                 # recipient
    type: str                    # 'overdue_task' | 'due_soon_task' | future types
    task_id: Optional[str] = None
    task_title: Optional[str] = None
    owner_user_id: Optional[str] = None
    owner_username: Optional[str] = None
    is_for_manager: bool = False  # True when this row is the fan-out copy
    # Faz 8 CP5 — For `due_soon_task` rows: how many days remain until due.
    # Lets the UI render "3 gün kaldı" / "1 gün kaldı" without recomputing.
    days_until_due: Optional[int] = None
    # Faz 9 CP1 — Cross-perm rows carry these instead of task_id:
    #   permission_id : the company_permissions row this notif is about
    #   viewer_company_name / target_company_name : denormalized labels for the
    #     bell popover so the UI can render without an extra roundtrip
    permission_id: Optional[str] = None
    viewer_company_name: Optional[str] = None
    target_company_name: Optional[str] = None
    payload: Dict[str, Any] = Field(default_factory=dict)
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    read_at: Optional[str] = None


# --------------------------------------------------------------------------
# Indexes
# --------------------------------------------------------------------------
async def ensure_indexes(db) -> None:
    # (user_id, task_id, type) prevents dedup races.
    await db.notifications.create_index(
        [("user_id", 1), ("task_id", 1), ("type", 1)],
        unique=True,
        partialFilterExpression={"task_id": {"$type": "string"}},
        name="notif_dedup_task",
    )
    await db.notifications.create_index([("user_id", 1), ("created_at", -1)])
    await db.notifications.create_index([("user_id", 1), ("read_at", 1)])
    # Dürt/Nudge — cooldown + günlük sayaç sorguları için (c).
    await db.task_nudges.create_index([("task_id", 1), ("nudger_id", 1), ("created_at", -1)])
    # Web Push abonelikleri — endpoint benzersiz, kullanıcı bazlı sorgu.
    await db.push_subscriptions.create_index("endpoint", unique=True, name="push_sub_endpoint")
    await db.push_subscriptions.create_index([("user_id", 1)])


# --------------------------------------------------------------------------
# Overdue scanner
# --------------------------------------------------------------------------
async def _insert_notification(db, row: Notification) -> bool:
    """Insert row, swallowing DuplicateKey errors. Returns True if inserted."""
    try:
        await db.notifications.insert_one(row.model_dump())
        # Faz 9 CP4.17 — push the fresh row to any open SSE subscriber for
        # this user so the bell updates instantly (no need to wait for the
        # 60-second poll). Best-effort; never let a pubsub hiccup break the
        # notification write path.
        try:
            from notification_pubsub import pubsub
            await pubsub.publish(row.user_id, {
                "kind": "new",
                "notification": row.model_dump(mode="json"),
            })
        except Exception as pub_e:
            logger.debug("pubsub publish skipped: %s", pub_e)
        # Web Push — best-effort tarayıcı bildirimi (aynı olay için).
        try:
            from push_service import send_web_push_to_user, notification_push_text
            title, body, url = notification_push_text(row.model_dump(mode="json"))
            await send_web_push_to_user(db, row.user_id, title, body, url)
        except Exception as push_e:
            logger.debug("web push skipped: %s", push_e)
        return True
    except Exception as e:
        # pymongo raises DuplicateKeyError; we treat any insert-time failure as
        # "already exists" (idempotent) so the scanner never gets stuck.
        if "duplicate key" in str(e).lower() or "E11000" in str(e):
            return False
        logger.exception("notification insert failed: %s", e)
        return False


# --------------------------------------------------------------------------
# Frontend Hata Radarı — süper yöneticilere anlık "yeni hata" bildirimi
# --------------------------------------------------------------------------
# Config cache (60 sn) + son bildirim zamanı (in-memory cooldown guard). PUT ile
# ayar değişince `invalidate_ce_cfg_cache()` çağrılıp anında yenilenir.
_ce_cfg_cache: Dict[str, Any] = {"ts": 0.0, "cooldown_min": CLIENT_ERROR_NOTIFY_DEFAULT_COOLDOWN_MIN, "enabled": True}
_last_client_error_notify_ts: float = 0.0


def invalidate_ce_cfg_cache() -> None:
    _ce_cfg_cache["ts"] = 0.0


async def _get_ce_cfg(db):
    now = time.time()
    if now - _ce_cfg_cache["ts"] < 60:
        return _ce_cfg_cache["cooldown_min"], _ce_cfg_cache["enabled"]
    doc = await db.system_settings.find_one(
        {"key": "global"},
        {"_id": 0, "client_error_notify_cooldown_min": 1, "client_error_notify_enabled": 1},
    ) or {}
    cd = doc.get("client_error_notify_cooldown_min")
    cd = int(cd) if isinstance(cd, (int, float)) and cd else CLIENT_ERROR_NOTIFY_DEFAULT_COOLDOWN_MIN
    en = doc.get("client_error_notify_enabled")
    en = True if en is None else bool(en)
    _ce_cfg_cache.update({"ts": now, "cooldown_min": cd, "enabled": en})
    return cd, en


async def notify_super_admins_client_error(db, log_doc: dict) -> int:
    """Yeni bir istemci hatası kaydedilince süper yöneticileri (Kurucu + aktif
    super_admin) çan + web push ile uyarır. Ayarlanabilir cooldown içinde en
    fazla bir toplu bildirim üretir (o penceredeki hata sayısını da taşır).
    Best-effort; asla hata fırlatmaz."""
    global _last_client_error_notify_ts
    cooldown_min, enabled = await _get_ce_cfg(db)
    if not enabled:
        return 0
    now_mono = time.time()
    if now_mono - _last_client_error_notify_ts < cooldown_min * 60:
        return 0
    # Slotu await'lerden ÖNCE al → eşzamanlı hata seli çoklu bildirim üretmesin.
    _last_client_error_notify_ts = now_mono

    recip_docs = await db.users.find(
        {"$or": [{"is_owner": True}, {"role": "super_admin"}]},
        {"_id": 0, "id": 1},
    ).to_list(length=500)
    ids = [r["id"] for r in recip_docs if r.get("id")]
    if not ids:
        return 0

    window_start = (datetime.now(timezone.utc) - timedelta(minutes=cooldown_min)).isoformat()
    try:
        recent_count = await db.client_logs.count_documents({"created_at": {"$gte": window_start}})
    except Exception:
        recent_count = 1
    payload = {
        "message": (log_doc.get("message") or "")[:200],
        "source": log_doc.get("source"),
        "user_agent": log_doc.get("user_agent"),
        "level": log_doc.get("level"),
        "count": max(1, int(recent_count or 1)),
        "log_username": log_doc.get("username"),
    }
    inserted = 0
    for uid in ids:
        if await _insert_notification(db, Notification(
            user_id=uid, type=NOTIF_TYPE_CLIENT_ERROR,
            owner_username=log_doc.get("username"), payload=payload,
        )):
            inserted += 1
    return inserted


# --------------------------------------------------------------------------
# Görev Paylaşımı — task shared notification (ÖZELLİK B)
# --------------------------------------------------------------------------
async def notify_task_shared(db, task: dict, recipient_ids: List[str], sharer: dict) -> int:
    """Insert a `task_shared` notification (bell + SSE) and fire an FCM push
    for each recipient. Best-effort — returns the number of bell rows inserted.
    """
    inserted = 0
    sharer_name = (sharer or {}).get("username") or "Bir kullanıcı"
    title = task.get("title") or "Görev"
    for uid in recipient_ids:
        if not uid:
            continue
        row = Notification(
            user_id=uid,
            type=NOTIF_TYPE_TASK_SHARED,
            task_id=task.get("id"),
            task_title=title,
            owner_user_id=(sharer or {}).get("id"),
            owner_username=sharer_name,
            payload={"sharer_username": sharer_name},
        )
        if await _insert_notification(db, row):
            inserted += 1
        try:
            import fcm_service
            await fcm_service.send_to_user(
                db,
                uid,
                title=f"Görev paylaşıldı · {sharer_name}",
                body=title[:180],
                data={"kind": "task", "task_id": task.get("id") or "", "event": "shared"},
            )
        except Exception:  # pragma: no cover — push is best-effort
            pass
    return inserted


# --------------------------------------------------------------------------
# Dürt / Hatırlat — manager pokes an employee about a task (c)
# --------------------------------------------------------------------------
async def notify_task_nudge(db, task: dict, recipient_id: str, nudger: dict, message: str = "") -> bool:
    """Insert a `task_nudge` bell notification (+ SSE + FCM push) for the task
    owner. task_id lives in `payload` (not the indexed field) so a manager can
    nudge repeatedly. Best-effort — returns True if the bell row was inserted."""
    if not recipient_id:
        return False
    nudger_name = (nudger or {}).get("username") or "Yöneticiniz"
    title = task.get("title") or "Görev"
    row = Notification(
        user_id=recipient_id,
        type=NOTIF_TYPE_TASK_NUDGE,
        task_id=None,  # repeatable — bypass the (user,task,type) dedup index
        task_title=title,
        owner_user_id=(nudger or {}).get("id"),
        owner_username=nudger_name,
        payload={
            "task_id": task.get("id") or "",
            "nudger_username": nudger_name,
            "message": (message or "").strip()[:200],
        },
    )
    inserted = await _insert_notification(db, row)
    try:
        import fcm_service
        await fcm_service.send_to_user(
            db,
            recipient_id,
            title=f"Hatırlatma · {nudger_name}",
            body=(message.strip()[:180] if message else f"{title[:150]} görevini hatırlattı"),
            data={"kind": "task", "task_id": task.get("id") or "", "event": "nudge"},
        )
    except Exception:  # pragma: no cover — push is best-effort
        pass
    return inserted


# --------------------------------------------------------------------------
# Faz 10 — Offboarding: employee leaves a company
# --------------------------------------------------------------------------
async def offboard_user_from_company(
    db,
    uid: str,
    company_id: Optional[str],
    actor: Optional[dict] = None,
    target_doc: Optional[dict] = None,
    reassign_to_manager: bool = True,
) -> Dict[str, Any]:
    """Handle a user's tasks when they leave `company_id` (company change,
    removal from a company, or account deletion).

    Rules (confirmed with the product owner):
      * FINISHED tasks (status='done') tied to that company are moved to the
        Archive (archived=True).
      * UNFINISHED tasks tied to that company are flipped into the "Yarım
        Kalan İşler" orphan pool (orphaned=True, orphaned_from_company_id).
        When `reassign_to_manager` is True and the company still has a
        manager (other than the leaving user), those tasks are ALSO
        re-assigned to that manager so they surface in the manager's own
        task list, and the manager gets an in-app + push notification.

    Returns `{"archived": int, "orphaned": int, "manager_id": Optional[str]}`.
    Personal / other-company tasks are never touched (filtered by company_id).
    """
    if not company_id:
        return {"archived": 0, "orphaned": 0, "manager_id": None}
    now_iso = datetime.now(timezone.utc).isoformat()
    if target_doc is None:
        target_doc = await db.users.find_one({"id": uid}, {"_id": 0}) or {}
    username = target_doc.get("username")

    # 1) Archive finished tasks belonging to this (user, company) pair.
    arch = await db.tasks.update_many(
        {
            "user_id": uid,
            "company_id": company_id,
            "status": "done",
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        },
        {"$set": {"archived": True, "archived_at": now_iso, "updated_at": now_iso}},
    )
    archived = arch.modified_count if arch else 0

    # 2) Find a manager of the company to receive the unfinished tasks.
    manager = None
    if reassign_to_manager:
        manager = await db.users.find_one(
            {
                "role": "manager",
                "id": {"$ne": uid},
                "$or": [{"company_id": company_id}, {"company_ids": company_id}],
            },
            {"_id": 0, "id": 1, "username": 1, "company_name": 1},
        )

    # 3) Move unfinished tasks into the orphan pool (optionally re-assigned).
    set_ops: Dict[str, Any] = {
        "orphaned": True,
        "orphaned_at": now_iso,
        "orphaned_from_company_id": company_id,
        "prev_assignee_user_id": uid,
        "prev_assignee_name": username,
        "updated_at": now_iso,
    }
    if manager:
        set_ops["user_id"] = manager["id"]
        set_ops["assignee_name"] = manager.get("username")
    res = await db.tasks.update_many(
        {
            "user_id": uid,
            "company_id": company_id,
            "status": {"$nin": ["done"]},
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        },
        {"$set": set_ops},
    )
    orphaned = res.modified_count if res else 0

    # 4) Notify the receiving manager (best-effort — never fail the caller).
    if manager and orphaned:
        try:
            notif = Notification(
                user_id=manager["id"],
                type=NOTIF_TYPE_TASKS_ORPHANED,
                owner_user_id=uid,
                owner_username=username,
                is_for_manager=True,
                payload={
                    "company_id": company_id,
                    "count": orphaned,
                    "archived": archived,
                    "prev_assignee_username": username,
                },
            )
            await _insert_notification(db, notif)
        except Exception:
            logger.exception("offboard notification failed")
        try:
            import fcm_service
            await fcm_service.send_to_user(
                db,
                manager["id"],
                title="Boşta görevler size aktarıldı",
                body=f"{username or 'Bir çalışan'} ayrıldı — {orphaned} görev size aktarıldı",
                data={"kind": "orphan", "event": "assigned", "count": str(orphaned)},
            )
        except Exception as exc:
            logger.warning("orphan-assigned FCM push to manager failed: %s", exc)

    return {
        "archived": archived,
        "orphaned": orphaned,
        "manager_id": manager["id"] if manager else None,
    }


async def notify_task_transferred_to_company(db, task_doc: dict, target_company_id: str, actor: dict) -> int:
    """Şirkete Devret — hedef şirketin müdürlerine bildirim + FCM push (best-
    effort). `tasks_orphaned` tipini yeniden kullanır (bell zaten "Yarım Kalan
    İşler" sekmesine yönlendiriyor). Returns inserted notification count."""
    if not target_company_id:
        return 0
    target_company = await db.companies.find_one(
        {"id": target_company_id}, {"_id": 0, "name": 1},
    ) or {}
    managers = await db.users.find(
        {"role": "manager", "$or": [{"company_id": target_company_id}, {"company_ids": target_company_id}]},
        {"_id": 0, "id": 1},
    ).to_list(length=200)
    actor_name = (actor or {}).get("username") or "Yönetici"
    task_title = task_doc.get("title") or "Görev"
    fired = 0
    for m in managers:
        row = Notification(
            user_id=m["id"],
            type=NOTIF_TYPE_TASKS_ORPHANED,
            task_id=task_doc.get("id"),
            task_title=task_title,
            owner_username=task_doc.get("prev_assignee_name") or task_doc.get("assignee_name"),
            is_for_manager=True,
            payload={
                "company_id": target_company_id,
                "target_company_name": target_company.get("name"),
                "transferred_by": actor_name,
                "event": "company_transfer",
                "count": 1,
            },
        )
        if await _insert_notification(db, row):
            fired += 1
    # FCM push (best-effort).
    try:
        import fcm_service
        for m in managers:
            await fcm_service.send_to_user(
                db,
                m["id"],
                title="Şirketinize görev devredildi",
                body=f"{actor_name}: {task_title[:140]}",
                data={"kind": "orphan", "event": "company_transfer"},
            )
    except Exception as exc:
        logger.warning("company-transfer FCM push failed: %s", exc)
    return fired



# --------------------------------------------------------------------------
# Faz 9 CP1 — Cross-company permission notification helpers
# --------------------------------------------------------------------------
async def notify_cross_perm_request(db, permission_row: dict) -> int:
    """Fan-out a `cross_perm_request` notification to every manager of the
    target company. Called when a manager (of viewer_company) opens a
    pending grant request. Returns the number of notifications inserted.
    """
    target_cid = permission_row.get("target_company_id")
    viewer_cid = permission_row.get("viewer_company_id")
    if not target_cid or not viewer_cid:
        return 0
    viewer_company = await db.companies.find_one({"id": viewer_cid}, {"_id": 0, "name": 1}) or {}
    target_company = await db.companies.find_one({"id": target_cid}, {"_id": 0, "name": 1}) or {}
    target_managers = await db.users.find(
        {"role": "manager", "$or": [{"company_id": target_cid}, {"company_ids": target_cid}]},
        {"_id": 0, "id": 1},
    ).to_list(length=200)
    fired = 0
    for m in target_managers:
        row = Notification(
            user_id=m["id"],
            type=NOTIF_TYPE_CROSS_PERM_REQUEST,
            permission_id=permission_row.get("id"),
            viewer_company_name=viewer_company.get("name"),
            target_company_name=target_company.get("name"),
            is_for_manager=True,
            payload={
                "viewer_company_id": viewer_cid,
                "target_company_id": target_cid,
                "requested_by": permission_row.get("requested_by"),
                "status": permission_row.get("status", "pending"),
            },
        )
        if await _insert_notification(db, row):
            fired += 1
    return fired


async def notify_cross_perm_response(db, permission_row: dict, approved: bool) -> int:
    """Notify all managers of the viewer_company that a pending request was
    resolved. If a specific requester is set AND belongs to viewer_company,
    also make sure they're on the list; but we broadcast to every viewer
    manager so admin-instant grants surface too (they don't have a manager
    requester).
    """
    viewer_cid = permission_row.get("viewer_company_id")
    target_cid = permission_row.get("target_company_id")
    if not viewer_cid:
        return 0
    viewer_company = await db.companies.find_one({"id": viewer_cid}, {"_id": 0, "name": 1}) or {}
    target_company = await db.companies.find_one({"id": target_cid}, {"_id": 0, "name": 1}) or {}
    managers = await db.users.find(
        {"role": "manager", "$or": [{"company_id": viewer_cid}, {"company_ids": viewer_cid}]},
        {"_id": 0, "id": 1},
    ).to_list(length=200)
    recipient_ids = {m["id"] for m in managers}
    if permission_row.get("requested_by"):
        recipient_ids.add(permission_row["requested_by"])
    fired = 0
    for uid in recipient_ids:
        row = Notification(
            user_id=uid,
            type=NOTIF_TYPE_CROSS_PERM_RESPONSE,
            permission_id=permission_row.get("id"),
            viewer_company_name=viewer_company.get("name"),
            target_company_name=target_company.get("name"),
            payload={
                "viewer_company_id": viewer_cid,
                "target_company_id": target_cid,
                "approved": bool(approved),
                "responded_by": permission_row.get("responded_by"),
                "status": "active" if approved else "declined",
            },
        )
        if await _insert_notification(db, row):
            fired += 1
    return fired


async def notify_cross_perm_revoked(db, permission_row: dict) -> int:
    """Notify all managers of the viewer_company that a previously-active
    cross-company grant has been revoked (their team just lost visibility).
    """
    viewer_cid = permission_row.get("viewer_company_id")
    target_cid = permission_row.get("target_company_id")
    if not viewer_cid:
        return 0
    viewer_company = await db.companies.find_one({"id": viewer_cid}, {"_id": 0, "name": 1}) or {}
    target_company = await db.companies.find_one({"id": target_cid}, {"_id": 0, "name": 1}) or {}
    managers = await db.users.find(
        {"role": "manager", "$or": [{"company_id": viewer_cid}, {"company_ids": viewer_cid}]},
        {"_id": 0, "id": 1},
    ).to_list(length=200)
    fired = 0
    for m in managers:
        row = Notification(
            user_id=m["id"],
            type=NOTIF_TYPE_CROSS_PERM_REVOKED,
            permission_id=permission_row.get("id"),
            viewer_company_name=viewer_company.get("name"),
            target_company_name=target_company.get("name"),
            payload={
                "viewer_company_id": viewer_cid,
                "target_company_id": target_cid,
                "revoked_by": permission_row.get("responded_by"),
                "status": "revoked",
            },
        )
        if await _insert_notification(db, row):
            fired += 1
    return fired


async def scan_and_notify_overdue(db) -> Dict[str, int]:
    """One pass over `tasks`. Returns per-run counts (for tests + logging)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    q = {
        "status": {"$nin": ["done"]},
        "$and": [
            {"$or": [{"archived": {"$exists": False}}, {"archived": False}]},
            {"due_date": {"$ne": None, "$lt": now_iso}},
        ],
    }
    tasks_seen = 0
    self_notifs = 0
    manager_notifs = 0
    async for t in db.tasks.find(q, {"_id": 0, "id": 1, "user_id": 1, "title": 1}):
        tasks_seen += 1
        owner_id = t.get("user_id")
        if not owner_id:
            continue
        owner_doc = await db.users.find_one(
            {"id": owner_id}, {"_id": 0, "username": 1},
        )
        owner_username = owner_doc.get("username") if owner_doc else None
        # 1) self-notification
        if await _insert_notification(db, Notification(
            user_id=owner_id, type=NOTIF_TYPE_OVERDUE, task_id=t["id"],
            task_title=t.get("title"), owner_user_id=owner_id,
            owner_username=owner_username, is_for_manager=False,
        )):
            self_notifs += 1
        # 2) manager fan-out
        manager_ids = await managers_who_can_see(db, owner_id)
        for mid in manager_ids:
            if await _insert_notification(db, Notification(
                user_id=mid, type=NOTIF_TYPE_OVERDUE, task_id=t["id"],
                task_title=t.get("title"), owner_user_id=owner_id,
                owner_username=owner_username, is_for_manager=True,
            )):
                manager_notifs += 1
    return {"tasks_seen": tasks_seen, "self": self_notifs, "manager": manager_notifs}


def _ist_now() -> datetime:
    try:
        from zoneinfo import ZoneInfo
        return datetime.now(ZoneInfo("Europe/Istanbul"))
    except Exception:
        return datetime.now(timezone.utc)


def _parse_iso(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        d = datetime.fromisoformat(str(s).replace("Z", "+00:00"))
        if d.tzinfo is None:
            d = d.replace(tzinfo=timezone.utc)
        return d
    except Exception:
        return None


async def notify_overdue_daily_digest(db, target_hour: Optional[int] = None) -> Dict[str, int]:
    """Günlük Tekrar Hatırlatma — hâlâ geciken görevleri olan HER kullanıcıya
    (görev sahibi) sabah TEK bir özet in-app bildirimi oluşturur.

    Dedup anahtarı tarihi içerir (`task_id="overdue-daily:YYYY-MM-DD"`), böylece
    aynı gün içinde tekrar çağrılsa da yalnızca tek satır oluşur (idempotent);
    ertesi sabah yeni tarih → yeni satır → masaüstü/bell bildirimi tekrar çalar.

    Kişiselleştirme:
    * `target_hour` verilirse yalnızca `digest_hour == target_hour` olan
      kullanıcılar için üretir. None ise herkes için (manuel/admin tetikleme).
    * `digest_enabled == False` → atlanır.
    * `digest_skip_weekend == True` ve bugün Cmt/Paz (Istanbul) → atlanır.
    * `digest_detailed == True` → özet, en geç kalan 3 görevi "kaç gün gecikti"
      bilgisiyle listeler.
    * `digest_muted == True` görevler sayıma dahil EDİLMEZ (görev bazlı sessiz).
    """
    now = datetime.now(timezone.utc)
    day_key = now.strftime("%Y-%m-%d")
    is_weekend = _ist_now().weekday() >= 5  # 5=Cmt, 6=Paz
    settings_map = await get_digest_settings_map(db)
    q = {
        "status": {"$nin": ["done"]},
        "digest_muted": {"$ne": True},
        "$and": [
            {"$or": [{"archived": {"$exists": False}}, {"archived": False}]},
            {"due_date": {"$ne": None, "$lt": now.isoformat()}},
        ],
    }
    by_user: Dict[str, Dict[str, Any]] = {}
    async for t in db.tasks.find(q, {"_id": 0, "id": 1, "user_id": 1, "title": 1, "due_date": 1}):
        uid = t.get("user_id")
        if not uid:
            continue
        b = by_user.setdefault(uid, {"count": 0, "items": []})
        b["count"] += 1
        if len(b["items"]) < 200:  # sanity cap per user
            b["items"].append({
                "title": t.get("title") or "(başlıksız)",
                "due_date": t.get("due_date"),
                "id": t.get("id"),
            })
    created = 0
    skipped = 0
    for uid, info in by_user.items():
        st = settings_map.get(uid) or {}
        if not st.get("digest_enabled", True):
            skipped += 1
            continue
        if target_hour is not None and int(st.get("digest_hour", DEFAULT_DIGEST_HOUR)) != int(target_hour):
            skipped += 1
            continue
        if is_weekend and st.get("digest_skip_weekend", False):
            skipped += 1
            continue
        n = info["count"]
        # En geç kalan görevler önce (en eski due_date).
        items_sorted = sorted(info["items"], key=lambda x: x.get("due_date") or "")
        top = items_sorted[:3]
        detailed = bool(st.get("digest_detailed", False))
        if detailed:
            parts = []
            for it in top:
                due = _parse_iso(it.get("due_date"))
                if due is not None:
                    days = max(0, (now - due).days)
                    lbl = f"{days} gün gecikti" if days >= 1 else "bugün gecikti"
                else:
                    lbl = "gecikti"
                parts.append(f"{it['title']} ({lbl})")
            preview = " · ".join(parts)
        else:
            preview = " · ".join(it["title"] for it in top)
        if n > len(top):
            preview += f" · +{n - len(top)} daha"
        first_id = top[0]["id"] if (n == 1 and top) else ""
        if await _insert_notification(db, Notification(
            user_id=uid,
            type=NOTIF_TYPE_OVERDUE_DAILY,
            task_id=f"overdue-daily:{day_key}",
            task_title=preview[:240],
            owner_user_id=uid,
            is_for_manager=False,
            payload={
                "count": n,
                "date": day_key,
                "first_task_id": first_id,
                "detailed": detailed,
            },
        )):
            created += 1
    return {"users": len(by_user), "created": created, "skipped": skipped, "date": day_key}


# --------------------------------------------------------------------------
# Günlük özet kişisel ayarları (per-user digest hour + enable) — DB'de
# `notification_settings` koleksiyonunda user_id anahtarıyla saklanır.
# --------------------------------------------------------------------------
def _digest_defaults() -> Dict[str, Any]:
    return {
        "digest_hour": DEFAULT_DIGEST_HOUR,
        "digest_enabled": True,
        "digest_detailed": False,
        "digest_skip_weekend": False,
    }


async def get_digest_settings_map(db) -> Dict[str, Dict[str, Any]]:
    out: Dict[str, Dict[str, Any]] = {}
    async for s in db.notification_settings.find(
        {}, {"_id": 0, "user_id": 1, "digest_hour": 1, "digest_enabled": 1,
             "digest_detailed": 1, "digest_skip_weekend": 1}
    ):
        out[s["user_id"]] = {
            "digest_hour": int(s.get("digest_hour", DEFAULT_DIGEST_HOUR)),
            "digest_enabled": bool(s.get("digest_enabled", True)),
            "digest_detailed": bool(s.get("digest_detailed", False)),
            "digest_skip_weekend": bool(s.get("digest_skip_weekend", False)),
        }
    return out


async def get_user_digest_settings(db, uid: str) -> Dict[str, Any]:
    s = await db.notification_settings.find_one({"user_id": uid}, {"_id": 0}) or {}
    d = _digest_defaults()
    return {
        "digest_hour": int(s.get("digest_hour", d["digest_hour"])),
        "digest_enabled": bool(s.get("digest_enabled", d["digest_enabled"])),
        "digest_detailed": bool(s.get("digest_detailed", d["digest_detailed"])),
        "digest_skip_weekend": bool(s.get("digest_skip_weekend", d["digest_skip_weekend"])),
    }


async def set_user_digest_settings(
    db, uid: str, hour: int, enabled: bool,
    detailed: bool = False, skip_weekend: bool = False,
) -> Dict[str, Any]:
    hour = max(0, min(23, int(hour)))
    await db.notification_settings.update_one(
        {"user_id": uid},
        {"$set": {
            "user_id": uid,
            "digest_hour": hour,
            "digest_enabled": bool(enabled),
            "digest_detailed": bool(detailed),
            "digest_skip_weekend": bool(skip_weekend),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }},
        upsert=True,
    )
    return {
        "digest_hour": hour,
        "digest_enabled": bool(enabled),
        "digest_detailed": bool(detailed),
        "digest_skip_weekend": bool(skip_weekend),
    }


# --------------------------------------------------------------------------
# Due-soon scanner (Faz 8 CP5)
# --------------------------------------------------------------------------
async def _resolve_threshold_for(db, owner_user: dict, task: dict) -> int:
    """Task-level > user-level > company-level > system default. Returns
    -1 when `reminder_disabled=True` at task level."""
    if task.get("reminder_disabled"):
        return -1
    td = task.get("reminder_days")
    if isinstance(td, int) and td in _ALLOWED_THRESHOLD_DAYS:
        return td
    utd = owner_user.get("due_soon_threshold")
    if isinstance(utd, int) and utd in _ALLOWED_THRESHOLD_DAYS:
        return utd
    # Company layer: only relevant when the owner is in team mode + has a
    # company. Personal-mode users skip this entirely.
    if owner_user.get("workspace_mode") == "team" and owner_user.get("company_id"):
        c = await db.companies.find_one(
            {"id": owner_user["company_id"]},
            {"_id": 0, "due_soon_threshold": 1},
        )
        if c and isinstance(c.get("due_soon_threshold"), int) and c["due_soon_threshold"] in _ALLOWED_THRESHOLD_DAYS:
            return c["due_soon_threshold"]
    return SYSTEM_DEFAULT_REMINDER_DAYS


def _parse_iso(dt_str: str) -> Optional[datetime]:
    """Parse a variety of ISO strings safely; return tz-aware UTC datetime."""
    if not dt_str:
        return None
    try:
        # Handle trailing 'Z'
        s = dt_str.replace("Z", "+00:00") if dt_str.endswith("Z") else dt_str
        dt = datetime.fromisoformat(s)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


async def scan_and_notify_due_soon(db) -> Dict[str, int]:
    """One pass over tasks whose due_date is in the FUTURE (not overdue).
    For each task within its resolved threshold window, fire a due_soon
    notification to owner + visible managers. Uses `due_soon_fired_at_days`
    on the task doc as a per-layer fired marker.
    """
    now = datetime.now(timezone.utc)
    now_iso = now.isoformat()
    q = {
        "status": {"$nin": ["done"]},
        "$and": [
            {"$or": [{"archived": {"$exists": False}}, {"archived": False}]},
            {"due_date": {"$ne": None, "$gt": now_iso}},
        ],
    }
    tasks_seen = 0
    self_notifs = 0
    manager_notifs = 0
    async for t in db.tasks.find(q, {
        "_id": 0, "id": 1, "user_id": 1, "title": 1, "due_date": 1,
        "reminder_days": 1, "reminder_disabled": 1, "due_soon_fired_at_days": 1,
    }):
        tasks_seen += 1
        owner_id = t.get("user_id")
        if not owner_id:
            continue
        owner_user = await db.users.find_one(
            {"id": owner_id},
            {"_id": 0, "id": 1, "username": 1, "workspace_mode": 1,
             "company_id": 1, "due_soon_threshold": 1},
        )
        if not owner_user:
            continue
        threshold = await _resolve_threshold_for(db, owner_user, t)
        if threshold < 0:
            # Explicitly disabled at task level.
            continue
        due_dt = _parse_iso(t.get("due_date"))
        if not due_dt:
            continue
        delta = due_dt - now
        days_until = int(delta.total_seconds() // 86400)
        # We use ceiling for negative deltas already filtered by query; here
        # delta > 0 → days_until >= 0.
        if delta.total_seconds() > 0 and days_until == 0 and delta.total_seconds() >= 3600:
            # Sub-24h remaining still counts as "0 gün kaldı = bugün son gün"
            days_until = 0
        # In-window check.
        if days_until > threshold:
            continue
        # Idempotency: only fire once per (task, layer). If the task was
        # already fired at the current threshold, skip. If threshold changed
        # (user/company/task update reset this field), it will re-fire.
        if t.get("due_soon_fired_at_days") == threshold:
            continue
        owner_username = owner_user.get("username")
        payload = {"threshold_days": threshold, "days_until_due": days_until}
        # 1) self-notification
        if await _insert_notification(db, Notification(
            user_id=owner_id, type=NOTIF_TYPE_DUE_SOON, task_id=t["id"],
            task_title=t.get("title"), owner_user_id=owner_id,
            owner_username=owner_username, is_for_manager=False,
            days_until_due=days_until, payload=payload,
        )):
            self_notifs += 1
        # 2) manager fan-out
        manager_ids = await managers_who_can_see(db, owner_id)
        for mid in manager_ids:
            if await _insert_notification(db, Notification(
                user_id=mid, type=NOTIF_TYPE_DUE_SOON, task_id=t["id"],
                task_title=t.get("title"), owner_user_id=owner_id,
                owner_username=owner_username, is_for_manager=True,
                days_until_due=days_until, payload=payload,
            )):
                manager_notifs += 1
        # Mark this task as fired at the current threshold so we don't
        # re-notify next scan cycle. If threshold changes elsewhere, this
        # marker gets reset by the update endpoint.
        await db.tasks.update_one(
            {"id": t["id"]},
            {"$set": {"due_soon_fired_at_days": threshold}},
        )
    return {"tasks_seen": tasks_seen, "self": self_notifs, "manager": manager_notifs}


_scanner_task: Optional[asyncio.Task] = None


async def scan_and_notify_super_admin_expiry(db) -> Dict[str, int]:
    """Süreli süper yöneticileri tarar. Süresine `SUPER_EXPIRY_WARN_MINUTES`
    dakika kalanları (bir kez) uyarır; süresi dolanları PROAKTİF olarak eski
    rolüne döndürür ve bilgilendirir. Hem ilgili kişiye hem de kuruculara
    (owner) bildirim gider. Kurucu (is_owner) hiçbir zaman taranmaz."""
    now = datetime.now(timezone.utc)
    warn_delta = timedelta(minutes=SUPER_EXPIRY_WARN_MINUTES)
    owner_docs = await db.users.find({"is_owner": True}, {"_id": 0, "id": 1}).to_list(length=100)
    owner_ids = [o["id"] for o in owner_docs]
    warned = 0
    expired = 0
    cur = db.users.find(
        {"role": "super_admin", "is_owner": {"$ne": True}, "super_admin_until": {"$ne": None}},
        {"_id": 0, "id": 1, "username": 1, "super_admin_until": 1, "prev_role": 1,
         "super_admin_expiry_warned": 1},
    )
    async for u in cur:
        until = _parse_iso(u.get("super_admin_until"))
        if not until:
            continue
        uname = u.get("username")
        if until <= now:
            reverted = u.get("prev_role") or "employee"
            await db.users.update_one(
                {"id": u["id"]},
                {"$set": {"role": reverted},
                 "$unset": {"super_admin_until": "", "prev_role": "",
                            "super_admin_expiry_warned": "", "super_admin_granted_by": "",
                            "super_admin_granted_at": ""}},
            )
            payload = {"username": uname, "reverted_role": reverted}
            await _insert_notification(db, Notification(
                user_id=u["id"], type=NOTIF_TYPE_SUPER_EXPIRED,
                owner_user_id=u["id"], owner_username=uname, payload=payload,
            ))
            for oid in owner_ids:
                if oid == u["id"]:
                    continue
                await _insert_notification(db, Notification(
                    user_id=oid, type=NOTIF_TYPE_SUPER_EXPIRED, is_for_manager=True,
                    owner_user_id=u["id"], owner_username=uname, payload=payload,
                ))
            expired += 1
        elif (until - now) <= warn_delta and not u.get("super_admin_expiry_warned"):
            mins_left = max(1, int((until - now).total_seconds() // 60))
            payload = {"username": uname, "minutes_left": mins_left,
                       "super_admin_until": u.get("super_admin_until")}
            await _insert_notification(db, Notification(
                user_id=u["id"], type=NOTIF_TYPE_SUPER_EXPIRING,
                owner_user_id=u["id"], owner_username=uname, payload=payload,
            ))
            for oid in owner_ids:
                if oid == u["id"]:
                    continue
                await _insert_notification(db, Notification(
                    user_id=oid, type=NOTIF_TYPE_SUPER_EXPIRING, is_for_manager=True,
                    owner_user_id=u["id"], owner_username=uname, payload=payload,
                ))
            await db.users.update_one({"id": u["id"]}, {"$set": {"super_admin_expiry_warned": True}})
            warned += 1
    return {"warned": warned, "expired": expired}


async def _scanner_loop(db) -> None:
    """Long-running background loop. Cheap by construction (dedup index)."""
    while True:
        try:
            counts = await scan_and_notify_overdue(db)
            if counts["self"] or counts["manager"]:
                logger.info("overdue_scanner: %s", counts)
            due_counts = await scan_and_notify_due_soon(db)
            if due_counts["self"] or due_counts["manager"]:
                logger.info("due_soon_scanner: %s", due_counts)
            sup = await scan_and_notify_super_admin_expiry(db)
            if sup["warned"] or sup["expired"]:
                logger.info("super_admin_expiry: %s", sup)
        except Exception as e:
            logger.exception("scanner iteration failed: %s", e)
        await asyncio.sleep(OVERDUE_SCAN_INTERVAL_S)


def start_scanner(db) -> None:
    """Kick off the scanner as a fire-and-forget background task."""
    global _scanner_task
    if _scanner_task is not None and not _scanner_task.done():
        return
    _scanner_task = asyncio.create_task(_scanner_loop(db))


def stop_scanner() -> None:
    global _scanner_task
    if _scanner_task is not None:
        _scanner_task.cancel()
        _scanner_task = None


# --------------------------------------------------------------------------
# Heat map
# --------------------------------------------------------------------------
async def build_heatmap(db, viewer: dict, days: int = 60) -> List[dict]:
    """Per-member daily task completion counts over the last `days` days.

    Rows returned only for users the viewer can see (self excluded to match
    /api/team/summary semantics). Response shape::

        [
          {"user_id", "username", "role", "company_name",
           "days": [{"date": "2026-07-01", "done": 3}, ...]}
        ]
    """
    if days <= 0 or days > 365:
        days = 60
    allowed_ids = await visible_user_ids(db, viewer)
    if allowed_ids is None:
        users_docs = await db.users.find(
            {"id": {"$ne": viewer["id"]}},
            {"_id": 0, "id": 1, "username": 1, "role": 1, "company_name": 1},
        ).to_list(length=5000)
    else:
        others = [uid for uid in allowed_ids if uid != viewer["id"]]
        if not others:
            return []
        users_docs = await db.users.find(
            {"id": {"$in": others}},
            {"_id": 0, "id": 1, "username": 1, "role": 1, "company_name": 1},
        ).to_list(length=5000)
    if not users_docs:
        return []
    user_ids = [u["id"] for u in users_docs]
    now = datetime.now(timezone.utc)
    start = (now - timedelta(days=days - 1)).replace(hour=0, minute=0, second=0, microsecond=0)
    start_iso = start.isoformat()
    # Aggregate `tasks` where status=done. Group by (user_id, YYYY-MM-DD of
    # updated_at). updated_at is an ISO string; substr(0, 10) gives the date.
    pipeline = [
        {"$match": {
            "user_id": {"$in": user_ids},
            "status": "done",
            "updated_at": {"$gte": start_iso},
        }},
        {"$group": {
            "_id": {
                "uid": "$user_id",
                "date": {"$substr": ["$updated_at", 0, 10]},
            },
            "done": {"$sum": 1},
        }},
    ]
    agg = await db.tasks.aggregate(pipeline).to_list(length=100000)
    # Fold into per-user dict of {date -> done}.
    by_user: Dict[str, Dict[str, int]] = {}
    for row in agg:
        uid = row["_id"]["uid"]
        date = row["_id"]["date"]
        by_user.setdefault(uid, {})[date] = int(row["done"])
    # Build a dense sequence for each user so the frontend can render a fixed
    # grid without extra date math.
    date_seq: List[str] = []
    d = start
    for _ in range(days):
        date_seq.append(d.strftime("%Y-%m-%d"))
        d += timedelta(days=1)
    out = []
    for u in users_docs:
        umap = by_user.get(u["id"], {})
        out.append({
            "user_id": u["id"],
            "username": u["username"],
            "role": u.get("role") or "employee",
            "company_name": u.get("company_name"),
            "days": [{"date": ds, "done": umap.get(ds, 0)} for ds in date_seq],
        })
    return out
