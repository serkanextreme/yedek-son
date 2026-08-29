"""Auth module for Sertex: username + password with JWT bearer tokens.
Brute force: 3 failed attempts within 15 min → 5 min lockout.
"""
import os
import bcrypt
import jwt
import uuid
from datetime import datetime, timezone, timedelta
from typing import Optional
from fastapi import Depends, HTTPException, Request

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = int(os.environ.get("JWT_EXPIRE_HOURS", "168"))  # varsayılan 7 gün · JWT_EXPIRE_HOURS env ile ayarlanır
MAX_ATTEMPTS = 3
LOCKOUT_MINUTES = 5
ATTEMPT_WINDOW_MINUTES = 15


def get_jwt_secret() -> str:
    return os.environ["JWT_SECRET"]


def hash_password(pw: str) -> str:
    return bcrypt.hashpw(pw.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(pw: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(pw.encode("utf-8"), hashed.encode("utf-8"))
    except Exception:
        return False


def create_access_token(user_id: str, username: str, session_id: str) -> str:
    payload = {
        "sub": user_id,
        "username": username,
        "sid": session_id,
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, get_jwt_secret(), algorithm=JWT_ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, get_jwt_secret(), algorithms=[JWT_ALGORITHM])


async def seed_initial_user(db):
    username = os.environ.get("INITIAL_USERNAME", "sertex")
    password = os.environ.get("INITIAL_PASSWORD", "sertex2026")
    existing = await db.users.find_one({"username": username})
    if not existing:
        user_doc = {
            "id": str(uuid.uuid4()),
            "username": username,
            "password_hash": hash_password(password),
            "role": "super_admin",
            "is_owner": True,
            "created_at": datetime.now(timezone.utc).isoformat(),
        }
        await db.users.insert_one(user_doc)
    else:
        # The founding account is the permanent, untouchable OWNER + super admin.
        # Upgrade legacy 'admin' seed idempotently.
        updates = {}
        if not existing.get("is_owner"):
            updates["is_owner"] = True
        if existing.get("role") != "super_admin":
            updates["role"] = "super_admin"
        # Owner is permanent — never carries a temp-expiry window.
        if existing.get("super_admin_until"):
            updates["super_admin_until"] = None
            updates["prev_role"] = None
        if not existing.get("password_user_set") and not verify_password(password, existing["password_hash"]):
            updates["password_hash"] = hash_password(password)
        if updates:
            await db.users.update_one({"username": username}, {"$set": updates})


def require_admin(user: dict):
    """admin OR super_admin (company-management gate)."""
    from permissions import is_privileged
    if not is_privileged(user):
        raise HTTPException(status_code=403, detail="Bu işlem için yönetici yetkisi gerekli")


def require_super_admin(user: dict):
    """super_admin (or owner) only — system-wide settings."""
    from permissions import is_super_admin
    if not is_super_admin(user):
        raise HTTPException(status_code=403, detail="Bu işlem için süper yönetici yetkisi gerekli")


def require_owner(user: dict):
    """Kurucu (owner) only — appointing/revoking super admins."""
    if not (user or {}).get("is_owner"):
        raise HTTPException(status_code=403, detail="Bu işlem yalnızca kurucu tarafından yapılabilir")


async def _check_lockout(db, identifier: str) -> Optional[int]:
    """Return remaining seconds if locked, else None."""
    doc = await db.login_attempts.find_one({"identifier": identifier})
    if not doc:
        return None
    locked_until = doc.get("locked_until")
    if locked_until:
        lu = datetime.fromisoformat(locked_until)
        remaining = (lu - datetime.now(timezone.utc)).total_seconds()
        if remaining > 0:
            return int(remaining)
    return None


async def _record_failure(db, identifier: str):
    now = datetime.now(timezone.utc)
    doc = await db.login_attempts.find_one({"identifier": identifier})
    if not doc:
        await db.login_attempts.insert_one({
            "identifier": identifier,
            "count": 1,
            "first_attempt": now.isoformat(),
            "locked_until": None,
        })
        return None
    first = datetime.fromisoformat(doc["first_attempt"])
    if (now - first).total_seconds() > ATTEMPT_WINDOW_MINUTES * 60:
        # window expired, reset
        await db.login_attempts.update_one(
            {"identifier": identifier},
            {"$set": {"count": 1, "first_attempt": now.isoformat(), "locked_until": None}},
        )
        return None
    new_count = doc["count"] + 1
    lock = None
    if new_count >= MAX_ATTEMPTS:
        lock = (now + timedelta(minutes=LOCKOUT_MINUTES)).isoformat()
    await db.login_attempts.update_one(
        {"identifier": identifier},
        {"$set": {"count": new_count, "locked_until": lock}},
    )
    return LOCKOUT_MINUTES * 60 if lock else None


async def _clear_attempts(db, identifier: str):
    await db.login_attempts.delete_one({"identifier": identifier})


async def login(db, username: str, password: str, ip: str):
    # Single-user app: key lockout on username only (behind k8s ingress the client
    # IP rotates across pod replicas, which would defeat IP-based lockout).
    identifier = username
    remaining = await _check_lockout(db, identifier)
    if remaining:
        raise HTTPException(
            status_code=429,
            detail=f"Çok fazla başarısız deneme. {remaining // 60}dk {remaining % 60}sn sonra tekrar deneyin.",
        )
    user = await db.users.find_one({"username": username})
    if not user or not verify_password(password, user["password_hash"]):
        lock_secs = await _record_failure(db, identifier)
        if lock_secs:
            raise HTTPException(
                status_code=429,
                detail=f"3 hatalı deneme. {LOCKOUT_MINUTES} dakika kilitlendi.",
            )
        raise HTTPException(status_code=401, detail="Kullanıcı adı veya şifre hatalı")
    await _clear_attempts(db, identifier)
    # Rotate active session so any existing device is kicked (single-session rule)
    new_session_id = str(uuid.uuid4())
    await db.users.update_one(
        {"id": user["id"]},
        {"$set": {
            "active_session_id": new_session_id,
            "last_login_at": datetime.now(timezone.utc).isoformat(),
        }},
    )
    token = create_access_token(user["id"], user["username"], new_session_id)
    return {
        "token": token,
        "token_type": "bearer",
        "user": {
            "id": user["id"],
            "username": user["username"],
            "role": user.get("role", "user"),
            "is_owner": bool(user.get("is_owner")),
            "workspace_mode": user.get("workspace_mode", "personal"),
            "dual_mode": bool(user.get("dual_mode")),
        },
    }


async def get_current_user_factory(db):
    async def get_current_user(request: Request):
        auth = request.headers.get("Authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(status_code=401, detail="Kimlik doğrulanmadı")
        token = auth[7:]
        try:
            payload = decode_token(token)
            if payload.get("type") != "access":
                raise HTTPException(status_code=401, detail="Geçersiz token")
            user = await db.users.find_one({"id": payload["sub"]}, {"password_hash": 0})
            if not user:
                raise HTTPException(status_code=401, detail="Kullanıcı bulunamadı")
            # Single-session enforcement: JWT session_id must match server-side
            # active_session_id. Older tokens (no `sid`) are grandfathered until
            # the user logs in again.
            token_sid = payload.get("sid")
            active_sid = user.get("active_session_id")
            if token_sid and active_sid and token_sid != active_sid:
                raise HTTPException(
                    status_code=401,
                    detail="SESSION_KICKED: Başka bir cihazdan giriş yapıldı — bu oturum sonlandırıldı",
                )
            user.pop("_id", None)
            # Lazy revert: an elapsed temporary super-admin grant drops the user
            # back to their prior role. Owner is permanent and never reverts.
            if (
                not user.get("is_owner")
                and user.get("role") == "super_admin"
                and user.get("super_admin_until")
            ):
                try:
                    exp = datetime.fromisoformat(user["super_admin_until"])
                    if exp.tzinfo is None:
                        exp = exp.replace(tzinfo=timezone.utc)
                    if exp <= datetime.now(timezone.utc):
                        reverted = user.get("prev_role") or "employee"
                        await db.users.update_one(
                            {"id": user["id"]},
                            {"$set": {"role": reverted},
                             "$unset": {"super_admin_until": "", "prev_role": "",
                                        "super_admin_expiry_warned": ""}},
                        )
                        user["role"] = reverted
                        user.pop("super_admin_until", None)
                        user.pop("prev_role", None)
                except Exception:
                    pass
            return user
        except jwt.ExpiredSignatureError:
            raise HTTPException(status_code=401, detail="Oturum süresi doldu")
        except jwt.InvalidTokenError:
            raise HTTPException(status_code=401, detail="Geçersiz token")

    return get_current_user


async def change_password(db, user_id: str, current_pw: str, new_pw: str):
    user = await db.users.find_one({"id": user_id})
    if not user or not verify_password(current_pw, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Mevcut şifre yanlış")
    if len(new_pw) < 6:
        raise HTTPException(status_code=400, detail="Yeni şifre en az 6 karakter olmalı")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"password_hash": hash_password(new_pw), "password_user_set": True}},
    )
    return {"ok": True}


async def change_username(db, user_id: str, current_pw: str, new_username: str):
    user = await db.users.find_one({"id": user_id})
    if not user or not verify_password(current_pw, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Mevcut şifre yanlış")
    new_username = new_username.strip()
    if len(new_username) < 3:
        raise HTTPException(status_code=400, detail="Kullanıcı adı en az 3 karakter olmalı")
    conflict = await db.users.find_one({"username": new_username, "id": {"$ne": user_id}})
    if conflict:
        raise HTTPException(status_code=400, detail="Bu kullanıcı adı zaten kullanılıyor")
    await db.users.update_one(
        {"id": user_id},
        {"$set": {"username": new_username, "username_user_set": True}},
    )
    return {"ok": True, "username": new_username}
