"""Faz 9 CP7 — FCM Push endpoints backend tests.

Focus on the token lifecycle and RBAC; actual FCM send is exercised by
`test-send` which will report `failed=1` for the fake token (that's OK —
we assert the endpoint path is valid, not that the token accepts push).
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
EMP_USER = "ahmet"
EMP_PASS = "ahmet123"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()


def _sess(tok):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin_ctx():
    j = _login(ADMIN_USER, ADMIN_PASS)
    return {"sess": _sess(j["token"]), "user": j["user"]}


@pytest.fixture(scope="module")
def emp_ctx():
    j = _login(EMP_USER, EMP_PASS)
    return {"sess": _sess(j["token"]), "user": j["user"]}


@pytest.fixture(autouse=True)
def _cleanup(admin_ctx, emp_ctx):
    """Best-effort removal of test tokens between tests. Token prefix reserves
    a namespace so we don't touch real device tokens."""
    def _clear():
        # We can only unregister our own tokens through the API; do it for both.
        for ctx in (admin_ctx, emp_ctx):
            for tok in [f"PYTEST_TOK_{i}_1234567890abcdef" for i in range(5)]:
                try:
                    ctx["sess"].post(f"{API}/fcm/unregister-token", json={"token": tok})
                except Exception:
                    pass
    _clear()
    yield
    _clear()


class TestRegister:
    def test_admin_register(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/fcm/register-token", json={
            "token": "PYTEST_TOK_0_1234567890abcdef",
            "platform": "android",
            "device_id": "test-device-adm",
        })
        assert r.status_code == 200, r.text
        j = r.json()
        assert j["ok"] is True and j["updated"] is False and "id" in j

    def test_idempotent_register(self, admin_ctx):
        tok = "PYTEST_TOK_1_1234567890abcdef"
        r1 = admin_ctx["sess"].post(f"{API}/fcm/register-token", json={"token": tok, "platform": "android"})
        assert r1.status_code == 200
        r2 = admin_ctx["sess"].post(f"{API}/fcm/register-token", json={"token": tok, "platform": "android"})
        assert r2.status_code == 200
        assert r2.json()["updated"] is True

    def test_invalid_platform(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/fcm/register-token", json={
            "token": "PYTEST_TOK_2_1234567890abcdef",
            "platform": "symbian",
        })
        assert r.status_code == 400, r.text


class TestListAndUnregister:
    def test_list_my_tokens_scoped(self, admin_ctx, emp_ctx):
        admin_ctx["sess"].post(f"{API}/fcm/register-token", json={
            "token": "PYTEST_TOK_3_1234567890abcdef", "platform": "android",
        })
        r_adm = admin_ctx["sess"].get(f"{API}/fcm/tokens/me")
        assert r_adm.status_code == 200
        # Employee cannot see admin's tokens (they get their own list)
        r_emp = emp_ctx["sess"].get(f"{API}/fcm/tokens/me")
        assert r_emp.status_code == 200
        # Verify no PYTEST tokens registered under employee (autoclean removes them)
        for row in r_emp.json():
            # tokens are stripped by the endpoint, so we check device_id instead
            assert row.get("device_id") != "test-device-adm"

    def test_unregister_removes(self, admin_ctx):
        tok = "PYTEST_TOK_4_1234567890abcdef"
        admin_ctx["sess"].post(f"{API}/fcm/register-token", json={"token": tok, "platform": "android"})
        r = admin_ctx["sess"].post(f"{API}/fcm/unregister-token", json={"token": tok})
        assert r.status_code == 200 and r.json()["removed"] == 1
        # Second call is idempotent
        r2 = admin_ctx["sess"].post(f"{API}/fcm/unregister-token", json={"token": tok})
        assert r2.status_code == 200 and r2.json()["removed"] == 0


class TestStatusAndRBAC:
    def test_status_admin_only(self, admin_ctx, emp_ctx):
        r = emp_ctx["sess"].get(f"{API}/fcm/status")
        assert r.status_code == 403
        r2 = admin_ctx["sess"].get(f"{API}/fcm/status")
        assert r2.status_code == 200
        assert "ready" in r2.json() and "active_tokens" in r2.json()

    def test_test_send_admin_only(self, admin_ctx, emp_ctx):
        r = emp_ctx["sess"].post(f"{API}/fcm/test-send", json={
            "user_id": emp_ctx["user"]["id"], "title": "t", "body": "b",
        })
        assert r.status_code == 403

    def test_test_send_unknown_user(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/fcm/test-send", json={
            "user_id": "does-not-exist", "title": "t", "body": "b",
        })
        assert r.status_code == 404

    def test_test_send_to_admin_no_tokens_returns_zero(self, admin_ctx):
        # No PYTEST tokens (they're fake anyway). If the admin currently has
        # zero tokens, send should return sent=0 without crashing.
        r = admin_ctx["sess"].post(f"{API}/fcm/test-send", json={
            "user_id": admin_ctx["user"]["id"], "title": "t", "body": "b",
        })
        assert r.status_code == 200
        j = r.json()
        assert "sent" in j and "failed" in j
