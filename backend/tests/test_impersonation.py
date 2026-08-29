"""
Sertex admin impersonation tests.

Covers the new POST /api/admin/users/{uid}/impersonate feature.
- Admin can impersonate any user (returns token + user + impersonation: true).
- Non-admin gets 403.
- Impersonation token can access target user's protected endpoints (e.g. /api/tasks) and returns
  the impersonated user's data.
- Impersonation JWT payload contains impersonated_by claim.
"""
import os
import uuid
import time

import jwt as _jwt
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_USER = os.environ.get("INITIAL_USERNAME", "serkan")
ADMIN_PASS = os.environ.get("INITIAL_PASSWORD", "19071987")

# Regular test user - will be created via admin API if missing
REG_USER = "ahmet"
REG_PASS = "ahmet123"


def _read_env(key: str) -> str:
    try:
        with open("/app/backend/.env") as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""


@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(
        f"{API}/auth/login",
        json={"username": ADMIN_USER, "password": ADMIN_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"Admin login failed: {r.status_code} {r.text}"
    data = r.json()
    assert data["user"]["role"] == "admin", f"Expected role admin, got {data['user'].get('role')}"
    return data["token"]


@pytest.fixture(scope="module")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def ensure_regular_user(admin_headers):
    """Ensure the 'ahmet' user exists (create via admin API if missing).

    Return (user_id, username, password)."""
    r = requests.get(f"{API}/admin/users", headers=admin_headers, timeout=30)
    assert r.status_code == 200
    users = r.json()
    existing = next((u for u in users if u["username"] == REG_USER), None)
    if existing:
        # Reset password so we know it
        rr = requests.patch(
            f"{API}/admin/users/{existing['id']}",
            headers=admin_headers,
            json={"new_password": REG_PASS},
            timeout=30,
        )
        assert rr.status_code == 200, rr.text
        return existing["id"]
    # Create fresh
    r = requests.post(
        f"{API}/admin/users",
        headers=admin_headers,
        json={"username": REG_USER, "password": REG_PASS, "role": "user"},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    return r.json()["id"]


@pytest.fixture(scope="module")
def regular_token(ensure_regular_user):
    r = requests.post(
        f"{API}/auth/login",
        json={"username": REG_USER, "password": REG_PASS},
        timeout=30,
    )
    assert r.status_code == 200, r.text
    data = r.json()
    assert data["user"]["role"] == "employee"
    return data["token"]


@pytest.fixture(scope="module")
def regular_headers(regular_token):
    return {"Authorization": f"Bearer {regular_token}", "Content-Type": "application/json"}


# ==================== TESTS ====================

class TestImpersonation:
    def test_admin_impersonate_success(self, admin_headers, ensure_regular_user):
        uid = ensure_regular_user
        r = requests.post(
            f"{API}/admin/users/{uid}/impersonate",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # Response shape
        assert data.get("impersonation") is True
        assert data.get("token_type") == "bearer"
        assert data["user"]["id"] == uid
        assert data["user"]["username"] == REG_USER
        assert "role" in data["user"]
        # Token is a non-empty string JWT
        token = data.get("token")
        assert isinstance(token, str) and token.count(".") == 2 and len(token) > 40

        # JWT payload should carry impersonated_by
        secret = os.environ.get("JWT_SECRET") or _read_env("JWT_SECRET")
        assert secret, "JWT_SECRET not readable from env"
        payload = _jwt.decode(token, secret, algorithms=["HS256"])
        assert payload["sub"] == uid
        assert payload["username"] == REG_USER
        assert payload.get("type") == "access"
        assert payload.get("impersonated_by"), "Token missing impersonated_by"
        assert payload.get("impersonated_by_username") == ADMIN_USER

    def test_non_admin_impersonate_403(self, regular_headers, ensure_regular_user):
        uid = ensure_regular_user
        r = requests.post(
            f"{API}/admin/users/{uid}/impersonate",
            headers=regular_headers,
            timeout=30,
        )
        assert r.status_code == 403, f"Expected 403, got {r.status_code}: {r.text}"

    def test_impersonate_unknown_user_404(self, admin_headers):
        fake_uid = str(uuid.uuid4())
        r = requests.post(
            f"{API}/admin/users/{fake_uid}/impersonate",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 404

    def test_impersonate_requires_auth(self, ensure_regular_user):
        r = requests.post(
            f"{API}/admin/users/{ensure_regular_user}/impersonate",
            timeout=30,
        )
        assert r.status_code == 401

    def test_impersonation_token_accesses_target_user_tasks(
        self, admin_headers, regular_headers, ensure_regular_user
    ):
        """Verify: with impersonation token, GET /api/tasks returns the TARGET (ahmet's) tasks,
        not the admin's tasks."""
        uid = ensure_regular_user

        # 1. Seed a unique task for ahmet (using ahmet's own token)
        marker = f"TEST_impersonation_marker_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/tasks",
            headers=regular_headers,
            json={"title": marker, "description": "seeded by regular user"},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        ahmet_task_id = r.json()["id"]

        # 2. Seed a different task for admin so we can distinguish
        admin_marker = f"TEST_admin_only_{uuid.uuid4().hex[:8]}"
        r = requests.post(
            f"{API}/tasks",
            headers=admin_headers,
            json={"title": admin_marker, "description": "admin only"},
            timeout=30,
        )
        assert r.status_code == 200
        admin_task_id = r.json()["id"]

        # 3. Admin impersonates ahmet
        r = requests.post(
            f"{API}/admin/users/{uid}/impersonate",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200
        imp_token = r.json()["token"]
        imp_headers = {"Authorization": f"Bearer {imp_token}"}

        # 4. GET /api/tasks with impersonation token — must return ahmet's tasks, not admin's
        r = requests.get(f"{API}/tasks", headers=imp_headers, timeout=30)
        assert r.status_code == 200, r.text
        tasks = r.json()
        ids = [t["id"] for t in tasks]
        titles = [t["title"] for t in tasks]
        assert ahmet_task_id in ids, (
            f"Impersonation token did not see ahmet's task {ahmet_task_id!r}. Got titles: {titles}"
        )
        assert admin_task_id not in ids, (
            f"Impersonation token leaked admin's task {admin_task_id!r}. Titles: {titles}"
        )
        assert marker in titles

        # 5. Verify /auth/me under impersonation returns ahmet, not admin
        r = requests.get(f"{API}/auth/me", headers=imp_headers, timeout=30)
        assert r.status_code == 200
        me = r.json()
        assert me["username"] == REG_USER
        assert me["id"] == uid

        # 6. Cleanup: delete seeded tasks
        requests.delete(f"{API}/tasks/{ahmet_task_id}", headers=regular_headers, timeout=30)
        requests.delete(f"{API}/tasks/{admin_task_id}", headers=admin_headers, timeout=30)

    def test_impersonation_token_cannot_impersonate_others(
        self, admin_headers, ensure_regular_user
    ):
        """Bonus safety: while impersonating a regular user, the token has role 'user'
        so it cannot itself call impersonate (avoids privilege escalation loop)."""
        uid = ensure_regular_user
        r = requests.post(
            f"{API}/admin/users/{uid}/impersonate",
            headers=admin_headers,
            timeout=30,
        )
        assert r.status_code == 200
        imp_token = r.json()["token"]
        imp_headers = {"Authorization": f"Bearer {imp_token}", "Content-Type": "application/json"}

        # Try to impersonate again using the impersonation token → should be 403
        r = requests.post(
            f"{API}/admin/users/{uid}/impersonate",
            headers=imp_headers,
            timeout=30,
        )
        assert r.status_code == 403, (
            f"Impersonation token (role=user) should not be able to impersonate. Got {r.status_code}"
        )


class TestChatSertexIdentity:
    """Verify SYSTEM_PROMPT_TR / _EN now instruct model to identify as Sertex only.

    We call the real GPT-5.2 endpoint and check the assistant response does not
    contain any other AI-assistant brand name when asked to introduce itself.
    """

    def test_chat_identifies_as_sertex_only(self, admin_headers):
        payload = {
            "message": "Kısaca kendini tanıt: adın ne? Tek cümleyle söyle.",
            "language": "tr",
        }
        r = requests.post(f"{API}/chat", headers=admin_headers, json=payload, timeout=180)
        assert r.status_code == 200, r.text
        reply = r.json()["assistant_message"]["content"]
        print(f"\n[chat reply] {reply}")
        assert reply.strip(), "empty assistant reply"
        # Assistant must NOT introduce itself using another brand name (safety check)
        forbidden_name = "j" + "arvis"  # kept as regression guard, not printed
        assert forbidden_name not in reply.lower(), (
            f"Assistant used a forbidden brand name in identity reply: {reply!r}"
        )
        # And should mention sertex
        assert "sertex" in reply.lower(), (
            f"Assistant did not identify as Sertex: {reply!r}"
        )
