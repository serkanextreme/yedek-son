"""Sertex — Firebase Cloud Messaging (FCM) service.

Thin async wrapper around the `firebase-admin` SDK (which is sync under the
hood). Exposes fire-and-forget helpers used by the announcement pipeline,
task assignment, OTP issuance, and overdue cron.

Design notes
------------
* Initialised lazily on first call so tests that don't touch push don't need
  the service-account file present. If the credential is missing we log a
  single WARN and every subsequent `send_*` call becomes a no-op returning
  {"disabled": True}.
* Every send happens on a threadpool via `asyncio.to_thread` — the SDK's
  `messaging.send_each_for_multicast` is blocking network I/O.
* Invalid tokens (UNREGISTERED / NOT_FOUND) are auto-purged from the
  `fcm_tokens` collection so the next fan-out doesn't waste FCM quota.
"""
from __future__ import annotations

import asyncio
import logging
import os
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional

logger = logging.getLogger(__name__)

_APP_INITIALISED = False
_APP_DISABLED = False  # set to True after a permanent init failure

# ---------------------------------------------------------------------------
# Init
# ---------------------------------------------------------------------------
def _ensure_admin() -> bool:
    """Idempotent init. Returns True if firebase_admin is usable, else False.
    False + logged WARN → every send silently short-circuits."""
    global _APP_INITIALISED, _APP_DISABLED
    if _APP_INITIALISED:
        return True
    if _APP_DISABLED:
        return False
    sa_path = os.environ.get("GOOGLE_APPLICATION_CREDENTIALS")
    project_id = os.environ.get("FIREBASE_PROJECT_ID")
    if not sa_path or not os.path.exists(sa_path):
        logger.warning("FCM disabled — GOOGLE_APPLICATION_CREDENTIALS missing or file not found (%s)", sa_path)
        _APP_DISABLED = True
        return False
    try:
        import firebase_admin
        from firebase_admin import credentials
        if not firebase_admin._apps:
            firebase_admin.initialize_app(
                credentials.Certificate(sa_path),
                {"projectId": project_id} if project_id else None,
            )
        _APP_INITIALISED = True
        logger.info("FCM initialised (project=%s)", project_id or "auto")
        return True
    except Exception as exc:
        logger.exception("FCM init failed permanently: %s", exc)
        _APP_DISABLED = True
        return False


# ---------------------------------------------------------------------------
# Token store helpers
# ---------------------------------------------------------------------------
async def _active_tokens(db, query: dict, limit: int = 500) -> List[dict]:
    """Return `[{token, user_id, id}, ...]` for active (non-revoked) rows."""
    cur = db.fcm_tokens.find(
        {**query, "revoked_at": None},
        {"_id": 0, "token": 1, "user_id": 1, "id": 1},
    ).limit(limit)
    return [row async for row in cur]


async def _mark_invalid(db, tokens: Iterable[str]) -> None:
    """Purge tokens FCM rejected as unregistered/invalid so we don't waste
    another round-trip on them. Kept as a background best-effort — a purge
    failure never propagates."""
    tks = [t for t in tokens if t]
    if not tks:
        return
    try:
        await db.fcm_tokens.delete_many({"token": {"$in": tks}})
    except Exception as exc:  # pragma: no cover
        logger.warning("failed to purge %d invalid FCM tokens: %s", len(tks), exc)


# ---------------------------------------------------------------------------
# Core send
# ---------------------------------------------------------------------------
def _sync_send_multicast(tokens: List[str], title: str, body: str, data: Optional[Dict[str, str]]) -> Dict[str, Any]:
    """Blocking helper — called via asyncio.to_thread."""
    from firebase_admin import messaging  # local import: SDK optional
    msg = messaging.MulticastMessage(
        tokens=tokens,
        notification=messaging.Notification(title=title, body=body),
        data={k: str(v) for k, v in (data or {}).items()},
        # Android channel + priority so lock-screen shows the toast even
        # when the app is killed.
        android=messaging.AndroidConfig(
            priority="high",
            notification=messaging.AndroidNotification(
                sound="default",
                channel_id="sertex_default",
            ),
        ),
    )
    resp = messaging.send_each_for_multicast(msg, dry_run=False)
    invalid: List[str] = []
    for i, r in enumerate(resp.responses):
        if not r.success and r.exception is not None:
            code = getattr(r.exception, "code", None) or ""
            if code in ("UNREGISTERED", "NOT_FOUND", "INVALID_ARGUMENT", "registration-token-not-registered"):
                invalid.append(tokens[i])
    return {
        "sent": resp.success_count,
        "failed": resp.failure_count,
        "invalid": invalid,
    }


async def send_to_tokens(db, tokens: List[str], title: str, body: str, data: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    """Send a notification to a list of raw FCM tokens (chunks of 500).
    Returns {"sent", "failed", "invalid"}. When FCM is disabled (no SA
    JSON at boot), returns {"disabled": True} without side effects."""
    if not _ensure_admin():
        return {"disabled": True, "sent": 0, "failed": 0}
    if not tokens:
        return {"sent": 0, "failed": 0}
    total_sent = 0
    total_failed = 0
    all_invalid: List[str] = []
    # FCM multicast caps at 500 tokens per call.
    for i in range(0, len(tokens), 500):
        chunk = tokens[i:i + 500]
        try:
            res = await asyncio.to_thread(_sync_send_multicast, chunk, title, body, data)
        except Exception as exc:
            logger.warning("FCM send chunk failed (size=%d): %s", len(chunk), exc)
            total_failed += len(chunk)
            continue
        total_sent += res["sent"]
        total_failed += res["failed"]
        all_invalid.extend(res["invalid"])
    if all_invalid:
        await _mark_invalid(db, all_invalid)
    return {"sent": total_sent, "failed": total_failed, "invalid": len(all_invalid)}


async def send_to_user(db, user_id: str, title: str, body: str, data: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    rows = await _active_tokens(db, {"user_id": user_id})
    return await send_to_tokens(db, [r["token"] for r in rows], title, body, data)


async def send_to_users(db, user_ids: List[str], title: str, body: str, data: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    if not user_ids:
        return {"sent": 0, "failed": 0}
    rows = await _active_tokens(db, {"user_id": {"$in": user_ids}})
    return await send_to_tokens(db, [r["token"] for r in rows], title, body, data)


async def send_to_role(db, role: str, title: str, body: str, data: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    user_ids: List[str] = []
    async for u in db.users.find({"role": role}, {"_id": 0, "id": 1}):
        if u.get("id"):
            user_ids.append(u["id"])
    return await send_to_users(db, user_ids, title, body, data)


async def send_to_company(db, company_id: str, title: str, body: str, data: Optional[Dict[str, str]] = None) -> Dict[str, Any]:
    user_ids: List[str] = []
    async for u in db.users.find({"company_id": company_id}, {"_id": 0, "id": 1}):
        if u.get("id"):
            user_ids.append(u["id"])
    return await send_to_users(db, user_ids, title, body, data)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()
