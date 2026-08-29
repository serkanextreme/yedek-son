"""Web Push (VAPID) sender — tarayıcıya bildirim gönderimi.

`_insert_notification` (team_service) her bildirim yazımında best-effort olarak
`send_web_push_to_user` çağırır. pywebpush senkron olduğu için `asyncio.to_thread`
ile sarılır. 404/410 dönen (artık geçersiz) abonelikler otomatik silinir.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
from typing import Any, Dict, Tuple

from pywebpush import WebPushException, webpush

logger = logging.getLogger(__name__)

VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "mailto:admin@sertex-ai.com")


def _send_one(sub_info: Dict[str, Any], payload: str) -> None:
    webpush(
        subscription_info=sub_info,
        data=payload,
        vapid_private_key=VAPID_PRIVATE_KEY,
        vapid_claims={"sub": VAPID_SUBJECT},
    )


async def send_web_push_to_user(db, user_id: str, title: str, body: str, url: str = "/", tag: str | None = None) -> int:
    """Bir kullanıcının tüm tarayıcı aboneliklerine push gönderir. Gönderilen
    sayısını döner. VAPID yapılandırılmamışsa sessizce 0 döner."""
    if not VAPID_PRIVATE_KEY:
        return 0
    subs = await db.push_subscriptions.find({"user_id": user_id}, {"_id": 0}).to_list(length=100)
    if not subs:
        return 0
    payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag or "sertex"})
    sent = 0
    for s in subs:
        sub_info = {"endpoint": s.get("endpoint"), "keys": s.get("keys", {})}
        if not sub_info["endpoint"] or not sub_info["keys"]:
            continue
        try:
            await asyncio.to_thread(_send_one, sub_info, payload)
            sent += 1
        except WebPushException as e:
            status = getattr(getattr(e, "response", None), "status_code", None)
            if status in (404, 410):
                await db.push_subscriptions.delete_one({"endpoint": s["endpoint"]})
            else:
                logger.debug("web push failed (%s): %s", status, e)
        except Exception as e:  # noqa: BLE001 — best-effort, never break caller
            logger.debug("web push error: %s", e)
    return sent


def notification_push_text(row: Dict[str, Any]) -> Tuple[str, str, str]:
    """Bir Notification satırından (title, body, url) üretir."""
    t = row.get("type")
    title_map = {
        "task_shared": "Yeni paylaşılan görev",
        "task_nudge": "Hatırlatma",
        "overdue_task": "Geciken görev",
        "overdue_daily": "Geciken görev",
        "due_soon_task": "Yaklaşan görev",
        "cross_perm_request": "Yetki isteği",
        "cross_perm_response": "Yetki yanıtı",
        "cross_perm_revoked": "Yetki iptali",
        "tasks_orphaned": "Yarım kalan işler",
        "super_admin_expiring": "Süper yönetici süresi doluyor",
        "super_admin_expired": "Süper yönetici süresi doldu",
        "client_error": "Yeni ön yüz (frontend) hatası",
    }
    title = title_map.get(t, "SERTEX bildirimi")
    body = row.get("task_title") or ""
    if t == "due_soon_task" and row.get("days_until_due") is not None:
        suffix = f"{row['days_until_due']} gün kaldı"
        body = f"{body} — {suffix}" if body else suffix
    elif t == "super_admin_expiring":
        p = row.get("payload") or {}
        mins = p.get("minutes_left")
        who = p.get("username") or row.get("owner_username") or ""
        body = f"{who}: {mins} dk içinde süper yönetici yetkisi sona eriyor" if mins is not None else f"{who} süper yönetici yetkisi yakında sona eriyor"
    elif t == "super_admin_expired":
        p = row.get("payload") or {}
        who = p.get("username") or row.get("owner_username") or ""
        body = f"{who} artık süper yönetici değil — eski rolüne döndü"
    elif t == "client_error":
        p = row.get("payload") or {}
        cnt = p.get("count") or 1
        m = (p.get("message") or "")[:80]
        body = f"{cnt} yeni hata · {m}" if m else f"{cnt} yeni ön yüz hatası"
    url = f"/?task={row['task_id']}" if row.get("task_id") else "/"
    return title, body, url
