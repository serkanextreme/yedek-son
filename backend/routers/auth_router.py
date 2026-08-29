"""Sertex — Auth + Settings router.

Extracted from server.py (Faz 9 refactor). Groups /auth/* endpoints
(login, me, change-password, change-username) with the /settings/*
mutations (workspace mode + reminder threshold + reminder config).
"""
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel

from auth import (
    login as auth_login,
    change_password as auth_change_password,
    change_username as auth_change_username,
)
from permissions import is_super_admin as _is_super, get_admin_caps as _get_caps, effective_role as _eff_role

# System-wide fallback when neither user nor company set a threshold.
SYSTEM_DEFAULT_REMINDER_DAYS = 3
_ALLOWED_THRESHOLD_DAYS = {1, 2, 3, 5, 7, 14}


# ---------------------------------------------------------------------------
# Bodies
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    username: str
    password: str


class ChangePasswordRequest(BaseModel):
    current_password: str
    new_password: str


class ChangeUsernameRequest(BaseModel):
    current_password: str
    new_username: str


class WorkspaceModeUpdate(BaseModel):
    workspace_mode: str  # "personal" | "team"


class DualModeUpdate(BaseModel):
    dual_mode: bool = False


class ReminderThresholdUpdate(BaseModel):
    # Null / 0 / negative → clear (fall back to company/system default).
    days: Optional[int] = None


async def resolve_effective_reminder_days(db, user: dict, task: Optional[dict] = None) -> int:
    """Priority chain (Faz 8 CP5):
        1. task.reminder_disabled → -1 (disabled sentinel)
        2. task.reminder_days     (whitelist)
        3. user.due_soon_threshold
        4. company.due_soon_threshold (team mode only)
        5. SYSTEM_DEFAULT_REMINDER_DAYS
    """
    if task and task.get("reminder_disabled"):
        return -1
    if task and isinstance(task.get("reminder_days"), int) and task["reminder_days"] in _ALLOWED_THRESHOLD_DAYS:
        return task["reminder_days"]
    utd = user.get("due_soon_threshold")
    if isinstance(utd, int) and utd in _ALLOWED_THRESHOLD_DAYS:
        return utd
    if user.get("workspace_mode") == "team" and user.get("company_id"):
        c = await db.companies.find_one({"id": user["company_id"]}, {"_id": 0, "due_soon_threshold": 1})
        if c and isinstance(c.get("due_soon_threshold"), int) and c["due_soon_threshold"] in _ALLOWED_THRESHOLD_DAYS:
            return c["due_soon_threshold"]
    return SYSTEM_DEFAULT_REMINDER_DAYS


def build_auth_router(db, current_user_dep) -> APIRouter:
    router = APIRouter()

    # ------------------------------------------------------------------
    # AUTH
    # ------------------------------------------------------------------
    @router.post("/auth/login")
    async def login_endpoint(req: LoginRequest, request: Request):
        ip = request.client.host if request.client else "unknown"
        return await auth_login(db, req.username.strip(), req.password, ip)

    @router.get("/auth/me")
    async def me_endpoint(user: dict = Depends(current_user_dep)):
        return {
            "id": user["id"],
            "username": user["username"],
            "role": _eff_role(user),
            "is_owner": bool(user.get("is_owner")),
            "is_super_admin": _is_super(user),
            "admin_caps": _get_caps(user),
            "super_admin_until": user.get("super_admin_until"),
            "workspace_mode": user.get("workspace_mode", "personal"),
            "dual_mode": bool(user.get("dual_mode")),
            "due_soon_threshold": user.get("due_soon_threshold"),
            "company_id": user.get("company_id"),
        }

    @router.post("/auth/change-password")
    async def change_password_endpoint(req: ChangePasswordRequest, user: dict = Depends(current_user_dep)):
        return await auth_change_password(db, user["id"], req.current_password, req.new_password)

    @router.post("/auth/change-username")
    async def change_username_endpoint(req: ChangeUsernameRequest, user: dict = Depends(current_user_dep)):
        return await auth_change_username(db, user["id"], req.current_password, req.new_username)

    # ------------------------------------------------------------------
    # SETTINGS
    # ------------------------------------------------------------------
    @router.put("/settings/workspace-mode")
    async def set_workspace_mode(req: WorkspaceModeUpdate, user: dict = Depends(current_user_dep)):
        if req.workspace_mode not in ("personal", "team"):
            raise HTTPException(status_code=400, detail="workspace_mode 'personal' veya 'team' olmalı")
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"workspace_mode": req.workspace_mode}},
        )
        return {"workspace_mode": req.workspace_mode}

    @router.put("/settings/dual-mode")
    async def set_dual_mode(req: DualModeUpdate, user: dict = Depends(current_user_dep)):
        """Çift Mod: açıkken kullanıcı Kişisel⇄Ekip arasında tek tıkla geçebilir."""
        await db.users.update_one(
            {"id": user["id"]},
            {"$set": {"dual_mode": bool(req.dual_mode)}},
        )
        return {"dual_mode": bool(req.dual_mode)}

    @router.put("/settings/reminder-threshold")
    async def set_user_reminder_threshold(req: ReminderThresholdUpdate, user: dict = Depends(current_user_dep)):
        """Set the caller's personal due-soon threshold. Null/0/negative clears
        the override so the hierarchy (company → system default) resumes."""
        if req.days is None or req.days <= 0:
            await db.users.update_one({"id": user["id"]}, {"$unset": {"due_soon_threshold": ""}})
            await db.tasks.update_many({"user_id": user["id"]}, {"$set": {"due_soon_fired_at_days": None}})
            return {"days": None}
        if req.days not in _ALLOWED_THRESHOLD_DAYS:
            raise HTTPException(status_code=400, detail="Geçersiz eşik: 1/2/3/5/7/14 gün")
        await db.users.update_one({"id": user["id"]}, {"$set": {"due_soon_threshold": int(req.days)}})
        await db.tasks.update_many({"user_id": user["id"]}, {"$set": {"due_soon_fired_at_days": None}})
        return {"days": int(req.days)}

    @router.get("/settings/reminder-config")
    async def get_reminder_config(user: dict = Depends(current_user_dep)):
        """Return the resolved config for the caller so the UI can preview
        which layer will actually fire. Always safe (no PII)."""
        company_threshold = None
        company_id = user.get("company_id")
        if company_id:
            c = await db.companies.find_one({"id": company_id}, {"_id": 0, "due_soon_threshold": 1})
            if c and isinstance(c.get("due_soon_threshold"), int):
                company_threshold = c["due_soon_threshold"]
        effective = await resolve_effective_reminder_days(db, user, task=None)
        return {
            "system_default": SYSTEM_DEFAULT_REMINDER_DAYS,
            "user_threshold": user.get("due_soon_threshold"),
            "company_threshold": company_threshold,
            "workspace_mode": user.get("workspace_mode", "personal"),
            "effective": effective,
            "allowed_days": sorted(_ALLOWED_THRESHOLD_DAYS),
        }

    return router
