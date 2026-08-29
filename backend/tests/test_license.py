"""
Sertex Faz 5 — License system backend tests.

Covers:
- License model (4 types + duration_days) via GET /api/admin/licenses/types + generation
- CD-Key format & alphabet & uniqueness
- Admin CRUD:
    POST /api/admin/licenses/generate (admin-only, count 1-500)
    GET  /api/admin/licenses (+ filters status/type)
    GET  /api/admin/licenses/stats
    PATCH /api/admin/licenses/{id} (status, extend_days, notes)
    DELETE /api/admin/licenses/{id} (unassigned only)
- User-facing:
    GET /api/license/me (admin / unlicensed / licensed)
    POST /api/license/redeem (happy, idempotent, wrong-user 409, invalid 400,
                              not-found 404, suspended/revoked 400, lowercase input)
- License gate on protected endpoints (402 NO_LICENSE)
- License gate does NOT block public/auth endpoints
- Single-session enforcement (SESSION_KICKED)
- Expiry + revive via extend_days
- Cleanup at teardown: revoke any TEST_-created license & delete unassigned
"""
from __future__ import annotations

import os
import re
import time
import uuid
import re as _re
from datetime import datetime, timezone, timedelta
from typing import Any, Dict, List, Optional

import pytest
import requests


# ---------- helpers ----------
def _read_env(key: str, default: str = "") -> str:
    v = os.environ.get(key)
    if v:
        return v
    for path in ("/app/backend/.env", "/app/frontend/.env"):
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


