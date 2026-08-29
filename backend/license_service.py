"""License service for Sertex (Faz 5).

- CD-Key generation (format `SERTEX-XXXX-XXXX-XXXX`, unambiguous alphabet)
- 4 license types: trial (30d), monthly (30d), yearly (365d), lifetime (forever)
- Redemption assigns a key to one user permanently. Re-redeem by same user is a
  no-op. Re-redeem by different user is rejected.
- Suspend / revoke / extend / delete (unassigned) — admin actions.
- `has_active_license(user)` — used by API gate to block un-licensed users.
- Admins bypass all license checks.
"""
from __future__ import annotations

import logging
import secrets
import uuid
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

from fastapi import HTTPException

logger = logging.getLogger(__name__)

# Exclude ambiguous glyphs (O/0, I/1, L)
_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

LICENSE_TYPES: Dict[str, Optional[int]] = {
    "trial": 30,       # days
    "monthly": 30,
    "yearly": 365,
    "lifetime": None,  # never expires
}
LICENSE_TYPE_LABELS_TR = {
    "trial": "Deneme (30 gün)",
    "monthly": "Aylık",
    "yearly": "Yıllık",
    "lifetime": "Ömür Boyu",
}
# Per-license storage quotas in MB. Admin bypasses this (unlimited). Users
# without any active license fall back to FREE_QUOTA_MB — a small allowance so
# they can still try the product before redeeming a key. Values are chosen to
# be generous relative to typical usage (a full year of chats + notes + tasks
# + small files rarely exceeds ~50 MB per user).
LICENSE_QUOTA_MB: Dict[str, int] = {
    "trial":    100,
    "monthly":  500,
    "yearly":   2048,   # 2 GB
    "lifetime": 10240,  # 10 GB
}
FREE_QUOTA_MB: int = 50


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _now_iso() -> str:
    return _now().isoformat()


def generate_key() -> str:
    """Generate a `SERTEX-XXXX-XXXX-XXXX` key using cryptographic RNG."""
    parts = ["SERTEX"]
    for _ in range(3):
        parts.append("".join(secrets.choice(_ALPHABET) for _ in range(4)))
    return "-".join(parts)


def _license_public(lic: Dict[str, Any]) -> Dict[str, Any]:
    """Strip internal fields for API responses."""
    out = {k: v for k, v in lic.items() if k != "_id"}
    return out


async def ensure_indexes(db) -> None:
    await db.licenses.create_index("key", unique=True)
    await db.licenses.create_index("assigned_user_id")
    await db.licenses.create_index("status")


# ---- Creation -----------------------------------------------------------
async def create_licenses(
    db,
    *,
    license_type: str,
    count: int = 1,
    notes: Optional[str] = None,
    created_by: Optional[str] = None,
) -> List[Dict[str, Any]]:
    if license_type not in LICENSE_TYPES:
        raise HTTPException(400, f"Bilinmeyen lisans türü: {license_type}")
    if count < 1 or count > 500:
        raise HTTPException(400, "Sayı 1 ile 500 arasında olmalı")

    docs: List[Dict[str, Any]] = []
    for _ in range(count):
        # Try up to 10 times to avoid rare collision
        for attempt in range(10):
            key = generate_key()
            if not await db.licenses.find_one({"key": key}, {"_id": 1}):
                break
        else:
            raise HTTPException(500, "Benzersiz key üretilemedi — tekrar dene")

        doc = {
            "id": str(uuid.uuid4()),
            "key": key,
            "type": license_type,
            "type_label": LICENSE_TYPE_LABELS_TR[license_type],
            "duration_days": LICENSE_TYPES[license_type],
            "status": "active",  # active | suspended | revoked
            "assigned_user_id": None,
            "assigned_username": None,
            "redeemed_at": None,
            "expires_at": None,  # set on redemption
            "notes": (notes or "")[:500] or None,
            "created_at": _now_iso(),
            "created_by": created_by,
        }
        await db.licenses.insert_one(doc)
        docs.append(_license_public(doc))
    return docs


# ---- Redemption ---------------------------------------------------------
async def redeem_license(db, user: Dict[str, Any], key: str) -> Dict[str, Any]:
    key = (key or "").strip().upper()
    if not key.startswith("SERTEX-") or len(key) < 15:
        raise HTTPException(400, "Geçersiz kod formatı")

    lic = await db.licenses.find_one({"key": key}, {"_id": 0})
    if not lic:
        raise HTTPException(404, "Bu kod bulunamadı")

    if lic["status"] == "suspended":
        raise HTTPException(400, "Bu kod askıya alındı — yönetici ile iletişime geç")
    if lic["status"] == "revoked":
        raise HTTPException(400, "Bu kod iptal edildi")

    # Already redeemed?
    if lic.get("assigned_user_id"):
        if lic["assigned_user_id"] == user["id"]:
            return _license_public(lic)  # idempotent
        raise HTTPException(409, "Bu kod başka bir kullanıcı tarafından kullanılmış")

    # Assign
    now = _now()
    days = lic["duration_days"]
    expires_at = None if days is None else (now + timedelta(days=days)).isoformat()
    updates = {
        "assigned_user_id": user["id"],
        "assigned_username": user["username"],
        "redeemed_at": now.isoformat(),
        "expires_at": expires_at,
    }
    await db.licenses.update_one({"id": lic["id"]}, {"$set": updates})
    lic.update(updates)
    return _license_public(lic)


