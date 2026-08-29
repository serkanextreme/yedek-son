"""Web Push abonelik yönetimi (VAPID). Faz — Web Push Bildirimleri.

Frontend akışı: GET /push/vapid-public-key → PushManager.subscribe(...) →
POST /push/subscribe. Bildirimler `push_service.send_web_push_to_user` ile,
merkezi `_insert_notification` hook'undan otomatik gönderilir.
"""
from datetime import datetime, timezone
import os

from fastapi import APIRouter, Body, Depends, HTTPException

from push_service import send_web_push_to_user


def build_push_router(db, current_user_dep) -> APIRouter:
    router = APIRouter()

    @router.get("/push/vapid-public-key")
    async def vapid_public_key():
        return {"publicKey": os.environ.get("VAPID_PUBLIC_KEY", "")}

    @router.post("/push/subscribe")
    async def subscribe(subscription: dict = Body(...), user: dict = Depends(current_user_dep)):
        endpoint = subscription.get("endpoint")
        keys = subscription.get("keys")
        if not endpoint or not isinstance(keys, dict) or not keys.get("p256dh") or not keys.get("auth"):
            raise HTTPException(status_code=400, detail="Geçersiz abonelik")
        now = datetime.now(timezone.utc).isoformat()
        await db.push_subscriptions.update_one(
            {"endpoint": endpoint},
            {
                "$set": {"user_id": user["id"], "endpoint": endpoint, "keys": keys, "updated_at": now},
                "$setOnInsert": {"created_at": now},
            },
            upsert=True,
        )
        return {"subscribed": True}

    @router.post("/push/unsubscribe")
    async def unsubscribe(endpoint: str = Body(..., embed=True), user: dict = Depends(current_user_dep)):
        r = await db.push_subscriptions.delete_one({"endpoint": endpoint, "user_id": user["id"]})
        return {"removed": r.deleted_count}

    @router.post("/push/test")
    async def test_push(user: dict = Depends(current_user_dep)):
        n = await send_web_push_to_user(db, user["id"], "SERTEX", "Test bildirimi ✓ Tarayıcı bildirimleri çalışıyor.", "/")
        return {"sent": n}

    return router