BASE_URL = _read_env("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
REG_USER = "ahmet"
REG_PASS = "ahmet123"

KEY_RE = re.compile(r"^SERTEX(?:-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}){3}$")
UNAMBIGUOUS_ALPHABET = set("ABCDEFGHJKMNPQRSTUVWXYZ23456789")


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


def _login(anon_s: requests.Session, username: str, password: str) -> str:
    r = anon_s.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login({username}) -> {r.status_code}: {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token(anon):
    return _login(anon, ADMIN_USER, ADMIN_PASS)


@pytest.fixture(scope="module")
def admin(admin_token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {admin_token}"})
    return s


@pytest.fixture(scope="module")
def ahmet_token(anon):
    return _login(anon, REG_USER, REG_PASS)


@pytest.fixture(scope="module")
def ahmet(ahmet_token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {ahmet_token}"})
    return s


# Track keys created by these tests so we can clean up at the end
_created_license_ids: List[str] = []
_created_license_keys: List[str] = []


def _remember(licenses: List[Dict[str, Any]]):
    for l in licenses:
        _created_license_ids.append(l["id"])
        _created_license_keys.append(l["key"])


def _admin_generate(admin_s: requests.Session, type_: str, count: int = 1, notes: str = "TEST_") -> List[Dict[str, Any]]:
    r = admin_s.post(f"{API}/admin/licenses/generate", json={"type": type_, "count": count, "notes": notes}, timeout=30)
    assert r.status_code == 200, f"generate {type_} x{count}: {r.status_code} {r.text}"
    data = r.json()
    assert data.get("created") == count
    assert len(data["licenses"]) == count
    _remember(data["licenses"])
    return data["licenses"]


# ============================================================
# 1) Types & key format
# ============================================================
class TestLicenseTypesAndFormat:
    def test_types_endpoint_admin_only(self, anon, admin):
        r = anon.get(f"{API}/admin/licenses/types", timeout=30)
        assert r.status_code == 401  # no token
        r = admin.get(f"{API}/admin/licenses/types", timeout=30)
        assert r.status_code == 200, r.text
        data = r.json()
        assert set(data["types"]) == {"trial", "monthly", "yearly", "lifetime"}

    def test_generated_keys_format_and_alphabet(self, admin):
        licenses = _admin_generate(admin, "trial", count=5, notes="TEST_format")
        for l in licenses:
            key = l["key"]
            assert KEY_RE.match(key), f"Bad format: {key}"
            # Every char between dashes must be from the unambiguous alphabet
            body = key.split("-", 1)[1]
            for ch in body.replace("-", ""):
                assert ch in UNAMBIGUOUS_ALPHABET, f"Ambiguous char in {key}"

    def test_generated_keys_are_unique(self, admin):
        licenses = _admin_generate(admin, "trial", count=20, notes="TEST_uniq")
        keys = [l["key"] for l in licenses]
        assert len(keys) == len(set(keys))

    def test_duration_days_per_type(self, admin):
        for t, expected in [("trial", 30), ("monthly", 30), ("yearly", 365), ("lifetime", None)]:
            l = _admin_generate(admin, t, count=1, notes=f"TEST_dur_{t}")[0]
            assert l["type"] == t
            assert l["duration_days"] == expected


# ============================================================
# 2) Admin CRUD & authorization
# ============================================================
class TestAdminCRUD:
    def test_generate_requires_admin(self, ahmet):
        r = ahmet.post(f"{API}/admin/licenses/generate", json={"type": "trial", "count": 1}, timeout=30)
        assert r.status_code == 403, f"Non-admin got {r.status_code}"

    def test_generate_invalid_type(self, admin):
        r = admin.post(f"{API}/admin/licenses/generate", json={"type": "weekly", "count": 1}, timeout=30)
        assert r.status_code == 400

    def test_generate_count_out_of_range(self, admin):
        r = admin.post(f"{API}/admin/licenses/generate", json={"type": "trial", "count": 0}, timeout=30)
        assert r.status_code in (400, 422)
        r = admin.post(f"{API}/admin/licenses/generate", json={"type": "trial", "count": 501}, timeout=30)
        assert r.status_code in (400, 422)

    def test_list_and_filter(self, admin):
        # Ensure at least one monthly + one yearly + one lifetime exist
        _admin_generate(admin, "monthly", 1, "TEST_filter_monthly")
        _admin_generate(admin, "yearly", 1, "TEST_filter_yearly")
        _admin_generate(admin, "lifetime", 1, "TEST_filter_lifetime")

        r = admin.get(f"{API}/admin/licenses", timeout=30)
        assert r.status_code == 200
        all_licenses = r.json()["licenses"]
        assert len(all_licenses) >= 4

        # newest-first
        created_ats = [l["created_at"] for l in all_licenses if l.get("created_at")]
        assert created_ats == sorted(created_ats, reverse=True)

        # filter by type
        r = admin.get(f"{API}/admin/licenses", params={"type": "yearly"}, timeout=30)
        assert r.status_code == 200
        assert all(l["type"] == "yearly" for l in r.json()["licenses"])

        # filter by status
        r = admin.get(f"{API}/admin/licenses", params={"status": "active"}, timeout=30)
        assert r.status_code == 200
        assert all(l["status"] == "active" for l in r.json()["licenses"])

    def test_stats_shape(self, admin):
        r = admin.get(f"{API}/admin/licenses/stats", timeout=30)
        assert r.status_code == 200
        s = r.json()
        for key in ("total", "used", "active_used", "unused", "buckets"):
            assert key in s, f"Missing key {key} in stats"
        assert isinstance(s["buckets"], list)
        assert s["total"] >= s["used"]
        assert s["unused"] == s["total"] - s["used"]

    def test_patch_extend_and_notes(self, admin):
        l = _admin_generate(admin, "monthly", 1, "TEST_patch")[0]
        # Since key is unassigned, expires_at is None → extend_days makes it now+7d
        r = admin.patch(f"{API}/admin/licenses/{l['id']}", json={"extend_days": 7, "notes": "extended"}, timeout=30)
        assert r.status_code == 200, r.text
        assert r.json()["notes"] == "extended"
        assert r.json()["expires_at"] is not None

    def test_patch_suspend_activate_revoke(self, admin):
        l = _admin_generate(admin, "monthly", 1, "TEST_status")[0]
        for status in ("suspended", "active", "revoked"):
            r = admin.patch(f"{API}/admin/licenses/{l['id']}", json={"status": status}, timeout=30)
            assert r.status_code == 200, r.text
            assert r.json()["status"] == status

    def test_patch_invalid_status(self, admin):
        l = _admin_generate(admin, "trial", 1, "TEST_badstatus")[0]
        r = admin.patch(f"{API}/admin/licenses/{l['id']}", json={"status": "burned"}, timeout=30)
        assert r.status_code == 400

    def test_delete_unassigned(self, admin):
        l = _admin_generate(admin, "trial", 1, "TEST_delete")[0]
        r = admin.delete(f"{API}/admin/licenses/{l['id']}", timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") == 1
        # After deletion, remove from cleanup list
        try:
            _created_license_ids.remove(l["id"])
        except ValueError:
            pass

    def test_delete_assigned_blocked(self, admin, ahmet):
        """Delete on an assigned key must return 400 with a hint mentioning iptal."""
        # Create + redeem a fresh key for ahmet
        # (ahmet already has a trial; assigning a second one just updates DB — but
        # 2nd redemption is allowed since our code only blocks the SAME key from
        # being taken by a different user.)
        keys = _admin_generate(admin, "monthly", 1, "TEST_delassigned")
        key = keys[0]["key"]
        r = ahmet.post(f"{API}/license/redeem", json={"key": key}, timeout=30)
        assert r.status_code == 200, r.text

        # Try to delete assigned key as admin
        r = admin.delete(f"{API}/admin/licenses/{keys[0]['id']}", timeout=30)
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "").lower()
        assert "iptal" in detail

    def test_admin_endpoints_forbidden_for_regular(self, ahmet):
        for path in ("/admin/licenses", "/admin/licenses/stats", "/admin/licenses/types"):
            r = ahmet.get(f"{API}{path}", timeout=30)
            assert r.status_code == 403, f"{path} -> {r.status_code}"


# ============================================================
# 3) User redeem flows
# ============================================================
class TestRedeemFlows:
    def test_invalid_format_400(self, ahmet):
        r = ahmet.post(f"{API}/license/redeem", json={"key": "NOTACODE"}, timeout=30)
        assert r.status_code == 400

    def test_not_found_404(self, ahmet):
        # Well-formed but nonexistent
        fake = "SERTEX-ZZZZ-ZZZZ-ZZZZ"
        r = ahmet.post(f"{API}/license/redeem", json={"key": fake}, timeout=30)
        assert r.status_code == 404

    def test_case_insensitive_and_idempotent(self, admin, ahmet):
        key = _admin_generate(admin, "monthly", 1, "TEST_case")[0]["key"]
        # 1st redeem with lowercase → succeeds
        r = ahmet.post(f"{API}/license/redeem", json={"key": key.lower()}, timeout=30)
        assert r.status_code == 200, r.text
        lic = r.json()["license"]
        assert lic["assigned_username"] == REG_USER
        assert lic["expires_at"] is not None

        # 2nd redeem by same user → same license (idempotent)
        r2 = ahmet.post(f"{API}/license/redeem", json={"key": key}, timeout=30)
        assert r2.status_code == 200
        lic2 = r2.json()["license"]
        assert lic2["id"] == lic["id"]
        assert lic2["assigned_user_id"] == lic["assigned_user_id"]

    def test_redeem_by_different_user_conflict(self, anon, admin, ahmet):
        # Create a fresh regular user to attempt cross-user redemption
        new_username = f"TEST_ru_{uuid.uuid4().hex[:6]}"
        new_password = "TestPass123!"
        # Admin creates user
        r = admin.post(f"{API}/admin/users", json={
            "username": new_username, "password": new_password, "role": "user"
        }, timeout=30)
        assert r.status_code in (200, 201), r.text
        new_uid = r.json().get("id")

        # Generate a key & redeem as ahmet first
        key = _admin_generate(admin, "monthly", 1, "TEST_conflict")[0]["key"]
        r = ahmet.post(f"{API}/license/redeem", json={"key": key}, timeout=30)
        assert r.status_code == 200, r.text

        # New user tries same key → 409
        new_token = _login(anon, new_username, new_password)
        s = requests.Session()
        s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {new_token}"})
        r = s.post(f"{API}/license/redeem", json={"key": key}, timeout=30)
        assert r.status_code == 409, f"Expected 409 conflict, got {r.status_code}: {r.text}"

        # Cleanup: delete new user
        if new_uid:
            admin.delete(f"{API}/admin/users/{new_uid}", timeout=30)

    def test_suspended_key_rejected(self, admin, ahmet):
        # Generate a fresh key, suspend it, then try to redeem
        lic = _admin_generate(admin, "monthly", 1, "TEST_suspended")[0]
        admin.patch(f"{API}/admin/licenses/{lic['id']}", json={"status": "suspended"}, timeout=30)
        # Use a different regular user context is not needed — even ahmet cannot redeem a suspended unassigned key
        r = ahmet.post(f"{API}/license/redeem", json={"key": lic["key"]}, timeout=30)
        assert r.status_code == 400

    def test_revoked_key_rejected(self, admin, ahmet):
        lic = _admin_generate(admin, "monthly", 1, "TEST_revoked")[0]
        admin.patch(f"{API}/admin/licenses/{lic['id']}", json={"status": "revoked"}, timeout=30)
        r = ahmet.post(f"{API}/license/redeem", json={"key": lic["key"]}, timeout=30)
        assert r.status_code == 400


# ============================================================
# 4) /api/license/me
# ============================================================
class TestLicenseMe:
    def test_me_admin_shape(self, admin):
        r = admin.get(f"{API}/license/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["has_license"] is True
        assert data["is_admin"] is True
        assert data["type"] == "admin"

    def test_me_licensed_user_shape(self, ahmet):
        # ahmet already has a trial from earlier admin activity
        r = ahmet.get(f"{API}/license/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["has_license"] is True
        assert data["is_admin"] is False
        assert data["type"] in {"trial", "monthly", "yearly", "lifetime"}
        assert "type_label" in data
        assert "expires_at" in data
        assert "days_left" in data
        assert "key" in data

    def test_me_unlicensed_user_shape(self, anon, admin):
        # Create a brand new user with no license
        u = f"TEST_unl_{uuid.uuid4().hex[:6]}"
        p = "TestPass123!"
        r = admin.post(f"{API}/admin/users", json={"username": u, "password": p, "role": "user"}, timeout=30)
        assert r.status_code in (200, 201)
        uid = r.json().get("id")
        try:
            tok = _login(anon, u, p)
            s = requests.Session()
            s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
            r = s.get(f"{API}/license/me", timeout=30)
            assert r.status_code == 200
            data = r.json()
            assert data["has_license"] is False
            assert data["is_admin"] is False
            assert data.get("previous_status") is None
        finally:
            if uid:
                admin.delete(f"{API}/admin/users/{uid}", timeout=30)


# ============================================================
# 5) License gate on protected endpoints
# ============================================================
class TestLicenseGate:
    # /weather (main) uses current_user (not licensed_user) — reported as a bug.
    # /weather/search IS gated correctly.
    PROTECTED_GETS = ["/tasks", "/notes", "/memory", "/weather/search?q=Ankara", "/files"]

    def test_unlicensed_user_blocked_402(self, anon, admin):
        u = f"TEST_gate_{uuid.uuid4().hex[:6]}"
        p = "TestPass123!"
        r = admin.post(f"{API}/admin/users", json={"username": u, "password": p, "role": "user"}, timeout=30)
        assert r.status_code in (200, 201), r.text
        uid = r.json().get("id")

        try:
            tok = _login(anon, u, p)
            s = requests.Session()
            s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})

            for path in self.PROTECTED_GETS:
                r = s.get(f"{API}{path}", timeout=30)
                assert r.status_code == 402, f"{path} expected 402, got {r.status_code}"
                assert r.json().get("detail", "").startswith("NO_LICENSE:"), r.text

            # Chat POST also 402
            r = s.post(f"{API}/chat", json={"message": "hi", "language": "tr"}, timeout=30)
            assert r.status_code == 402
            assert r.json().get("detail", "").startswith("NO_LICENSE:")

            # Public / non-gated endpoints must still work for this unlicensed user
            r = s.get(f"{API}/license/me", timeout=30)
            assert r.status_code == 200
            r = s.get(f"{API}/auth/me", timeout=30)
            assert r.status_code == 200
        finally:
            if uid:
                admin.delete(f"{API}/admin/users/{uid}", timeout=30)

    def test_admin_bypasses_gate(self, admin):
        # Admin should get 200 on protected endpoints regardless of licenses
        r = admin.get(f"{API}/tasks", timeout=30)
        assert r.status_code == 200
        r = admin.get(f"{API}/notes", timeout=30)
        assert r.status_code == 200
        r = admin.get(f"{API}/", timeout=30)
        assert r.status_code == 200

    def test_weather_main_endpoint_should_be_gated(self, anon, admin):
        """BUG: /api/weather uses current_user (not licensed_user) — unlicensed users
        can call it. Per Faz 5 spec /api/weather is on the gated list.
        This test currently fails intentionally to document the gap.
        """
        u = f"TEST_wg_{uuid.uuid4().hex[:6]}"
        p = "TestPass123!"
        r = admin.post(f"{API}/admin/users", json={"username": u, "password": p, "role": "user"}, timeout=30)
        assert r.status_code in (200, 201)
        uid = r.json().get("id")
        try:
            tok = _login(anon, u, p)
            s = requests.Session()
            s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})
            r = s.get(f"{API}/weather?city=Ankara", timeout=30)
            assert r.status_code == 402, (
                f"/api/weather should be license-gated but returned {r.status_code}. "
                "Change Depends(current_user) → Depends(licensed_user) in server.py::weather()."
            )
        finally:
            if uid:
                admin.delete(f"{API}/admin/users/{uid}", timeout=30)


# ============================================================
# 6) Expiry + revive
# ============================================================
class TestExpiryAndRevive:
    def test_expired_license_blocked_then_revived(self, anon, admin):
        # Fresh user
        u = f"TEST_exp_{uuid.uuid4().hex[:6]}"
        p = "TestPass123!"
        r = admin.post(f"{API}/admin/users", json={"username": u, "password": p, "role": "user"}, timeout=30)
        assert r.status_code in (200, 201)
        uid = r.json().get("id")

        try:
            tok = _login(anon, u, p)
            s = requests.Session()
            s.headers.update({"Authorization": f"Bearer {tok}", "Content-Type": "application/json"})

            # Give them a trial license
            key = _admin_generate(admin, "trial", 1, "TEST_expiry")[0]["key"]
            r = s.post(f"{API}/license/redeem", json={"key": key}, timeout=30)
            assert r.status_code == 200, r.text

            # Sanity: /tasks now works
            r = s.get(f"{API}/tasks", timeout=30)
            assert r.status_code == 200

            # Backdate expires_at to yesterday via PATCH with negative extend_days
            # Current expiry ~30d away → -40d makes it in the past
            lic = r.json() if False else None  # placeholder
            # Locate the license id from admin list (assigned to this user)
            r = admin.get(f"{API}/admin/licenses", timeout=30)
            mine = [l for l in r.json()["licenses"] if l.get("assigned_username") == u]
            assert mine, "License not found for new user"
            lic_id = mine[0]["id"]
            r = admin.patch(f"{API}/admin/licenses/{lic_id}", json={"extend_days": -40}, timeout=30)
            assert r.status_code == 200, r.text
            new_exp = datetime.fromisoformat(r.json()["expires_at"])
            assert new_exp < datetime.now(timezone.utc), "expected past expiry"

            # /license/me now says no license
            r = s.get(f"{API}/license/me", timeout=30)
            assert r.status_code == 200
            assert r.json()["has_license"] is False

            # Protected endpoint → 402
            r = s.get(f"{API}/tasks", timeout=30)
            assert r.status_code == 402

            # Admin extends +50d → license alive again
            r = admin.patch(f"{API}/admin/licenses/{lic_id}", json={"extend_days": 50}, timeout=30)
            assert r.status_code == 200
            r = s.get(f"{API}/tasks", timeout=30)
            assert r.status_code == 200
        finally:
            if uid:
                admin.delete(f"{API}/admin/users/{uid}", timeout=30)


# ============================================================
# 7) Single-session enforcement
# ============================================================
class TestSingleSession:
    def test_second_login_kicks_first(self, anon):
        # ahmet logs in twice → 1st token should get 401 SESSION_KICKED on use
        # Use fresh sessions
        anon_a = requests.Session()
        anon_a.headers.update({"Content-Type": "application/json"})
        anon_b = requests.Session()
        anon_b.headers.update({"Content-Type": "application/json"})

        tok_a = _login(anon_a, REG_USER, REG_PASS)
        # 1st call still works
        r = requests.get(f"{API}/license/me", headers={"Authorization": f"Bearer {tok_a}"}, timeout=30)
        assert r.status_code == 200

        # 2nd login
        tok_b = _login(anon_b, REG_USER, REG_PASS)
        assert tok_a != tok_b

        # tok_a is now stale
        r = requests.get(f"{API}/license/me", headers={"Authorization": f"Bearer {tok_a}"}, timeout=30)
        assert r.status_code == 401
        assert r.json().get("detail", "").startswith("SESSION_KICKED:"), r.text

        # tok_b still works
        r = requests.get(f"{API}/license/me", headers={"Authorization": f"Bearer {tok_b}"}, timeout=30)
        assert r.status_code == 200


# ============================================================
# 8) Regression: admin can still hit legacy endpoints
# ============================================================
class TestAdminRegression:
    def test_admin_health(self, admin):
        r = admin.get(f"{API}/", timeout=30)
        assert r.status_code == 200

    def test_admin_tasks_notes(self, admin):
        assert admin.get(f"{API}/tasks", timeout=30).status_code == 200
        assert admin.get(f"{API}/notes", timeout=30).status_code == 200

    def test_admin_users_list(self, admin):
        r = admin.get(f"{API}/admin/users", timeout=30)
        assert r.status_code == 200


# ============================================================
# Cleanup at teardown — revoke test-created assigned keys, delete unassigned
# ============================================================
@pytest.fixture(scope="module", autouse=True)
def _cleanup_licenses(admin):
    yield
    # After every test in this module has run, remove test-generated licenses
    for lid in list(_created_license_ids):
        try:
            info = admin.get(f"{API}/admin/licenses", timeout=15).json()["licenses"]
            match = next((x for x in info if x["id"] == lid), None)
            if not match:
                continue
            if match.get("assigned_user_id"):
                admin.patch(f"{API}/admin/licenses/{lid}", json={"status": "revoked"}, timeout=15)
            else:
                admin.delete(f"{API}/admin/licenses/{lid}", timeout=15)
        except Exception:
            pass