# ---- Lookups ------------------------------------------------------------
async def get_user_license(db, user_id: str) -> Optional[Dict[str, Any]]:
    """Most-recently redeemed active license for a user, if any (not expired)."""
    cursor = db.licenses.find(
        {"assigned_user_id": user_id, "status": "active"},
        {"_id": 0},
    ).sort("redeemed_at", -1).limit(1)
    docs = await cursor.to_list(1)
    if not docs:
        return None
    lic = docs[0]
    exp = lic.get("expires_at")
    if exp:
        try:
            if datetime.fromisoformat(exp) < _now():
                return None
        except Exception:
            return None
    return lic


def is_admin(user: Dict[str, Any]) -> bool:
    # Privileged tiers (admin + super_admin/owner) bypass licensing.
    return bool(user.get("is_owner")) or user.get("role") in ("admin", "super_admin")


async def has_active_license(db, user: Dict[str, Any]) -> bool:
    if is_admin(user):
        return True
    lic = await get_user_license(db, user["id"])
    return lic is not None


async def license_status_for(db, user: Dict[str, Any]) -> Dict[str, Any]:
    """Compact status blob used by the frontend to render UI states."""
    if is_admin(user):
        return {
            "has_license": True,
            "is_admin": True,
            "type": "admin",
            "type_label": "Yönetici",
            "expires_at": None,
            "days_left": None,
            "key": None,
        }
    lic = await get_user_license(db, user["id"])
    if not lic:
        # Check if user has any expired/revoked license, to render a nicer message
        prev = await db.licenses.find_one(
            {"assigned_user_id": user["id"]},
            {"_id": 0},
            sort=[("redeemed_at", -1)],
        )
        return {
            "has_license": False,
            "is_admin": False,
            "type": None,
            "type_label": None,
            "expires_at": prev.get("expires_at") if prev else None,
            "days_left": 0 if prev else None,
            "key": None,
            "previous_status": (prev or {}).get("status"),
        }
    days_left: Optional[int] = None
    if lic.get("expires_at"):
        try:
            delta = datetime.fromisoformat(lic["expires_at"]) - _now()
            days_left = max(0, int(delta.total_seconds() // 86400))
        except Exception as exc:
            logger.warning("license expires_at parse failed (%r): %s", lic.get("expires_at"), exc)
    return {
        "has_license": True,
        "is_admin": False,
        "type": lic["type"],
        "type_label": lic.get("type_label")
        or LICENSE_TYPE_LABELS_TR.get(lic["type"], lic["type"]),
        "expires_at": lic.get("expires_at"),
        "days_left": days_left,
        "key": lic["key"],
    }


# ---- Admin mutations ----------------------------------------------------
async def list_licenses(
    db, *, status: Optional[str] = None, license_type: Optional[str] = None
) -> List[Dict[str, Any]]:
    q: Dict[str, Any] = {}
    if status:
        q["status"] = status
    if license_type:
        q["type"] = license_type
    docs = await db.licenses.find(q, {"_id": 0}).sort("created_at", -1).to_list(2000)
    return docs


async def get_license(db, license_id: str) -> Optional[Dict[str, Any]]:
    return await db.licenses.find_one({"id": license_id}, {"_id": 0})


async def update_license(
    db,
    license_id: str,
    *,
    status: Optional[str] = None,
    extend_days: Optional[int] = None,
    notes: Optional[str] = None,
) -> Dict[str, Any]:
    lic = await get_license(db, license_id)
    if not lic:
        raise HTTPException(404, "Lisans bulunamadı")
    updates: Dict[str, Any] = {}
    if status:
        if status not in {"active", "suspended", "revoked"}:
            raise HTTPException(400, f"Geçersiz durum: {status}")
        updates["status"] = status
    if extend_days is not None:
        if extend_days == 0:
            pass
        else:
            base = lic.get("expires_at")
            if base:
                try:
                    exp = datetime.fromisoformat(base)
                except Exception:
                    exp = _now()
            else:
                exp = _now()
            new_exp = exp + timedelta(days=extend_days)
            updates["expires_at"] = new_exp.isoformat()
    if notes is not None:
        updates["notes"] = notes[:500] or None
    if updates:
        updates["updated_at"] = _now_iso()
        await db.licenses.update_one({"id": license_id}, {"$set": updates})
        lic.update(updates)
    return lic


async def delete_license(db, license_id: str) -> Dict[str, Any]:
    lic = await get_license(db, license_id)
    if not lic:
        return {"deleted": 0}
    if lic.get("assigned_user_id"):
        raise HTTPException(
            400,
            "Bu kod bir kullanıcıya atanmış — silmek yerine 'iptal et' kullan",
        )
    await db.licenses.delete_one({"id": license_id})
    return {"deleted": 1}


async def stats(db) -> Dict[str, Any]:
    """Aggregate stats for the admin dashboard."""
    pipeline = [
        {"$group": {"_id": {"type": "$type", "status": "$status", "assigned": {"$cond": [{"$ifNull": ["$assigned_user_id", False]}, True, False]}}, "count": {"$sum": 1}}}
    ]
    buckets = await db.licenses.aggregate(pipeline).to_list(500)
    total = sum(b["count"] for b in buckets)
    used = sum(b["count"] for b in buckets if b["_id"]["assigned"])
    active_used = sum(
        b["count"] for b in buckets
        if b["_id"]["assigned"] and b["_id"]["status"] == "active"
    )
    return {
        "total": total,
        "used": used,
        "active_used": active_used,
        "unused": total - used,
        "buckets": buckets,
    }
