"""Sertex — Overdue-task daily push notification cron.

Every morning at 09:00 Europe/Istanbul (06:00 UTC) we scan all users and
count their non-done, non-paused, past-due tasks. If a user has ≥ 1 overdue
task we send a single aggregated FCM push instead of one push per task —
this respects both attention and FCM quota.

Design notes
------------
* Runs inside the same event loop as the rest of the FastAPI app via
  AsyncIOScheduler (already used by backup_service).
* Idempotent start: guarded by a module-level `_scheduler` singleton.
* Time zone: hard-coded to Europe/Istanbul because Sertex is a Turkish B2B
  tool and users expect the alert during their local morning. If we ship
  to other regions we'll switch to per-user tz via `user.timezone`.
* Skips FCM if `fcm_service._ensure_admin()` returns False so tests /
  local dev without the SA JSON don't crash the scheduler.
"""
from __future__ import annotations

import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, List

import fcm_service

logger = logging.getLogger(__name__)

_scheduler = None
_TZ = "Europe/Istanbul"


async def _find_overdue_by_user(db) -> Dict[str, Dict[str, Any]]:
    """Group overdue tasks by user_id. Returns
    { user_id: {"count": n, "sample_titles": [...], "username": "..."} }.

    "Overdue" = status ∈ {pending, overdue} AND due_date < now AND not archived.
    Done/paused tasks are always excluded. We cap `sample_titles` at 3 so the
    push body stays under FCM's ~256-char soft limit.
    """
    now_iso = datetime.now(timezone.utc).isoformat()
    by_user: Dict[str, Dict[str, Any]] = {}
    cur = db.tasks.find(
        {
            "status": {"$in": ["pending", "overdue"]},
            "due_date": {"$lt": now_iso, "$ne": None},
            "archived": {"$ne": True},
            "digest_muted": {"$ne": True},
        },
        {"_id": 0, "user_id": 1, "title": 1, "id": 1},
    ).limit(5000)  # sanity cap — production should never hit this
    async for t in cur:
        uid = t.get("user_id")
        if not uid:
            continue
        bucket = by_user.setdefault(uid, {"count": 0, "sample_titles": [], "task_ids": []})
        bucket["count"] += 1
        if len(bucket["sample_titles"]) < 3:
            bucket["sample_titles"].append(t.get("title") or "(başlıksız)")
            bucket["task_ids"].append(t.get("id"))
    # Attach usernames — one query, small memory footprint.
    if by_user:
        uids = list(by_user.keys())
        async for u in db.users.find({"id": {"$in": uids}}, {"_id": 0, "id": 1, "username": 1}):
            by_user.get(u["id"], {})["username"] = u.get("username")
    return by_user


async def _send_overdue_pushes(db, target_hour: int | None = None) -> Dict[str, Any]:
    """Send one aggregated push per user with overdue tasks.

    `target_hour` verilirse yalnızca günlük özet saati bu saate eşit olan
    kullanıcılara gönderilir (saatlik cron bunu kullanır). None ise herkese
    (manuel/admin tetikleme). `digest_enabled == False` kullanıcılar atlanır.
    """
    by_user = await _find_overdue_by_user(db)
    if not by_user:
        return {"users": 0, "sent": 0, "failed": 0, "digest": {"users": 0, "created": 0}}
    import team_service
    settings_map = await team_service.get_digest_settings_map(db)
    default_hour = int(os.environ.get("SERTEX_OVERDUE_PUSH_HOUR", "9"))
    try:
        from zoneinfo import ZoneInfo
        is_weekend = datetime.now(ZoneInfo(_TZ)).weekday() >= 5
    except Exception:
        is_weekend = False
    total_sent = 0
    total_failed = 0
    fcm_users = 0
    for uid, info in by_user.items():
        st = settings_map.get(uid) or {}
        if not st.get("digest_enabled", True):
            continue
        hour = int(st.get("digest_hour", default_hour))
        if target_hour is not None and hour != int(target_hour):
            continue
        if is_weekend and st.get("digest_skip_weekend", False):
            continue
        fcm_users += 1
        n = info["count"]
        # Title stays short — matches Android's ~50-char first line budget.
        title = f"{n} gecikmiş görev" if n > 1 else "1 gecikmiş görev"
        # Body lists up to 3 titles + a "+N daha" hint.
        preview = " · ".join(info["sample_titles"])
        if n > len(info["sample_titles"]):
            preview += f"  · +{n - len(info['sample_titles'])} daha"
        try:
            res = await fcm_service.send_to_user(
                db,
                uid,
                title=title,
                body=preview[:220],
                data={
                    "kind": "overdue_digest",
                    "count": str(n),
                    # If the user has exactly one overdue task, deep-link
                    # straight to it. Otherwise open the tasks panel.
                    "task_id": info["task_ids"][0] if n == 1 else "",
                },
            )
            total_sent += res.get("sent", 0)
            total_failed += res.get("failed", 0)
        except Exception as exc:  # pragma: no cover
            logger.warning("overdue push failed for uid=%s: %s", uid, exc)
            total_failed += 1
    # Günlük Tekrar Hatırlatma — in-app özet bildirimi (bell + masaüstü),
    # FCM'den bağımsız çalışır ve her sabah tekrar tetiklenir (tarih bazlı dedup).
    # Aynı saat filtresi in-app tarafta da uygulanır.
    digest: Dict[str, Any] = {"users": 0, "created": 0}
    try:
        digest = await team_service.notify_overdue_daily_digest(db, target_hour=target_hour)
    except Exception as exc:  # pragma: no cover
        logger.warning("in-app overdue daily digest failed: %s", exc)
    return {"users": fcm_users, "sent": total_sent, "failed": total_failed, "digest": digest}
def start_overdue_scheduler(db) -> None:
    """Start the hourly overdue push cron (Europe/Istanbul). Each user is
    notified at their own `digest_hour` (default 09:00). Idempotent."""
    global _scheduler
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger

    if _scheduler is not None:
        return

    minute = int(os.environ.get("SERTEX_OVERDUE_PUSH_MINUTE", "0"))

    scheduler = AsyncIOScheduler(timezone=_TZ)

    def _current_ist_hour() -> int:
        try:
            from zoneinfo import ZoneInfo
            return datetime.now(ZoneInfo(_TZ)).hour
        except Exception:
            return datetime.now(timezone.utc).hour

    async def _job():
        try:
            hr = _current_ist_hour()
            logger.info("Overdue push cron starting… (hour=%02d %s)", hr, _TZ)
            r = await _send_overdue_pushes(db, target_hour=hr)
            logger.info("Overdue push cron finished: %d user(s), %d sent, %d failed, digest=%s",
                        r["users"], r["sent"], r["failed"], r.get("digest"))
        except Exception as e:
            logger.exception("Overdue push cron failed: %s", e)

    scheduler.add_job(
        _job,
        CronTrigger(minute=minute),  # her saat başı — kullanıcı bazlı saat filtresi _job içinde
        id="sertex-overdue-push",
        replace_existing=True,
        misfire_grace_time=1800,  # 30 min — geç kalırsa da tetiklensin
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Overdue push scheduler started (hourly, per-user digest hour, %s)", _TZ)


def stop_overdue_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception as exc:
            logger.warning("overdue push scheduler shutdown failed: %s", exc)
        _scheduler = None


# --------------------------------------------------------------------------
# Admin-facing manual trigger (also handy for testing).
# --------------------------------------------------------------------------
async def run_overdue_push_now(db) -> Dict[str, Any]:
    """Fire the digest push immediately without waiting for the cron.
    Returns the same summary shape as the scheduled job."""
    return await _send_overdue_pushes(db)
