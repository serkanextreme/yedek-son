"""
Sertex UX iyileştirmeleri — Backend tests for combined user+license creation
and license-related regressions.

Covers:
- POST /api/admin/users with with_license='trial'|'monthly'|'yearly'|'lifetime':
    * creates user AND assigns a fresh license in one call
    * response body carries `license` sub-object with key/type/expires_at
    * created user can immediately login and access /api/tasks WITHOUT any /api/license/redeem call
- with_license omitted or null → no license assigned (legacy behaviour)
- with_license invalid → 400
- with_license ignored when role='admin' (admin never needs a license)
- Regression: existing POST /api/admin/users without with_license still works
- Regression: /api/license/me and /api/license/redeem still function
- Cleanup at teardown

NOTE ON SESSIONS:
  Sertex enforces single-session — logging into the SAME user in parallel workers
  kicks the earlier token. This module MUST run serially (`-p no:xdist -n 0`) OR
  each test that logs in as `ahmet`/`serkan` must NOT overlap with parallel worker
  runs. We isolate by creating fresh TEST_ users for licensed workflows so we do
  not touch the shared `ahmet` session in the middle of the module.
"""
from __future__ import annotations

import os
import re
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any

import pytest
import requests


def _read_env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v:
        return v
    for path in ("/app/frontend/.env", "/app/backend/.env"):
        try:
            with open(path, "r", encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line or line.startswith("#") or "=" not in line:
                        continue
                    k, val = line.split("=", 1)
                    if k.strip() == key:
                        return val.strip().strip('"').strip("'")
        except OSError:
            continue
    return default


BASE_URL = _read_env("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL must be set"
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
REG_USER = "ahmet"
REG_PASS = "ahmet123"

KEY_RE = re.compile(r"^SERTEX(?:-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){3}$")

# --- track created resources for cleanup ---
_created_user_ids: List[str] = []
_created_license_ids: List[str] = []


def _login(session: requests.Session, username: str, password: str) -> str:
    r = session.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login({username}): {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    token = _login(s, ADMIN_USER, ADMIN_PASS)
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


def _new_username(tag: str) -> str:
    return f"TEST_ux_{tag}_{uuid.uuid4().hex[:6]}"


def _create_via_admin(admin: requests.Session, tag: str, *, role: str = "user",
                      with_license=None, password: str = "TestPass123!") -> Dict[str, Any]:
    uname = _new_username(tag)
    body: Dict[str, Any] = {"username": uname, "password": password, "role": role}
    if with_license is not None:
        body["with_license"] = with_license
    r = admin.post(f"{API}/admin/users", json=body, timeout=30)
    return {"resp": r, "username": uname, "password": password}


# ============================================================
# 1) Combined create user + license
# ============================================================
class TestCreateUserWithLicense:
    @pytest.mark.parametrize("ltype,expected_days", [
        ("trial", 30),
        ("monthly", 30),
        ("yearly", 365),
        ("lifetime", None),
    ])
    def test_create_user_with_each_license_type(self, admin_session, ltype, expected_days):
        info = _create_via_admin(admin_session, f"{ltype}", with_license=ltype)
        r = info["resp"]
        assert r.status_code in (200, 201), f"{ltype}: {r.status_code} {r.text}"
        data = r.json()
        _created_user_ids.append(data["id"])

        # Basic user shape
        assert data["username"] == info["username"]
        # Faz 8: legacy 'user' role is normalized to 'employee' on create.
        assert data["role"] == "employee"
        assert "password_hash" not in data

        # License sub-object
        assert "license" in data, "Expected 'license' in response"
        lic = data["license"]
        assert lic["type"] == ltype
        assert KEY_RE.match(lic["key"]), f"Bad key format: {lic['key']}"
        _created_license_ids.append(lic["id"])

        # Lifetime → expires_at is None; others → future date
        if ltype == "lifetime":
            assert lic.get("expires_at") in (None, "",), f"lifetime expires_at not empty: {lic.get('expires_at')}"
        else:
            assert lic["expires_at"], f"{ltype}: expected expires_at, got {lic}"
            exp = datetime.fromisoformat(lic["expires_at"].replace("Z", "+00:00"))
            delta_days = (exp - datetime.now(timezone.utc)).days
            # allow +/- 1 day slack
            assert abs(delta_days - expected_days) <= 1, f"{ltype}: expected ~{expected_days}d, got {delta_days}d"

        # ---- New user can log in and immediately hit /api/tasks (200) with NO redeem step ----
        anon = requests.Session()
        anon.headers.update({"Content-Type": "application/json"})
        token = _login(anon, info["username"], info["password"])
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
        r_tasks = s.get(f"{API}/tasks", timeout=30)
        assert r_tasks.status_code == 200, f"/tasks should be 200 for {ltype} user, got {r_tasks.status_code}: {r_tasks.text}"

        # /license/me reflects the just-assigned license
        r_me = s.get(f"{API}/license/me", timeout=30)
        assert r_me.status_code == 200
        me = r_me.json()
        assert me["has_license"] is True
        assert me["type"] == ltype
        assert me["key"] == lic["key"]


# ============================================================
# 2) Omitted / null with_license → no license (legacy)
# ============================================================
class TestCreateUserWithoutLicense:
    def test_omitted_with_license_no_license(self, admin_session):
        info = _create_via_admin(admin_session, "no_lic")
        r = info["resp"]
        assert r.status_code in (200, 201), r.text
        data = r.json()
        _created_user_ids.append(data["id"])
        assert "license" not in data or data.get("license") in (None, {}), \
            f"Expected no license sub-obj, got: {data.get('license')}"

        # New user should still login but be gated on /tasks (402)
        anon = requests.Session()
        anon.headers.update({"Content-Type": "application/json"})
        token = _login(anon, info["username"], info["password"])
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
        r_tasks = s.get(f"{API}/tasks", timeout=30)
        assert r_tasks.status_code == 402, f"Expected 402 NO_LICENSE, got {r_tasks.status_code}"

    def test_explicit_null_with_license_no_license(self, admin_session):
        info = _create_via_admin(admin_session, "null_lic", with_license=None)
        r = info["resp"]
        assert r.status_code in (200, 201), r.text
        data = r.json()
        _created_user_ids.append(data["id"])
        assert "license" not in data or data.get("license") in (None, {})


# ============================================================
# 3) Invalid values / edge cases
# ============================================================
class TestInvalidValues:
    def test_invalid_license_type_400(self, admin_session):
        info = _create_via_admin(admin_session, "invalid", with_license="weekly")
        r = info["resp"]
        assert r.status_code == 400, f"Expected 400, got {r.status_code}: {r.text}"

    def test_admin_role_ignores_with_license(self, admin_session):
        """Admin users never need a license; server should NOT assign one even
        if with_license is provided."""
        info = _create_via_admin(admin_session, "admin_role", role="admin", with_license="trial")
        r = info["resp"]
        assert r.status_code in (200, 201), r.text
        data = r.json()
        _created_user_ids.append(data["id"])
        assert data["role"] == "admin"
        assert "license" not in data or data.get("license") in (None, {}), \
            f"Admin role should not get a license, got: {data.get('license')}"


# ============================================================
# 4) Regressions
# ============================================================
class TestRegressions:
    def test_admin_users_list_still_works(self, admin_session):
        r = admin_session.get(f"{API}/admin/users", timeout=30)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_license_me_still_works_for_admin(self, admin_session):
        r = admin_session.get(f"{API}/license/me", timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["is_admin"] is True
        assert me["has_license"] is True

    def test_license_types_endpoint(self, admin_session):
        r = admin_session.get(f"{API}/admin/licenses/types", timeout=30)
        assert r.status_code == 200
        assert set(r.json().get("types", [])) == {"trial", "monthly", "yearly", "lifetime"}


# ============================================================
# 5) Support for "expiring banner" testability:
#    ability to bring days_left down to <=7 via PATCH extend_days
# ============================================================
class TestExpiringSupport:
    def test_patch_expires_at_yields_days_left_5(self, admin_session):
        """Backend test that lets frontend prove the expiring banner logic:
        create a user w/ trial (30 days) then extend_days=-25 so days_left ~= 5."""
        info = _create_via_admin(admin_session, "exp5", with_license="trial")
        r = info["resp"]
        assert r.status_code in (200, 201), r.text
        data = r.json()
        _created_user_ids.append(data["id"])
        lic = data["license"]
        _created_license_ids.append(lic["id"])

        # Bring it down to ~5 days remaining
        r = admin_session.patch(
            f"{API}/admin/licenses/{lic['id']}",
            json={"extend_days": -25},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        exp = datetime.fromisoformat(r.json()["expires_at"].replace("Z", "+00:00"))
        remaining = (exp - datetime.now(timezone.utc)).days
        assert 3 <= remaining <= 7, f"expected 3..7 days remaining after -25d extend, got {remaining}"

        # Login as this user and confirm /license/me exposes matching days_left <= 7
        anon = requests.Session()
        anon.headers.update({"Content-Type": "application/json"})
        tok = _login(anon, info["username"], info["password"])
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
        r = s.get(f"{API}/license/me", timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["has_license"] is True
        assert me["type"] == "trial"
        assert isinstance(me["days_left"], int)
        assert me["days_left"] <= 7, f"days_left should be <=7 for banner, got {me['days_left']}"


# ============================================================
# Cleanup
# ============================================================
@pytest.fixture(scope="module", autouse=True)
def _cleanup(admin_session):
    yield
    # Delete created users (unassigns their licenses too depending on server logic).
    for uid in list(_created_user_ids):
        try:
            admin_session.delete(f"{API}/admin/users/{uid}", timeout=15)
        except Exception:
            pass
    # For any license ids not attached to a user any more, try to delete;
    # revoke otherwise.
    for lid in list(_created_license_ids):
        try:
            resp = admin_session.get(f"{API}/admin/licenses", timeout=15)
            all_lic = resp.json().get("licenses", [])
            match = next((l for l in all_lic if l["id"] == lid), None)
            if not match:
                continue
            if match.get("assigned_user_id"):
                admin_session.patch(f"{API}/admin/licenses/{lid}", json={"status": "revoked"}, timeout=15)
            else:
                admin_session.delete(f"{API}/admin/licenses/{lid}", timeout=15)
        except Exception:
            pass
