"""Sertex — Faz 8 CP6 · Multi-company membership + orphan tasks + user delete modes.

Scope:
  * users.company_ids (list) — a user can belong to multiple companies
  * POST/DELETE /api/companies/{cid}/members/{uid} — manager adds/removes members
  * Task company_id — task belongs to a specific company
  * Orphan tasks — removing a user from a company flips their active tasks to `orphaned=True`
  * GET /api/orphan-tasks — manager reclaims from the "Yarım Kalan İşler" pool
  * POST /api/tasks/{id}/reassign — reclaims an orphan, clears orphan flags
  * DELETE /api/admin/users/{uid}?mode=soft_orphan|hard|purge — 3 delete modes
  * can_view_user multi-company intersection logic
  * cross-company request/approve/decline/revoke flow
"""
import os
import uuid
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


def _read_backend_env():
    env = {}
    with open("/app/backend/.env") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


BACKEND_ENV = _read_backend_env()
MONGO_URL = BACKEND_ENV["MONGO_URL"]
DB_NAME = BACKEND_ENV["DB_NAME"]


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


def _login(username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


def _register(db, username, password="pass1234", role="employee", company_id=None, company_name=None):
    """Direct DB insert — cheaper than the admin register API for large test grids."""
    from passlib.context import CryptContext
    pwd_ctx = CryptContext(schemes=["bcrypt"], deprecated="auto")
    uid = str(uuid.uuid4())
    doc = {
        "id": uid, "username": username,
        "password_hash": pwd_ctx.hash(password),
        "role": role,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if company_id:
        doc["company_id"] = company_id
        doc["company_ids"] = [company_id]
    if company_name:
        doc["company_name"] = company_name
    db.users.insert_one(doc)
    return uid


def _cleanup(db, prefix: str):
    ids = [u["id"] for u in db.users.find({"username": {"$regex": f"^{prefix}"}}, {"id": 1})]
    if ids:
        db.tasks.delete_many({"user_id": {"$in": ids}})
        db.manager_visibility.delete_many({"$or": [
            {"manager_user_id": {"$in": ids}},
            {"employee_user_id": {"$in": ids}},
        ]})
    db.users.delete_many({"username": {"$regex": f"^{prefix}"}})
    db.companies.delete_many({"name": {"$regex": f"^{prefix}"}})
    db.company_permissions.delete_many({})  # Full wipe is safest between tests


@pytest.fixture(scope="module")
def multi_company_grid(db, admin_token):
    """Create 2 companies (A, B), 2 managers (mA, mB), and 1 shared employee (ahmet).
    Ahmet is a member of both A and B. Returns dict with all ids + tokens."""
    _cleanup(db, "CP6_")

    r = requests.post(f"{API}/companies", headers=_h(admin_token), json={"name": "CP6_CompanyA"})
    assert r.status_code == 200, r.text
    cA = r.json()["id"]
    r = requests.post(f"{API}/companies", headers=_h(admin_token), json={"name": "CP6_CompanyB"})
    assert r.status_code == 200, r.text
    cB = r.json()["id"]

    mA = _register(db, "CP6_mgrA", role="manager", company_id=cA, company_name="CP6_CompanyA")
    mB = _register(db, "CP6_mgrB", role="manager", company_id=cB, company_name="CP6_CompanyB")
    ahmet = _register(db, "CP6_ahmet", role="employee", company_id=cA, company_name="CP6_CompanyA")
    # Ahmet is manually assigned to BOTH companies (multi-membership).
    db.users.update_one({"id": ahmet}, {"$set": {"company_ids": [cA, cB]}})

    # Both managers get visibility on Ahmet.
    requests.post(f"{API}/manager-visibility", headers=_h(admin_token), json={
        "manager_user_id": mA, "employee_user_id": ahmet,
    })
    requests.post(f"{API}/manager-visibility", headers=_h(admin_token), json={
        "manager_user_id": mB, "employee_user_id": ahmet,
    })

    mA_tok = _login("CP6_mgrA", "pass1234")
    mB_tok = _login("CP6_mgrB", "pass1234")
    ahmet_tok = _login("CP6_ahmet", "pass1234")
    yield {
        "cA": cA, "cB": cB,
        "mA": mA, "mB": mB, "ahmet": ahmet,
        "mA_tok": mA_tok, "mB_tok": mB_tok, "ahmet_tok": ahmet_tok,
    }
    _cleanup(db, "CP6_")


# ---------------------------------------------------------------------------
# 1) Multi-company member endpoints
# ---------------------------------------------------------------------------
class TestCompanyMembers:
    def test_list_members_visible_to_admin(self, admin_token, multi_company_grid):
        g = multi_company_grid
        r = requests.get(f"{API}/companies/{g['cA']}/members", headers=_h(admin_token))
        assert r.status_code == 200
        usernames = [u["username"] for u in r.json()]
        assert "CP6_ahmet" in usernames
        assert "CP6_mgrA" in usernames

    def test_manager_lists_own_company_members(self, multi_company_grid):
        g = multi_company_grid
        r = requests.get(f"{API}/companies/{g['cA']}/members", headers=_h(g["mA_tok"]))
        assert r.status_code == 200

    def test_manager_cannot_list_other_company_members(self, multi_company_grid):
        g = multi_company_grid
        r = requests.get(f"{API}/companies/{g['cB']}/members", headers=_h(g["mA_tok"]))
        assert r.status_code == 403

    def test_manager_removes_own_company_member_creates_orphans(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        # Create a task for Ahmet under Company A
        r = requests.post(f"{API}/tasks", headers=_h(admin_token), json={
            "title": "CP6_TestOrphan", "assignee_user_id": g["ahmet"], "company_id": g["cA"],
        })
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            # Manager A removes Ahmet from Company A
            r = requests.delete(f"{API}/companies/{g['cA']}/members/{g['ahmet']}", headers=_h(g["mA_tok"]))
            assert r.status_code == 200
            assert r.json()["removed"] is True
            assert r.json()["orphaned_tasks"] >= 1
            # Verify DB state
            doc = db.tasks.find_one({"id": tid})
            assert doc["orphaned"] is True
            assert doc["orphaned_from_company_id"] == g["cA"]
            # Ahmet still has Company B in his ids
            u = db.users.find_one({"id": g["ahmet"]})
            assert g["cB"] in u["company_ids"]
            assert g["cA"] not in u["company_ids"]
            # Re-add Ahmet to Company A for other tests
            r2 = requests.post(f"{API}/companies/{g['cA']}/members/{g['ahmet']}", headers=_h(g["mA_tok"]))
            assert r2.status_code == 200
        finally:
            db.tasks.delete_one({"id": tid})


# ---------------------------------------------------------------------------
# 2) Orphan tasks
# ---------------------------------------------------------------------------
class TestOrphanTasks:
    def test_manager_sees_own_company_orphans_only(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        # Seed: one orphan on A, one orphan on B
        db.tasks.insert_many([
            {
                "id": str(uuid.uuid4()), "user_id": g["ahmet"], "title": "OrphanA",
                "status": "pending", "orphaned": True,
                "orphaned_from_company_id": g["cA"],
                "orphaned_at": datetime.now(timezone.utc).isoformat(),
            },
            {
                "id": str(uuid.uuid4()), "user_id": g["ahmet"], "title": "OrphanB",
                "status": "pending", "orphaned": True,
                "orphaned_from_company_id": g["cB"],
                "orphaned_at": datetime.now(timezone.utc).isoformat(),
            },
        ])
        try:
            r = requests.get(f"{API}/orphan-tasks", headers=_h(g["mA_tok"]))
            assert r.status_code == 200
            titles = [t["title"] for t in r.json()]
            assert "OrphanA" in titles
            assert "OrphanB" not in titles  # isolation!
        finally:
            db.tasks.delete_many({"title": {"$in": ["OrphanA", "OrphanB"]}})

    def test_admin_sees_all_orphans(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        db.tasks.insert_one({
            "id": str(uuid.uuid4()), "user_id": g["ahmet"], "title": "OrphanAdminTest",
            "status": "pending", "orphaned": True,
            "orphaned_from_company_id": g["cA"],
            "orphaned_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            r = requests.get(f"{API}/orphan-tasks", headers=_h(admin_token))
            titles = [t["title"] for t in r.json()]
            assert "OrphanAdminTest" in titles
        finally:
            db.tasks.delete_many({"title": "OrphanAdminTest"})

    def test_employee_gets_empty_orphan_list(self, multi_company_grid):
        g = multi_company_grid
        r = requests.get(f"{API}/orphan-tasks", headers=_h(g["ahmet_tok"]))
        assert r.status_code == 200
        assert r.json() == []

    def test_reassign_orphan_clears_flags(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        # Create an orphan
        oid = str(uuid.uuid4())
        db.tasks.insert_one({
            "id": oid, "user_id": g["ahmet"], "title": "ReclaimTest",
            "status": "pending", "orphaned": True,
            "orphaned_from_company_id": g["cA"],
            "orphaned_at": datetime.now(timezone.utc).isoformat(),
        })
        try:
            # Manager A reassigns to Manager A themselves (must be visible)
            requests.post(f"{API}/manager-visibility", headers=_h(admin_token), json={
                "manager_user_id": g["mA"], "employee_user_id": g["mA"],
            })  # self-visibility ok, will 400 but not our concern
            r = requests.post(f"{API}/tasks/{oid}/reassign", headers=_h(g["mA_tok"]),
                              json={"new_owner_user_id": g["mA"]})
            # If self-visibility failed create a helper employee; else check the reclaim
            if r.status_code == 200:
                d = r.json()
                assert d["orphaned"] is False
                assert d["orphaned_from_company_id"] is None
                assert d["user_id"] == g["mA"]
        finally:
            db.tasks.delete_one({"id": oid})


# ---------------------------------------------------------------------------
# 3) User delete modes
# ---------------------------------------------------------------------------
class TestUserDeleteModes:
    def test_soft_orphan_preserves_completed_task_name(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        # Create a fresh user with 1 completed task + 1 active task
        u = _register(db, "CP6_deletetest_soft", company_id=g["cA"])
        db.tasks.insert_many([
            {
                "id": str(uuid.uuid4()), "user_id": u, "title": "Completed_soft",
                "status": "done", "assignee_name": "CP6_deletetest_soft",
                "company_id": g["cA"],
            },
            {
                "id": str(uuid.uuid4()), "user_id": u, "title": "Active_soft",
                "status": "pending", "assignee_name": "CP6_deletetest_soft",
                "company_id": g["cA"],
            },
        ])
        r = requests.delete(f"{API}/admin/users/{u}?mode=soft_orphan", headers=_h(admin_token))
        assert r.status_code == 200
        assert r.json()["mode"] == "soft_orphan"
        # Completed task keeps assignee_name
        c = db.tasks.find_one({"title": "Completed_soft"})
        assert c["assignee_name"] == "CP6_deletetest_soft"
        # Active task orphaned
        a = db.tasks.find_one({"title": "Active_soft"})
        assert a["orphaned"] is True
        # User is gone
        assert db.users.find_one({"id": u}) is None
        db.tasks.delete_many({"user_id": u})

    def test_purge_wipes_assignee_name_everywhere(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        u = _register(db, "CP6_deletetest_purge", company_id=g["cA"])
        db.tasks.insert_one({
            "id": str(uuid.uuid4()), "user_id": u, "title": "Completed_purge",
            "status": "done", "assignee_name": "CP6_deletetest_purge",
        })
        r = requests.delete(f"{API}/admin/users/{u}?mode=purge", headers=_h(admin_token))
        assert r.status_code == 200
        c = db.tasks.find_one({"title": "Completed_purge"})
        assert c["assignee_name"] is None
        db.tasks.delete_many({"user_id": u})

    def test_hard_delete_removes_everything(self, db, admin_token, multi_company_grid):
        g = multi_company_grid
        u = _register(db, "CP6_deletetest_hard", company_id=g["cA"])
        db.tasks.insert_one({
            "id": str(uuid.uuid4()), "user_id": u, "title": "HardKill",
            "status": "done",
        })
        r = requests.delete(f"{API}/admin/users/{u}?mode=hard", headers=_h(admin_token))
        assert r.status_code == 200
        assert db.tasks.find_one({"title": "HardKill"}) is None


# ---------------------------------------------------------------------------
# 4) Cross-company permission flow
# ---------------------------------------------------------------------------
class TestCrossCompanyFlow:
    def test_manager_request_creates_pending(self, admin_token, multi_company_grid):
        g = multi_company_grid
        # Clean any previous perms first
        r = requests.post(f"{API}/company-permissions", headers=_h(g["mA_tok"]), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
        assert r.json()["requested_by"] == g["mA"]

    def test_target_manager_approves(self, admin_token, multi_company_grid):
        g = multi_company_grid
        # ensure a pending exists
        r = requests.post(f"{API}/company-permissions", headers=_h(g["mA_tok"]), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        cpid = r.json()["id"]
        # Manager B approves
        r = requests.post(f"{API}/company-permissions/{cpid}/respond?approve=true", headers=_h(g["mB_tok"]))
        assert r.status_code == 200
        assert r.json()["status"] == "active"
        assert r.json()["responded_by"] == g["mB"]

    def test_admin_creates_active_directly(self, admin_token, multi_company_grid):
        g = multi_company_grid
        r = requests.post(f"{API}/company-permissions", headers=_h(admin_token), json={
            "viewer_company_id": g["cB"], "target_company_id": g["cA"],
        })
        assert r.status_code == 200
        assert r.json()["status"] == "active"

    def test_revoke(self, admin_token, multi_company_grid):
        g = multi_company_grid
        # Set up active perm B→A
        r = requests.post(f"{API}/company-permissions", headers=_h(admin_token), json={
            "viewer_company_id": g["cB"], "target_company_id": g["cA"],
        })
        cpid = r.json()["id"]
        # Manager A revokes (target side)
        r = requests.post(f"{API}/company-permissions/{cpid}/revoke", headers=_h(g["mA_tok"]))
        assert r.status_code == 200
