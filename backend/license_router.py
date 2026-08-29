"""FastAPI router for license management (Faz 5).

- `/api/license/me` — current user's license status
- `/api/license/redeem` — user redeems a key
- `/api/license/logout-others` — force-kick other sessions (rotates active_session_id)
- `/api/admin/licenses/*` — admin CRUD
"""
import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, Field

from license_service import (
    LICENSE_TYPES,
    create_licenses,
    redeem_license,
    license_status_for,
    list_licenses,
    get_license,
    update_license,
    delete_license,
    stats,
    is_admin,
)

logger = logging.getLogger(__name__)


def build_license_router(db, current_user):
    router = APIRouter(prefix="/license", tags=["license"])
    admin_router = APIRouter(prefix="/admin/licenses", tags=["admin-licenses"])

    async def _admin_only(user: dict = Depends(current_user)):
        if not is_admin(user):
            raise HTTPException(403, "Yalnızca yönetici bu işlemi yapabilir")
        return user

    # ---- User-facing endpoints ------------------------------------------
    class RedeemRequest(BaseModel):
        key: str = Field(min_length=6, max_length=64)

    @router.get("/me")
    async def me(user: dict = Depends(current_user)):
        return await license_status_for(db, user)

    @router.post("/redeem")
    async def redeem(req: RedeemRequest, user: dict = Depends(current_user)):
        lic = await redeem_license(db, user, req.key)
        return {"license": lic, "status": await license_status_for(db, user)}

    @router.post("/logout-others")
    async def logout_others(user: dict = Depends(current_user)):
        """Force-kick any other active sessions by rotating active_session_id.

        The current session becomes the new active one (JWT still valid via `sid`).
        """
        # We can't easily update our own JWT, so we instead read the current
        # sid from user record — this endpoint is meaningful only when called
        # from the SAME device the user just logged in from, which is our case.
        active = user.get("active_session_id")
        if not active:
            # No known session, nothing to kick
            return {"kicked": False}
        # Regenerate session so any other device with a stale sid gets 401.
        new_sid = str(uuid.uuid4())
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"active_session_id": new_sid}},
        )
        return {"kicked": True, "new_session_id": new_sid,
                "note": "Diğer cihazlar bir sonraki istekte çıkarılacak — mevcut oturumun için tekrar giriş yap"}

    # ---- Admin endpoints ------------------------------------------------
    class GenerateRequest(BaseModel):
        type: str
        count: int = Field(default=1, ge=1, le=500)
        notes: Optional[str] = None

    class UpdateRequest(BaseModel):
        status: Optional[str] = None
        extend_days: Optional[int] = None
        notes: Optional[str] = None

    @admin_router.get("/stats")
    async def stats_endpoint(_user: dict = Depends(_admin_only)):
        return await stats(db)

    @admin_router.get("/types")
    async def types_endpoint(_user: dict = Depends(_admin_only)):
        return {"types": list(LICENSE_TYPES.keys())}

    @admin_router.get("")
    async def list_all(
        status: Optional[str] = None,
        type: Optional[str] = None,
        _user: dict = Depends(_admin_only),
    ):
        docs = await list_licenses(db, status=status, license_type=type)
        return {"licenses": docs}

    @admin_router.post("/generate")
    async def generate(req: GenerateRequest, user: dict = Depends(_admin_only)):
        docs = await create_licenses(
            db,
            license_type=req.type,
            count=req.count,
            notes=req.notes,
            created_by=user["username"],
        )
        return {"created": len(docs), "licenses": docs}

    @admin_router.patch("/{license_id}")
    async def patch(
        license_id: str,
        req: UpdateRequest,
        _user: dict = Depends(_admin_only),
    ):
        lic = await update_license(
            db,
            license_id,
            status=req.status,
            extend_days=req.extend_days,
            notes=req.notes,
        )
        return lic

    @admin_router.delete("/{license_id}")
    async def delete(license_id: str, _user: dict = Depends(_admin_only)):
        return await delete_license(db, license_id)

    return router, admin_router
