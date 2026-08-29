"""Sertex — Faz 9 CP1 · Cross-company permission notifications.

Scope:
  * Manager (viewer_company) posts a new request → all managers of
    target_company receive `cross_perm_request` notifications.
  * Admin creates an instant-active grant → managers of viewer_company
    receive a `cross_perm_response` (already approved) notification.
  * Target manager approves/declines → requester (or viewer managers)
    receive a `cross_perm_response`.
  * Active grant revoked → viewer managers receive `cross_perm_revoked`.
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


def _register(db, username, password="pass1234", role="employee", company_id=None, company_name=None):
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
        db.notifications.delete_many({"user_id": {"$in": ids}})
    db.users.delete_many({"username": {"$regex": f"^{prefix}"}})
    db.companies.delete_many({"name": {"$regex": f"^{prefix}"}})
    db.company_permissions.delete_many({})


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def cross_grid(db, admin_token):
    """Fresh grid with 2 companies and 1 manager each."""
    _cleanup(db, "CP9CROSS_")
    r = requests.post(f"{API}/companies", headers=_h(admin_token), json={"name": "CP9CROSS_A"})
    cA = r.json()["id"]
    r = requests.post(f"{API}/companies", headers=_h(admin_token), json={"name": "CP9CROSS_B"})
    cB = r.json()["id"]
    mA = _register(db, "CP9CROSS_mA", role="manager", company_id=cA, company_name="CP9CROSS_A")
    mB = _register(db, "CP9CROSS_mB", role="manager", company_id=cB, company_name="CP9CROSS_B")
    tA = _login("CP9CROSS_mA", "pass1234")
    tB = _login("CP9CROSS_mB", "pass1234")
    yield {"cA": cA, "cB": cB, "mA": mA, "mB": mB, "tA": tA, "tB": tB}
    _cleanup(db, "CP9CROSS_")


class TestCrossPermRequestNotifications:
    def test_manager_request_notifies_target_managers(self, db, cross_grid):
        g = cross_grid
        # Clean notifs
        db.notifications.delete_many({"user_id": g["mB"]})
        r = requests.post(f"{API}/company-permissions", headers=_h(g["tA"]), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        assert r.status_code == 200
        assert r.json()["status"] == "pending"
        # Manager B should have received one cross_perm_request
        n = db.notifications.find_one({
            "user_id": g["mB"], "type": "cross_perm_request",
        })
        assert n is not None, "Manager B did not get a cross_perm_request notif"
        assert n["viewer_company_name"] == "CP9CROSS_A"
        assert n["target_company_name"] == "CP9CROSS_B"
        assert n["permission_id"] == r.json()["id"]

    def test_admin_instant_grant_notifies_viewer_managers(self, db, cross_grid, admin_token):
        g = cross_grid
        # Clean prior + notifs so we can measure this new grant
        db.company_permissions.delete_many({})
        db.notifications.delete_many({"user_id": g["mA"]})
        r = requests.post(f"{API}/company-permissions", headers=_h(admin_token), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        assert r.status_code == 200
        assert r.json()["status"] == "active"
        # Manager A (viewer side) should get a cross_perm_response notif
        n = db.notifications.find_one({
            "user_id": g["mA"], "type": "cross_perm_response",
        })
        assert n is not None, "Manager A should be notified about their new visibility"
        assert n["payload"]["approved"] is True

    def test_response_approves_and_notifies_requester(self, db, cross_grid):
        g = cross_grid
        # Reset
        db.company_permissions.delete_many({})
        db.notifications.delete_many({"user_id": g["mA"]})
        # Manager A opens the request
        r = requests.post(f"{API}/company-permissions", headers=_h(g["tA"]), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        cpid = r.json()["id"]
        # Manager B approves
        r = requests.post(
            f"{API}/company-permissions/{cpid}/respond?approve=true",
            headers=_h(g["tB"]),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "active"
        # Manager A should now have a `cross_perm_response` with approved=True
        n = db.notifications.find_one({
            "user_id": g["mA"], "type": "cross_perm_response", "permission_id": cpid,
        })
        assert n is not None
        assert n["payload"]["approved"] is True

    def test_response_declines_and_notifies_requester(self, db, cross_grid):
        g = cross_grid
        db.company_permissions.delete_many({})
        db.notifications.delete_many({"user_id": g["mA"]})
        r = requests.post(f"{API}/company-permissions", headers=_h(g["tA"]), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        cpid = r.json()["id"]
        r = requests.post(
            f"{API}/company-permissions/{cpid}/respond?approve=false",
            headers=_h(g["tB"]),
        )
        assert r.status_code == 200
        assert r.json()["status"] == "declined"
        n = db.notifications.find_one({
            "user_id": g["mA"], "type": "cross_perm_response", "permission_id": cpid,
        })
        assert n is not None
        assert n["payload"]["approved"] is False

    def test_revoke_active_notifies_viewer(self, db, cross_grid, admin_token):
        g = cross_grid
        db.company_permissions.delete_many({})
        db.notifications.delete_many({"user_id": g["mA"]})
        # Admin instant active
        r = requests.post(f"{API}/company-permissions", headers=_h(admin_token), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        cpid = r.json()["id"]
        # Clear response notif so we only observe the revoke
        db.notifications.delete_many({"user_id": g["mA"]})
        # Manager B revokes
        r = requests.post(f"{API}/company-permissions/{cpid}/revoke", headers=_h(g["tB"]))
        assert r.status_code == 200
        n = db.notifications.find_one({
            "user_id": g["mA"], "type": "cross_perm_revoked", "permission_id": cpid,
        })
        assert n is not None
        assert n["payload"]["status"] == "revoked"

    def test_revoke_pending_does_not_notify(self, db, cross_grid):
        """Cancelling a still-pending request shouldn't spam anyone."""
        g = cross_grid
        db.company_permissions.delete_many({})
        db.notifications.delete_many({"user_id": g["mA"]})
        r = requests.post(f"{API}/company-permissions", headers=_h(g["tA"]), json={
            "viewer_company_id": g["cA"], "target_company_id": g["cB"],
        })
        cpid = r.json()["id"]
        # Reset notifs; then Manager A cancels their own request
        db.notifications.delete_many({"user_id": g["mA"]})
        r = requests.post(f"{API}/company-permissions/{cpid}/revoke", headers=_h(g["tA"]))
        assert r.status_code == 200
        n = db.notifications.find_one({
            "user_id": g["mA"], "type": "cross_perm_revoked",
        })
        assert n is None, "Cancelling pending request should NOT fire revoke notif"
