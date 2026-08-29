"""Faz 8 — Kurumsal Yetkilendirme (Multi-Tenant RBAC).

Data model
----------
users.role          : 'admin' | 'manager' | 'employee'  (legacy 'user' → 'employee')
users.company_id    : str (ref to companies.id) — canonical company reference
users.company_name  : str (legacy denorm, kept for backward compat until frontend swaps)

companies           : {id, name, created_at, created_by}
manager_visibility  : {id, manager_user_id, employee_user_id, granted_by, granted_at}
company_permissions : {id, viewer_company_id, target_company_id, granted_by, granted_at}

Visibility rules
----------------
- admin  : sees everyone.
- employee : sees only self.
- manager : sees:
      * self
      * any target user Y where manager_visibility(manager=self, employee=Y) exists
        AND either:
          - Y is in the same company as manager, OR
          - Y is in company C_y where company_permissions(viewer=C_manager, target=C_y) exists.
    Explicit opt-in: manager sees NO ONE unless a manager_visibility row exists.
"""
from datetime import datetime, timezone
from typing import List, Optional
import uuid

from pydantic import BaseModel, Field


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class Company(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_by: Optional[str] = None
    # Faz 8 CP5 — Due-soon reminder default for the whole company. Whitelisted
    # int values (1/2/3/5/7/14). None → falls back to the system default (3).
    due_soon_threshold: Optional[int] = None


class CompanyCreate(BaseModel):
    name: str


class CompanyUpdate(BaseModel):
    name: Optional[str] = None
    # Faz 8 CP5 — Admin+Manager can update this for their own company.
    due_soon_threshold: Optional[int] = None


class ManagerVisibility(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    manager_user_id: str
    employee_user_id: str
    granted_by: Optional[str] = None
    granted_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ManagerVisibilityCreate(BaseModel):
    manager_user_id: str
    employee_user_id: str


class CompanyPermission(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    viewer_company_id: str  # who VIEWS
    target_company_id: str  # whose data is exposed
    granted_by: Optional[str] = None
    granted_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    # Faz 8 CP6 — cross-manager consent flow. `status` distinguishes an
    # open request from an active grant. `requested_by` is the manager who
    # kicked off the request (from viewer_company_id). `responded_by` is the
    # manager (of target_company_id) who accepted or revoked.
    #   status: 'pending'  → request sent, awaiting target-side manager
    #           'active'   → grant is in effect, viewer sees target's data
    #           'revoked'  → previously granted, later cancelled by target
    #           'declined' → target refused the initial request
    status: str = "active"
    requested_by: Optional[str] = None
    responded_by: Optional[str] = None
    responded_at: Optional[str] = None


class CompanyPermissionCreate(BaseModel):
    viewer_company_id: str
    target_company_id: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def normalize_role(role: Optional[str]) -> str:
    """Coerce legacy role names to the new taxonomy.

    'user'   -> 'employee'   (old default before Faz 8)
    None     -> 'employee'   (safe default)
    other    -> returned unchanged.
    """
    if not role or role == "user":
        return "employee"
    return role


# ---------------------------------------------------------------------------
# Role hierarchy — Süper Yönetici (super_admin) > Yönetici (admin) > Müdür
# (manager) > İşçi (employee).
#   * `is_owner=True`  → the founding super admin. Permanent + untouchable
#     (no one may delete/demote/modify/impersonate/restrict the owner).
#   * A TEMPORARY super admin carries `super_admin_until` (ISO) + `prev_role`;
#     get_current_user reverts it to `prev_role` lazily once the window elapses.
# ---------------------------------------------------------------------------
ROLE_SUPER_ADMIN = "super_admin"
ROLE_ADMIN = "admin"
ROLE_MANAGER = "manager"
ROLE_EMPLOYEE = "employee"


def effective_role(user: Optional[dict]) -> str:
    """Resolve the ACTIVE role: honor the owner flag and expire an elapsed
    temporary super-admin grant. Defensive — get_current_user already persists
    the revert, so this normally just echoes the stored role."""
    if not user:
        return ROLE_EMPLOYEE
    if user.get("is_owner"):
        return ROLE_SUPER_ADMIN
    role = normalize_role(user.get("role"))
    if role == ROLE_SUPER_ADMIN:
        until = user.get("super_admin_until")
        if until:
            try:
                exp = datetime.fromisoformat(until)
                if exp.tzinfo is None:
                    exp = exp.replace(tzinfo=timezone.utc)
                if exp <= datetime.now(timezone.utc):
                    return normalize_role(user.get("prev_role") or ROLE_EMPLOYEE)
            except Exception:
                pass
    return role


def acting_role(user: Optional[dict]) -> str:
    """Role for LEGACY per-object RBAC gates. Collapses super_admin → 'admin'
    so every historical `role == "admin"` check keeps behaving exactly as
    before for the super tier. The real (company-scoped) admin tier is scoped
    separately inside the visibility helpers below."""
    r = effective_role(user)
    return ROLE_ADMIN if r == ROLE_SUPER_ADMIN else r


def is_super_admin(user: Optional[dict]) -> bool:
    return effective_role(user) == ROLE_SUPER_ADMIN


def is_owner(user: Optional[dict]) -> bool:
    return bool(user and user.get("is_owner"))


def is_admin_role(user: Optional[dict]) -> bool:
    return effective_role(user) == ROLE_ADMIN


def is_privileged(user: Optional[dict]) -> bool:
    """admin OR super_admin (both bypass license + hold task-level privilege)."""
    return effective_role(user) in (ROLE_ADMIN, ROLE_SUPER_ADMIN)


def get_admin_caps(user: Optional[dict]) -> dict:
    """Super-admin-granted capabilities for a company admin."""
    caps = (user or {}).get("admin_caps") or {}
    return {
        "extra_company_ids": list(caps.get("extra_company_ids") or []),
        "can_create_company": bool(caps.get("can_create_company")),
        "can_view_company_tasks": bool(caps.get("can_view_company_tasks")),
    }


def admin_effective_company_ids(user: Optional[dict]) -> List[str]:
    """Companies a company-admin may act on: own memberships + super-granted
    extra companies (dedup, order-preserving)."""
    out: List[str] = []
    seen = set()
    for c in list(get_user_company_ids(user)) + list(get_admin_caps(user)["extra_company_ids"]):
        if c and c not in seen:
            seen.add(c)
            out.append(c)
    return out


async def get_or_create_company(db, name: str, created_by: Optional[str] = None) -> dict:
    """Idempotent case-insensitive upsert. Returns the company doc (with id)."""
    name = (name or "").strip()
    if not name:
        raise ValueError("Şirket adı boş olamaz")
    # Case-insensitive match to avoid duplicate rows differing only in casing.
    existing = await db.companies.find_one(
        {"name": {"$regex": f"^{_regex_escape(name)}$", "$options": "i"}}, {"_id": 0}
    )
    if existing:
        return existing
    doc = Company(name=name, created_by=created_by).model_dump()
    await db.companies.insert_one(doc)
    doc.pop("_id", None)
    return doc


def _regex_escape(s: str) -> str:
    import re as _re
    return _re.escape(s)


async def can_view_user(db, viewer: dict, target_user_id: str) -> bool:
    """Return True iff `viewer` may see the user with id=target_user_id.

    Multi-company aware (Faz 8 CP6): a user may belong to multiple companies
    via `users.company_ids`. Two managers see the same person when:
      - the manager has an explicit `manager_visibility` row for the target
      AND
      - the target's `company_ids` intersects the manager's `company_ids`
        (same-company), OR at least one bridge exists via `company_permissions`.
    """
    if not viewer:
        return False
    viewer_role = effective_role(viewer)
    if viewer_role == ROLE_SUPER_ADMIN:
        return True
    if viewer["id"] == target_user_id:
        return True
    if viewer_role == ROLE_ADMIN:
        # Company admin may see a user's TASKS only when the super admin granted
        # `can_view_company_tasks` AND the target belongs to one of the admin's
        # effective companies (own + granted extra).
        if not get_admin_caps(viewer).get("can_view_company_tasks"):
            return False
        eff = set(admin_effective_company_ids(viewer))
        if not eff:
            return False
        target = await db.users.find_one(
            {"id": target_user_id}, {"_id": 0, "company_id": 1, "company_ids": 1},
        )
        if not target:
            return False
        return bool(eff & set(get_user_company_ids(target)))
    if viewer_role == ROLE_EMPLOYEE:
        return False
    if viewer_role != ROLE_MANAGER:
        return False
    # Manager path: needs explicit manager_visibility row.
    mv = await db.manager_visibility.find_one({
        "manager_user_id": viewer["id"],
        "employee_user_id": target_user_id,
    })
    if not mv:
        return False
    target = await db.users.find_one(
        {"id": target_user_id}, {"_id": 0, "company_id": 1, "company_ids": 1},
    )
    if not target:
        return False
    viewer_cids = set(get_user_company_ids(viewer))
    target_cids = set(get_user_company_ids(target))
    # Same-company overlap.
    if viewer_cids & target_cids:
        return True
    if not viewer_cids or not target_cids:
        return False
    # Cross-company grant: any (viewer_cid, target_cid) pair with an active row.
    cp = await db.company_permissions.find_one({
        "viewer_company_id": {"$in": list(viewer_cids)},
        "target_company_id": {"$in": list(target_cids)},
        # `status` is optional for backward compat (rows without status are
        # treated as active); once CP-C ships this becomes explicit.
        "$or": [{"status": {"$exists": False}}, {"status": "active"}],
    })
    return cp is not None


def get_user_company_ids(user: dict) -> List[str]:
    """Return the effective list of company memberships for a user doc.

    Backward-compat rule:
      - Prefer `company_ids` (list) if present + non-empty.
      - Otherwise fall back to `[company_id]` (legacy single-company).
      - Missing both → [].
    """
    if not user:
        return []
    cids = user.get("company_ids")
    if isinstance(cids, list) and cids:
        # Deduplicate while preserving order.
        seen = set()
        out: List[str] = []
        for c in cids:
            if c and c not in seen:
                seen.add(c)
                out.append(c)
        return out
    cid = user.get("company_id")
    return [cid] if cid else []


async def can_view_company(db, viewer: dict, target_company_id: str) -> bool:
    """Return True iff `viewer` may see the given company as an entity.

    Multi-company aware — viewer must either be a member of the target, or
    have an active cross-company permission row from ANY of their companies
    to the target.
    """
    if not viewer:
        return False
    viewer_role = effective_role(viewer)
    if viewer_role == ROLE_SUPER_ADMIN:
        return True
    if viewer_role == ROLE_ADMIN:
        return target_company_id in set(admin_effective_company_ids(viewer))
    viewer_cids = set(get_user_company_ids(viewer))
    if target_company_id in viewer_cids:
        return True
    if viewer_role != ROLE_MANAGER:
        return False
    if not viewer_cids:
        return False
    cp = await db.company_permissions.find_one({
        "viewer_company_id": {"$in": list(viewer_cids)},
        "target_company_id": target_company_id,
        "$or": [{"status": {"$exists": False}}, {"status": "active"}],
    })
    return cp is not None


async def visible_user_ids(db, viewer: dict) -> Optional[List[str]]:
    """List of user_ids the viewer may see (for task/team scope). Returns None
    for super_admin (= no filter, sees everyone).

    * super_admin → None (all users).
    * admin       → self only, UNLESS super granted `can_view_company_tasks`,
                    then self + every user in the admin's effective companies.
    * manager     → self + manager_visibility rows (multi-company aware).
    * employee    → self only.
    """
    if not viewer:
        return []
    role = effective_role(viewer)
    if role == ROLE_SUPER_ADMIN:
        return None
    if role == ROLE_ADMIN:
        if not get_admin_caps(viewer).get("can_view_company_tasks"):
            return [viewer["id"]]
        eff = set(admin_effective_company_ids(viewer))
        if not eff:
            return [viewer["id"]]
        users = await db.users.find(
            {}, {"_id": 0, "id": 1, "company_id": 1, "company_ids": 1},
        ).to_list(length=10000)
        visible = {viewer["id"]}
        for u in users:
            if eff & set(get_user_company_ids(u)):
                visible.add(u["id"])
        return list(visible)
    if role == ROLE_EMPLOYEE:
        return [viewer["id"]]
    if role != ROLE_MANAGER:
        return [viewer["id"]]
    rows = await db.manager_visibility.find(
        {"manager_user_id": viewer["id"]}, {"_id": 0, "employee_user_id": 1},
    ).to_list(length=5000)
    candidate_ids = [r["employee_user_id"] for r in rows]
    if not candidate_ids:
        return [viewer["id"]]
    viewer_cids = set(get_user_company_ids(viewer))
    if viewer_cids:
        cp_rows = await db.company_permissions.find(
            {
                "viewer_company_id": {"$in": list(viewer_cids)},
                "$or": [{"status": {"$exists": False}}, {"status": "active"}],
            },
            {"_id": 0, "target_company_id": 1},
        ).to_list(length=2000)
        allowed_target_cids = {r["target_company_id"] for r in cp_rows}
    else:
        allowed_target_cids = set()
    users = await db.users.find(
        {"id": {"$in": candidate_ids}},
        {"_id": 0, "id": 1, "company_id": 1, "company_ids": 1},
    ).to_list(length=5000)
    visible = {viewer["id"]}
    for u in users:
        tcids = set(get_user_company_ids(u))
        if viewer_cids & tcids:
            visible.add(u["id"])
        elif tcids & allowed_target_cids:
            visible.add(u["id"])
    return list(visible)


# ---------------------------------------------------------------------------
# Startup migration
# ---------------------------------------------------------------------------
async def managers_who_can_see(db, target_user_id: str) -> List[str]:
    """Reverse lookup: return the manager user_ids that may see the given user.

    Multi-company aware: for a target user with multiple companies, a manager
    passes if they share ANY company with the target, or hold a cross-company
    permission from ANY of their companies to ANY of the target's companies.
    """
    target = await db.users.find_one(
        {"id": target_user_id},
        {"_id": 0, "id": 1, "company_id": 1, "company_ids": 1},
    )
    if not target:
        return []
    target_cids = set(get_user_company_ids(target))
    rows = await db.manager_visibility.find(
        {"employee_user_id": target_user_id},
        {"_id": 0, "manager_user_id": 1},
    ).to_list(length=5000)
    candidate_ids = [r["manager_user_id"] for r in rows]
    if not candidate_ids:
        return []
    managers = await db.users.find(
        {"id": {"$in": candidate_ids}, "role": "manager"},
        {"_id": 0, "id": 1, "company_id": 1, "company_ids": 1},
    ).to_list(length=5000)
    out: List[str] = []
    for m in managers:
        m_cids = set(get_user_company_ids(m))
        if m_cids & target_cids:
            out.append(m["id"])
            continue
        if not m_cids or not target_cids:
            continue
        cp = await db.company_permissions.find_one({
            "viewer_company_id": {"$in": list(m_cids)},
            "target_company_id": {"$in": list(target_cids)},
            "$or": [{"status": {"$exists": False}}, {"status": "active"}],
        })
        if cp:
            out.append(m["id"])
    return out


async def run_permission_migrations(db, admin_id: Optional[str]) -> None:
    """Idempotent migration to bring the DB up to the Faz 8 schema.

    1. Rename legacy role 'user' → 'employee'.
    2. Backfill users.company_id from users.company_name via companies upsert.
    3. Faz 8 CP6 — Backfill users.company_ids = [company_id] when missing.
    4. Faz 8 CP6 — Backfill company_permissions.status = 'active' when missing
       (legacy rows are treated as active grants).
    5. Create indexes on the 3 new collections.
    """
    # 1. Role rename (leaves 'admin' + already-migrated 'employee'/'manager' alone).
    await db.users.update_many({"role": "user"}, {"$set": {"role": "employee"}})

    # 2. Company backfill.
    users_with_company_name = await db.users.find(
        {"company_name": {"$exists": True, "$nin": [None, ""]}},
        {"_id": 0, "id": 1, "company_name": 1, "company_id": 1},
    ).to_list(length=10000)
    for u in users_with_company_name:
        if u.get("company_id"):
            continue
        try:
            company = await get_or_create_company(db, u["company_name"], created_by=admin_id)
            await db.users.update_one(
                {"id": u["id"]}, {"$set": {"company_id": company["id"]}},
            )
        except ValueError:
            continue

    # 3. Faz 8 CP6 — Backfill company_ids array. Any user with a company_id
    # but no company_ids array gets a single-entry list. Idempotent: users
    # who already have a non-empty array are untouched.
    users_needing_list = await db.users.find(
        {
            "company_id": {"$exists": True, "$nin": [None, ""]},
            "$or": [
                {"company_ids": {"$exists": False}},
                {"company_ids": None},
                {"company_ids": []},
            ],
        },
        {"_id": 0, "id": 1, "company_id": 1},
    ).to_list(length=10000)
    for u in users_needing_list:
        await db.users.update_one(
            {"id": u["id"]}, {"$set": {"company_ids": [u["company_id"]]}},
        )

    # 4. Faz 8 CP6 — Legacy company_permissions rows without status → active.
    await db.company_permissions.update_many(
        {"status": {"$exists": False}}, {"$set": {"status": "active"}},
    )

    # 5. Indexes (idempotent).
    await db.companies.create_index("name")
    await db.manager_visibility.create_index(
        [("manager_user_id", 1), ("employee_user_id", 1)], unique=True
    )
    await db.manager_visibility.create_index("employee_user_id")
    await db.company_permissions.create_index(
        [("viewer_company_id", 1), ("target_company_id", 1)], unique=True
    )
    await db.users.create_index("company_id")
    await db.users.create_index("company_ids")
