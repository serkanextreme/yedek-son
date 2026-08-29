"""
Sertex backend API tests — auth + protected endpoints.

Covers:
- Health (public)
- Auth: login success/wrong pass, brute force lockout, /auth/me, change-password, change-username
- Protection: all previously-open endpoints now require Bearer token
- Chat (GPT-5.2 via emergentintegrations) — real assistant reply asserted
- TTS — real MP3 bytes asserted
- Notes / Reminders CRUD with auth
- Weather mock with auth
"""
import os
import time
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests


def _read_env(key: str, default: str = "") -> str:
    """Read a variable from process env or fall back to backend/frontend .env files.

    Keeps pytest usable locally without needing to `export REACT_APP_BACKEND_URL`.
    """
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

DEFAULT_USER = _read_env("INITIAL_USERNAME", "sertex")
DEFAULT_PASS = _read_env("INITIAL_PASSWORD", "19071987")


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(anon):
    """Fresh valid token (also validates login flow)."""
    r = anon.post(
        f"{API}/auth/login",
        json={"username": DEFAULT_USER, "password": DEFAULT_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    data = r.json()
    assert "token" in data and isinstance(data["token"], str) and len(data["token"]) > 20
    assert data.get("token_type") == "bearer"
    assert data["user"]["username"] == DEFAULT_USER
    return data["token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


# ---------------- Health ----------------
class TestHealth:
    def test_root_public(self, anon):
        r = anon.get(f"{API}/", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data.get("status") == "online"


# ---------------- Auth ----------------
class TestAuth:
    def test_login_success_returns_jwt(self, anon):
        r = anon.post(
            f"{API}/auth/login",
            json={"username": DEFAULT_USER, "password": DEFAULT_PASS},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("token") and isinstance(data["token"], str)
        assert data.get("token_type") == "bearer"
        assert data["user"]["username"] == DEFAULT_USER
        # Verify JWT decodes to expected claims
        import jwt as _jwt
        secret = os.environ.get("JWT_SECRET") or _read_env("JWT_SECRET")
        payload = _jwt.decode(data["token"], secret, algorithms=["HS256"])
        assert payload.get("type") == "access"
        assert payload.get("username") == DEFAULT_USER
        assert payload.get("sub")
        assert payload.get("exp")

    def test_login_wrong_password(self, anon):
        # Use a random username to avoid tripping lockout on the real one
        r = anon.post(
            f"{API}/auth/login",
            json={"username": f"nouser_{uuid.uuid4().hex[:6]}", "password": "wrong"},
            timeout=30,
        )
        assert r.status_code == 401
        assert "Kullanıcı adı veya şifre hatalı" in r.json().get("detail", "")

    def test_brute_force_lockout_3rd_attempt(self, anon):
        """3 failed attempts within window → 3rd should return 429."""
        # Use a unique username so we don't touch the seeded user's real password
        # BUT lockout is keyed on ip:username, so it must be the SAME username all 3 times.
        # We use a random-but-consistent username that won't collide with prior tests.
        target_user = f"lockuser_{uuid.uuid4().hex[:8]}"

        # 1st attempt
        r1 = anon.post(f"{API}/auth/login", json={"username": target_user, "password": "x"}, timeout=30)
        assert r1.status_code == 401, r1.text

        # 2nd attempt
        r2 = anon.post(f"{API}/auth/login", json={"username": target_user, "password": "x"}, timeout=30)
        assert r2.status_code == 401, r2.text

        # 3rd attempt — should trigger lockout (429)
        r3 = anon.post(f"{API}/auth/login", json={"username": target_user, "password": "x"}, timeout=30)
        assert r3.status_code == 429, f"Expected 429 lockout on 3rd fail, got {r3.status_code}: {r3.text}"
        detail = r3.json().get("detail", "")
        assert "dakika" in detail or "kilit" in detail.lower()

        # 4th attempt with CORRECT-looking password — still locked because
        # identifier is username-only now, so lockout persists regardless of IP.
        # We use a random-but-nonexistent user so we never accidentally use the real
        # seed pw here; if user does not exist, the 429 must come from lockout,
        # not from bad-credentials 401.
        r4 = anon.post(f"{API}/auth/login", json={"username": target_user, "password": "anythingelse"}, timeout=30)
        assert r4.status_code == 429, f"Lockout should persist regardless of password, got {r4.status_code}: {r4.text}"

    def test_lockout_isolated_per_username(self, anon):
        """Different username should NOT be locked out when another username is locked."""
        u1 = f"lockA_{uuid.uuid4().hex[:6]}"
        u2 = f"lockB_{uuid.uuid4().hex[:6]}"
        # Lock user A
        for _ in range(3):
            anon.post(f"{API}/auth/login", json={"username": u1, "password": "x"}, timeout=30)
        # User B should still get 401 (not 429) on first failed attempt
        r = anon.post(f"{API}/auth/login", json={"username": u2, "password": "x"}, timeout=30)
        assert r.status_code == 401, f"Different user should not be locked, got {r.status_code}"

    def test_me_requires_token(self, anon):
        r = anon.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401

    def test_me_with_valid_token(self, auth):
        r = auth.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == DEFAULT_USER
        assert "id" in data

    def test_me_with_invalid_token(self, anon):
        s = requests.Session()
        s.headers.update({"Authorization": "Bearer this.is.notavalidjwt"})
        r = s.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 401


# ---------------- Protection Coverage ----------------
class TestProtection:
    """Every previously-open endpoint must now return 401 without a Bearer token
    AND 200 with a valid Bearer token."""

    PROTECTED_GETS = [
        "/conversations",
        "/notes",
        "/weather",
    ]

    def test_gets_401_without_token(self, anon):
        for path in self.PROTECTED_GETS:
            r = anon.get(f"{API}{path}", timeout=30)
            assert r.status_code == 401, f"{path} should require auth, got {r.status_code}"

    def test_gets_200_with_token(self, auth):
        for path in self.PROTECTED_GETS:
            r = auth.get(f"{API}{path}", timeout=30)
            assert r.status_code == 200, f"{path} with token should be 200, got {r.status_code} {r.text}"

    def test_chat_401_without_token(self, anon):
        r = anon.post(f"{API}/chat", json={"message": "hi", "language": "tr"}, timeout=30)
        assert r.status_code == 401

    def test_tts_401_without_token(self, anon):
        r = anon.post(f"{API}/tts", json={"text": "hi"}, timeout=30)
        assert r.status_code == 401

    def test_notes_post_401_without_token(self, anon):
        r = anon.post(f"{API}/notes", json={"content": "x"}, timeout=30)
        assert r.status_code == 401

    def test_reminders_post_401_without_token(self, anon):
        # /api/reminders was REMOVED (migrated to /api/tasks) — endpoint no longer exists → 404 expected
        r = anon.post(f"{API}/reminders", json={"title": "x", "remind_at": "2030-01-01T00:00:00+00:00"}, timeout=30)
        assert r.status_code == 404, f"Expected 404 (endpoint removed), got {r.status_code}"

    def test_conversation_messages_401_without_token(self, anon):
        # These two endpoints are in server.py without user dep — expected 401
        r = anon.get(f"{API}/conversations/does-not-exist/messages", timeout=30)
        assert r.status_code == 401, (
            f"GET /conversations/{{cid}}/messages should require auth but returned {r.status_code}"
        )

    def test_conversation_delete_401_without_token(self, anon):
        r = anon.delete(f"{API}/conversations/does-not-exist", timeout=30)
        assert r.status_code == 401, (
            f"DELETE /conversations/{{cid}} should require auth but returned {r.status_code}"
        )


# ---------------- Chat (real GPT-5.2) ----------------
class TestChat:
    conversation_id = None

    def test_chat_first_message_tr(self, auth):
        payload = {"message": "Merhaba Sertex, benim adım Tony. Kısa cevap ver.", "language": "tr"}
        r = auth.post(f"{API}/chat", json=payload, timeout=180)
        assert r.status_code == 200, r.text
        data = r.json()
        assert data.get("conversation_id")
        assert data["user_message"]["role"] == "user"
        assert data["assistant_message"]["role"] == "assistant"
        assistant_text = data["assistant_message"]["content"]
        assert isinstance(assistant_text, str) and len(assistant_text.strip()) > 0
        TestChat.conversation_id = data["conversation_id"]
        print(f"\nAssistant reply: {assistant_text}")

    def test_get_messages_with_auth(self, auth):
        assert TestChat.conversation_id
        r = auth.get(f"{API}/conversations/{TestChat.conversation_id}/messages", timeout=30)
        assert r.status_code == 200
        msgs = r.json()
        assert len(msgs) >= 2
        assert any(m["role"] == "user" for m in msgs)
        assert any(m["role"] == "assistant" for m in msgs)

    def test_delete_conversation_with_auth(self, auth):
        assert TestChat.conversation_id
        r = auth.delete(f"{API}/conversations/{TestChat.conversation_id}", timeout=30)
        assert r.status_code == 200
        assert r.json().get("deleted") == 1


# ---------------- TTS ----------------
class TestTTS:
    def test_tts_returns_mp3(self, auth):
        r = auth.post(
            f"{API}/tts",
            json={"text": "Merhaba efendim, test.", "voice": "onyx"},
            timeout=90,
        )
        assert r.status_code == 200, r.text
        assert r.headers.get("content-type", "").startswith("audio/mpeg")
        assert len(r.content) > 1000, f"Audio too small: {len(r.content)} bytes"
        head = r.content[:3]
        assert head == b"ID3" or r.content[0] == 0xFF, f"Not MP3-like bytes: {r.content[:8]}"


# ---------------- Notes ----------------
class TestNotes:
    def test_note_crud(self, auth):
        r = auth.post(f"{API}/notes", json={"content": "TEST_auth_note"}, timeout=30)
        assert r.status_code == 200
        nid = r.json()["id"]
        r = auth.get(f"{API}/notes", timeout=30)
        assert any(n["id"] == nid for n in r.json())
        r = auth.delete(f"{API}/notes/{nid}", timeout=30)
        assert r.status_code == 200


# ---------------- Reminders (REMOVED — migrated to /api/tasks) ----------------
@pytest.mark.skip(reason="/api/reminders endpoints removed by design; migrated to /api/tasks")
class TestReminders:
    def test_reminder_flow(self, auth):
        pass


# ---------------- Reminders removal verification ----------------
class TestRemindersRemoved:
    """Verify old /api/reminders endpoints return 404 (endpoint removed)."""

    def test_reminders_get_removed(self, auth):
        r = auth.get(f"{API}/reminders", timeout=30)
        assert r.status_code == 404, f"GET /reminders should be 404 (removed), got {r.status_code}"

    def test_reminders_post_removed(self, auth):
        future = (datetime.now(timezone.utc) + timedelta(hours=1)).isoformat()
        r = auth.post(f"{API}/reminders", json={"title": "x", "remind_at": future}, timeout=30)
        assert r.status_code == 404

    def test_reminders_patch_removed(self, auth):
        r = auth.patch(f"{API}/reminders/some-id", timeout=30)
        assert r.status_code == 404

    def test_reminders_delete_removed(self, auth):
        r = auth.delete(f"{API}/reminders/some-id", timeout=30)
        assert r.status_code == 404


# ---------------- Weather ----------------
class TestWeather:
    def test_weather_with_auth(self, auth):
        r = auth.get(f"{API}/weather", params={"city": "Istanbul"}, timeout=30)
        assert r.status_code == 200
        data = r.json()
        for k in ("city", "temperature_c", "condition", "humidity", "wind_kph"):
            assert k in data
        assert data["city"].lower() in ("istanbul", "i̇stanbul")


# ---------------- Change Password / Username ----------------
class TestAccountChanges:
    """Runs LAST because it flips the seeded password and restores it.

    Strategy: change password to a temp value → assert old fails, new works →
    change back to original. Then change username → assert old fails, new works →
    change back."""

    def test_change_password_full_cycle(self, anon):
        temp_pass = f"tmp_{uuid.uuid4().hex[:10]}"

        # 1. Fresh login to get token
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 200
        tok = r.json()["token"]
        h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

        # 2. Wrong current_password → 401
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": "wrong_current", "new_password": "abcdef"},
            headers=h,
            timeout=30,
        )
        assert r.status_code == 401

        # 3. Short new password → 400
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": DEFAULT_PASS, "new_password": "abc"},
            headers=h,
            timeout=30,
        )
        assert r.status_code == 400

        # 4. Valid change → 200
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": DEFAULT_PASS, "new_password": temp_pass},
            headers=h,
            timeout=30,
        )
        assert r.status_code == 200

        # 5. Old password no longer works
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 401, f"Old password should fail, got {r.status_code}"

        # 6. New password works
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": temp_pass}, timeout=30)
        assert r.status_code == 200
        tok2 = r.json()["token"]
        h2 = {"Authorization": f"Bearer {tok2}", "Content-Type": "application/json"}

        # 7. Restore original password
        r = requests.post(
            f"{API}/auth/change-password",
            json={"current_password": temp_pass, "new_password": DEFAULT_PASS},
            headers=h2,
            timeout=30,
        )
        assert r.status_code == 200

        # 8. Verify original restored
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 200

    def test_change_username_full_cycle(self, anon):
        temp_user = f"tmpuser_{uuid.uuid4().hex[:6]}"

        # Fresh login
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 200
        tok = r.json()["token"]
        h = {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}

        # Change username
        r = requests.post(
            f"{API}/auth/change-username",
            json={"current_password": DEFAULT_PASS, "new_username": temp_user},
            headers=h,
            timeout=30,
        )
        assert r.status_code == 200, r.text

        # Old username fails
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 401

        # New username works
        r = anon.post(f"{API}/auth/login", json={"username": temp_user, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 200
        tok2 = r.json()["token"]
        h2 = {"Authorization": f"Bearer {tok2}", "Content-Type": "application/json"}

        # Restore original username
        r = requests.post(
            f"{API}/auth/change-username",
            json={"current_password": DEFAULT_PASS, "new_username": DEFAULT_USER},
            headers=h2,
            timeout=30,
        )
        assert r.status_code == 200

        # Verify original restored
        r = anon.post(f"{API}/auth/login", json={"username": DEFAULT_USER, "password": DEFAULT_PASS}, timeout=30)
        assert r.status_code == 200


# ---------------- helpers ----------------
def _read_env(key: str) -> str:
    """Read a value from /app/backend/.env (fallback when os.environ misses)."""
    envfile = "/app/backend/.env"
    try:
        with open(envfile) as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    v = line.split("=", 1)[1].strip().strip('"').strip("'")
                    return v
    except Exception:
        pass
    return ""
