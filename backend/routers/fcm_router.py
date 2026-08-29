"""Sertex — FCM Push Notification endpoints.

- POST   /api/fcm/register-token     (user) → register device token (idempotent)
- POST   /api/fcm/unregister-token   (user) → remove one of my tokens
- GET    /api/fcm/tokens/me          (user) → list my active tokens
- GET    /api/fcm/status             (admin) → SDK ready + total active tokens
- POST   /api/fcm/test-send          (admin) → send a test push to a specific user

Endpoints are mounted at `/api/fcm/*` via `build_fcm_router()`.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Path
from pydantic import BaseModel, Field

import fcm_service
from auth import require_super_admin


logger = logging.getLogger(__name__)


class RegisterTokenIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=4096)
    platform: str = Field("android")  # android | ios | web
    device_id: Optional[str] = Field(None, max_length=200)


class UnregisterTokenIn(BaseModel):
    token: str = Field(..., min_length=10, max_length=4096)


class TestSendIn(BaseModel):
    user_id: str
    title: str = "Sertex test"
    body: str = "FCM entegrasyonu çalışıyor 🚀"


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def build_fcm_router(db, current_user_dep, require_admin) -> APIRouter:
    router = APIRouter(prefix="/fcm", tags=["fcm"])

    @router.post("/register-token")
    async def register_token(payload: RegisterTokenIn, user: dict = Depends(current_user_dep)):
        """Idempotent: same token → upsert. Cross-user token reassignment
        moves ownership (a shared device switching accounts)."""
        if payload.platform not in ("android", "ios", "web"):
            raise HTTPException(status_code=400, detail="platform android|ios|web olmalı")
        now = _now_iso()
        doc = {
            "user_id": user["id"],
            "user_username": user.get("username"),
            "company_id": user.get("company_id"),
            "role": user.get("role"),
            "token": payload.token,
            "platform": payload.platform,
            "device_id": payload.device_id,
            "created_at": now,
            "last_seen_at": now,
            "revoked_at": None,
        }
        existing = await db.fcm_tokens.find_one({"token": payload.token}, {"_id": 0, "id": 1, "user_id": 1})
        if existing:
            # Refresh ownership + timestamps.
            await db.fcm_tokens.update_one(
                {"token": payload.token},
                {"$set": {**doc, "id": existing.get("id") or str(uuid.uuid4())}},
            )
            return {"ok": True, "updated": True}
        doc["id"] = str(uuid.uuid4())
        await db.fcm_tokens.insert_one(doc)
        return {"ok": True, "updated": False, "id": doc["id"]}

    @router.post("/unregister-token")
    async def unregister_token(payload: UnregisterTokenIn, user: dict = Depends(current_user_dep)):
        r = await db.fcm_tokens.delete_one({"token": payload.token, "user_id": user["id"]})
        return {"ok": True, "removed": r.deleted_count}

    @router.get("/tokens/me")
    async def list_my_tokens(user: dict = Depends(current_user_dep)):
        cur = db.fcm_tokens.find(
            {"user_id": user["id"], "revoked_at": None},
            {"_id": 0, "token": 0},  # never leak the token itself back
        ).sort("last_seen_at", -1)
        return [row async for row in cur]

    @router.get("/status")
    async def fcm_status(user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        # Trigger init to reflect real state.
        ready = fcm_service._ensure_admin()
        total = await db.fcm_tokens.count_documents({"revoked_at": None})
        by_platform = {}
        for p in ("android", "ios", "web"):
            by_platform[p] = await db.fcm_tokens.count_documents({"revoked_at": None, "platform": p})
        return {
            "ready": ready,
            "project_id": __import__("os").environ.get("FIREBASE_PROJECT_ID"),
            "active_tokens": total,
            "by_platform": by_platform,
        }

    @router.post("/test-send")
    async def test_send(payload: TestSendIn, user: dict = Depends(current_user_dep)):
        require_super_admin(user)
        target = await db.users.find_one({"id": payload.user_id}, {"_id": 0, "id": 1, "username": 1})
        if not target:
            raise HTTPException(status_code=404, detail="Kullanıcı bulunamadı")
        res = await fcm_service.send_to_user(db, payload.user_id, payload.title, payload.body, data={"kind": "test"})
        return {"target_username": target.get("username"), **res}

    @router.post("/run-overdue-digest")
    async def run_overdue_digest(user: dict = Depends(current_user_dep)):
        """Manually trigger the overdue-task digest push (normally runs at
        09:00 Europe/Istanbul). Useful for admins wanting to nudge everyone
        with pending overdue tasks right now."""
        require_super_admin(user)
        try:
            import overdue_push_service
            return await overdue_push_service.run_overdue_push_now(db)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Digest çalıştırılamadı: {e}")

    return router
