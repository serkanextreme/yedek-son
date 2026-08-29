"""
Sertex multi-user regression tests (iteration 11).

Covers:
- Chat regression (new chat with no conversation_id → 200 with conversation_id)
- /auth/me returns role
- Admin endpoints: 403 for non-admin, 200 for admin
- Admin CRUD users (create/duplicate/short-pw/patch role/patch password/delete)
- Last-admin protection (demote/delete)
- Self-delete protection
- Data isolation across users for tasks, notes, conversations
- Delete-user cascades tasks/notes/conversations/messages
- Old /api/reminders endpoints removed (404)
"""
import os
import uuid
import time
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_USER = os.environ.get("INITIAL_USERNAME", "serkan")
ADMIN_PASS = os.environ.get("INITIAL_PASSWORD", "19071987")


# ---------------- Helpers ----------------
def _login(username: str, password: str, expect: int = 200):
    r = requests.post(
        f"{API}/auth/login",
        json={"username": username, "password": password},
        timeout=30,
    )
    assert r.status_code == expect, f"Login {username}: expected {expect}, got {r.status_code} — {r.text}"
    if r.status_code == 200:
        return r.json()["token"]
    return None


def _sess(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


def _cleanup_test_users(admin_sess: requests.Session):
    """Delete any users whose username matches test prefixes."""
    r = admin_sess.get(f"{API}/admin/users", timeout=30)
    if r.status_code != 200:
        return
    for u in r.json():
        uname = u.get("username", "")
        if uname.startswith("TEST_") or uname.startswith("ahmet_") or uname == "ahmet":
            admin_sess.delete(f"{API}/admin/users/{u['id']}", timeout=30)


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_USER, ADMIN_PASS)


@pytest.fixture(scope="module")
def admin_sess(admin_token):
    s = _sess(admin_token)
    # NOTE: no module-level cleanup — each fixture cleans up its own uuid-scoped user.
    # A cross-worker cleanup would race and delete users in-use by other xdist workers.
    return s


@pytest.fixture(scope="module")
def admin_id(admin_sess):
    r = admin_sess.get(f"{API}/auth/me", timeout=30)
    assert r.status_code == 200
    return r.json()["id"]


@pytest.fixture
def ahmet_user(admin_sess):
    """Create a fresh unique test user (username 'ahmet_xxxx') to avoid xdist race conditions."""
    uname = f"ahmet_{uuid.uuid4().hex[:8]}"
    r = admin_sess.post(f"{API}/admin/users", json={
        "username": uname,
        "password": "ahmet123",
        "role": "user",
    }, timeout=30)
    assert r.status_code == 200, r.text
    user = r.json()
    user["_password"] = "ahmet123"
    yield user
    # Cleanup: only if still exists
    admin_sess.delete(f"{API}/admin/users/{user['id']}", timeout=30)


@pytest.fixture
def ahmet_sess(ahmet_user):
    tok = _login(ahmet_user["username"], ahmet_user["_password"])
    return _sess(tok)


# ============================================================
# 1) CHAT REGRESSION — new conversation NameError bug fixed
# ============================================================
class TestChatRegression:
    def test_new_chat_without_conversation_id(self, admin_sess):
        """POST /api/chat with NO conversation_id must return 200 with all fields."""
        payload = {"message": "Merhaba Sertex, kısa yanıt ver.", "language": "tr"}
        r = admin_sess.post(f"{API}/chat", json=payload, timeout=180)
        assert r.status_code == 200, f"Chat new-conv failed: {r.status_code} — {r.text}"
        data = r.json()
        assert "conversation_id" in data and data["conversation_id"]
        assert "user_message" in data and data["user_message"]["role"] == "user"
        assert "assistant_message" in data and data["assistant_message"]["role"] == "assistant"
        content = data["assistant_message"]["content"]
        assert isinstance(content, str) and len(content.strip()) > 0
        print(f"\nAssistant reply: {content[:200]}")
        # Cleanup: delete the conversation
        admin_sess.delete(f"{API}/conversations/{data['conversation_id']}", timeout=30)


# ============================================================
# 2) /auth/me returns role
# ============================================================
class TestAuthMe:
    def test_me_returns_role_admin(self, admin_sess):
        r = admin_sess.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == ADMIN_USER
        assert data["role"] == "admin"
        assert "id" in data

    def test_me_returns_role_user_for_ahmet(self, ahmet_user, ahmet_sess):
        r = ahmet_sess.get(f"{API}/auth/me", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["username"] == ahmet_user["username"]
        # Faz 8: legacy role 'user' is normalized to 'employee' server-side.
        assert data["role"] == "employee"


# ============================================================
# 3) Admin endpoints require admin
# ============================================================
class TestAdminAuthorization:
    def test_admin_list_users_forbidden_for_non_admin(self, ahmet_sess):
        r = ahmet_sess.get(f"{API}/admin/users", timeout=30)
        assert r.status_code == 403, f"Expected 403 for non-admin, got {r.status_code}"

    def test_admin_list_users_ok_for_admin(self, admin_sess):
        r = admin_sess.get(f"{API}/admin/users", timeout=30)
        assert r.status_code == 200
        users = r.json()
        assert isinstance(users, list)
        # Admin (serkan) should be present
        assert any(u["username"] == ADMIN_USER and u.get("role") == "admin" for u in users)
        # Ensure password_hash never leaks
        for u in users:
            assert "password_hash" not in u
            assert "_id" not in u

    def test_admin_create_user_forbidden_for_non_admin(self, ahmet_sess):
        r = ahmet_sess.post(f"{API}/admin/users", json={
            "username": "TEST_forbidden",
            "password": "pw12345",
            "role": "user",
        }, timeout=30)
        assert r.status_code == 403

    def test_admin_delete_user_forbidden_for_non_admin(self, ahmet_sess, admin_id):
        r = ahmet_sess.delete(f"{API}/admin/users/{admin_id}", timeout=30)
        assert r.status_code == 403


# ============================================================
# 4) Admin create user — validation
# ============================================================
class TestAdminCreateUser:
    def test_create_ahmet_and_login(self, admin_sess):
        uname = f"ahmet_{uuid.uuid4().hex[:8]}"
        r = admin_sess.post(f"{API}/admin/users", json={
            "username": uname,
            "password": "ahmet123",
            "role": "user",
        }, timeout=30)
        assert r.status_code == 200, r.text
        u = r.json()
        assert u["username"] == uname
        # Faz 8: 'user' is normalized to 'employee' on create.
        assert u["role"] == "employee"
        assert "id" in u
        assert "password_hash" not in u

        # Login as this new user works
        tok = _login(uname, "ahmet123")
        assert tok

        # Cleanup
        admin_sess.delete(f"{API}/admin/users/{u['id']}", timeout=30)

    def test_create_duplicate_username_400(self, admin_sess, ahmet_user):
        r = admin_sess.post(f"{API}/admin/users", json={
            "username": ahmet_user["username"],
            "password": "pw12345",
            "role": "user",
        }, timeout=30)
        assert r.status_code == 400

    def test_create_short_password_400(self, admin_sess):
        r = admin_sess.post(f"{API}/admin/users", json={
            "username": "TEST_shortpw",
            "password": "abc",  # < 6
            "role": "user",
        }, timeout=30)
        assert r.status_code == 400

    def test_create_short_username_400(self, admin_sess):
        r = admin_sess.post(f"{API}/admin/users", json={
            "username": "ab",  # < 3
            "password": "pw12345",
            "role": "user",
        }, timeout=30)
        assert r.status_code == 400

    def test_create_invalid_role_400(self, admin_sess):
        r = admin_sess.post(f"{API}/admin/users", json={
            "username": "TEST_badrole",
            "password": "pw12345",
            "role": "superadmin",
        }, timeout=30)
        assert r.status_code == 400


# ============================================================
# 5) Admin patch user — password reset & role protection
# ============================================================
class TestAdminPatchUser:
    def test_password_reset_flow(self, admin_sess, ahmet_user):
        # Reset ahmet password
        new_pw = "newpw999"
        r = admin_sess.patch(f"{API}/admin/users/{ahmet_user['id']}", json={
            "new_password": new_pw,
        }, timeout=30)
        assert r.status_code == 200, r.text

        # Old pw fails
        r_old = requests.post(f"{API}/auth/login", json={
            "username": ahmet_user["username"], "password": "ahmet123"
        }, timeout=30)
        assert r_old.status_code == 401, f"Old pw should fail, got {r_old.status_code}"

        # New pw works
        r_new = requests.post(f"{API}/auth/login", json={
            "username": ahmet_user["username"], "password": new_pw
        }, timeout=30)
        assert r_new.status_code == 200

    def test_short_password_reset_400(self, admin_sess, ahmet_user):
        r = admin_sess.patch(f"{API}/admin/users/{ahmet_user['id']}", json={
            "new_password": "abc",
        }, timeout=30)
        assert r.status_code == 400

    def test_promote_and_demote_role(self, admin_sess, ahmet_user):
        # Promote ahmet → admin
        r = admin_sess.patch(f"{API}/admin/users/{ahmet_user['id']}", json={
            "role": "admin",
        }, timeout=30)
        assert r.status_code == 200
        assert r.json()["role"] == "admin"

        # Now there are 2 admins — demoting ahmet back should work
        r = admin_sess.patch(f"{API}/admin/users/{ahmet_user['id']}", json={
            "role": "user",
        }, timeout=30)
        assert r.status_code == 200
        # Faz 8: 'user' is normalized to 'employee'.
        assert r.json()["role"] == "employee"

    def test_cannot_demote_last_admin(self, admin_sess, admin_id):
        """When there's only 1 admin, demoting serkan to user must fail with 400."""
        # Ensure only 1 admin exists (cleanup any other admins created by tests)
        r = admin_sess.get(f"{API}/admin/users", timeout=30)
        for u in r.json():
            if u["role"] == "admin" and u["id"] != admin_id:
                admin_sess.patch(f"{API}/admin/users/{u['id']}", json={"role": "user"}, timeout=30)

        r = admin_sess.patch(f"{API}/admin/users/{admin_id}", json={
            "role": "user",
        }, timeout=30)
        assert r.status_code == 400, f"Expected 400 (last admin), got {r.status_code} — {r.text}"

    def test_patch_nonexistent_user_404(self, admin_sess):
        r = admin_sess.patch(f"{API}/admin/users/nonexistent-id", json={
            "role": "user",
        }, timeout=30)
        assert r.status_code == 404


# ============================================================
# 6) Admin delete user — self/last-admin protection & cascade
# ============================================================
class TestAdminDeleteUser:
    def test_cannot_delete_self(self, admin_sess, admin_id):
        r = admin_sess.delete(f"{API}/admin/users/{admin_id}", timeout=30)
        assert r.status_code == 400

    def test_cannot_delete_last_admin(self, admin_sess, admin_id):
        # Ensure only 1 admin
        r = admin_sess.get(f"{API}/admin/users", timeout=30)
        for u in r.json():
            if u["role"] == "admin" and u["id"] != admin_id:
                admin_sess.patch(f"{API}/admin/users/{u['id']}", json={"role": "user"}, timeout=30)
        # Try delete admin (also blocked by self-protection first, but conceptually "last admin")
        # → self-delete rule triggers first with 400
        r = admin_sess.delete(f"{API}/admin/users/{admin_id}", timeout=30)
        assert r.status_code == 400

    def test_delete_user_cascades(self, admin_sess, admin_id):
        """Create ahmet, have ahmet create task/note/conversation, then delete ahmet.
        Verify all their data is removed."""
        uname = f"ahmet_{uuid.uuid4().hex[:8]}"

        # Create user
        r = admin_sess.post(f"{API}/admin/users", json={
            "username": uname, "password": "ahmet123", "role": "user",
        }, timeout=30)
        assert r.status_code == 200
        ahmet = r.json()
        ahmet_id = ahmet["id"]

        # Login as ahmet
        tok = _login(uname, "ahmet123")
        sess = _sess(tok)

        # Create task, note, conversation
        r_task = sess.post(f"{API}/tasks", json={"title": "TEST_cascade_task"}, timeout=30)
        assert r_task.status_code == 200
        task_id = r_task.json()["id"]

        r_note = sess.post(f"{API}/notes", json={"content": "TEST_cascade_note"}, timeout=30)
        assert r_note.status_code == 200

        r_chat = sess.post(f"{API}/chat", json={"message": "kısa selam", "language": "tr"}, timeout=180)
        assert r_chat.status_code == 200
        conv_id = r_chat.json()["conversation_id"]

        # Direct DB access for verification via mongo
        from pymongo import MongoClient
        mongo_url = os.environ.get("MONGO_URL") or _read_env("MONGO_URL")
        db_name = os.environ.get("DB_NAME") or _read_env("DB_NAME")
        mc = MongoClient(mongo_url)
        db = mc[db_name]

        assert db.tasks.count_documents({"user_id": ahmet_id}) >= 1
        assert db.notes.count_documents({"user_id": ahmet_id}) >= 1
        assert db.conversations.count_documents({"user_id": ahmet_id}) >= 1
        assert db.messages.count_documents({"conversation_id": conv_id}) >= 2

        # Delete ahmet
        r_del = admin_sess.delete(f"{API}/admin/users/{ahmet_id}", timeout=30)
        assert r_del.status_code == 200
        assert r_del.json().get("deleted") is True

        # Verify cascade
        assert db.users.count_documents({"id": ahmet_id}) == 0
        assert db.tasks.count_documents({"user_id": ahmet_id}) == 0
        assert db.notes.count_documents({"user_id": ahmet_id}) == 0
        assert db.conversations.count_documents({"user_id": ahmet_id}) == 0
        assert db.messages.count_documents({"conversation_id": conv_id}) == 0

        # Login as ahmet should fail
        r_login = requests.post(f"{API}/auth/login", json={
            "username": uname, "password": "ahmet123"
        }, timeout=30)
        assert r_login.status_code == 401
        mc.close()


# ============================================================
# 7) Data isolation — tasks / notes / conversations
# ============================================================
class TestDataIsolation:
    def test_task_isolation(self, admin_sess, ahmet_sess):
        # Serkan creates task A
        r_a = admin_sess.post(f"{API}/tasks", json={"title": "TEST_iso_serkan_A"}, timeout=30)
        assert r_a.status_code == 200
        task_a = r_a.json()["id"]

        # Ahmet creates task B
        r_b = ahmet_sess.post(f"{API}/tasks", json={"title": "TEST_iso_ahmet_B"}, timeout=30)
        assert r_b.status_code == 200
        task_b = r_b.json()["id"]

        # Serkan sees A but not B
        serkan_tasks = admin_sess.get(f"{API}/tasks", timeout=30).json()
        serkan_ids = {t["id"] for t in serkan_tasks}
        assert task_a in serkan_ids
        assert task_b not in serkan_ids, "Serkan sees Ahmet's task (isolation broken)"

        # Ahmet sees B but not A
        ahmet_tasks = ahmet_sess.get(f"{API}/tasks", timeout=30).json()
        ahmet_ids = {t["id"] for t in ahmet_tasks}
        assert task_b in ahmet_ids
        assert task_a not in ahmet_ids, "Ahmet sees Serkan's task (isolation broken)"

        # Cross-user PATCH → 404
        r_cross = ahmet_sess.patch(f"{API}/tasks/{task_a}", json={"status": "done"}, timeout=30)
        assert r_cross.status_code == 404

        # Cross-user DELETE → deleted=0
        r_cross_del = ahmet_sess.delete(f"{API}/tasks/{task_a}", timeout=30)
        # delete_one returns {"deleted": 0}
        assert r_cross_del.status_code == 200
        assert r_cross_del.json().get("deleted") == 0

        # Task A still exists for serkan
        serkan_tasks = admin_sess.get(f"{API}/tasks", timeout=30).json()
        assert task_a in {t["id"] for t in serkan_tasks}

        # Cleanup
        admin_sess.delete(f"{API}/tasks/{task_a}", timeout=30)
        ahmet_sess.delete(f"{API}/tasks/{task_b}", timeout=30)

    def test_note_isolation(self, admin_sess, ahmet_sess):
        # Serkan creates note A
        r_a = admin_sess.post(f"{API}/notes", json={"content": "TEST_iso_serkan_note"}, timeout=30)
        assert r_a.status_code == 200
        note_a = r_a.json()["id"]

        # Ahmet creates note B
        r_b = ahmet_sess.post(f"{API}/notes", json={"content": "TEST_iso_ahmet_note"}, timeout=30)
        assert r_b.status_code == 200
        note_b = r_b.json()["id"]

        # Serkan doesn't see B
        s_notes = admin_sess.get(f"{API}/notes", timeout=30).json()
        s_ids = {n["id"] for n in s_notes}
        assert note_a in s_ids
        assert note_b not in s_ids

        # Ahmet doesn't see A
        a_notes = ahmet_sess.get(f"{API}/notes", timeout=30).json()
        a_ids = {n["id"] for n in a_notes}
        assert note_b in a_ids
        assert note_a not in a_ids

        # Cross-user delete → deleted=0
        r_cross = ahmet_sess.delete(f"{API}/notes/{note_a}", timeout=30)
        assert r_cross.status_code == 200
        assert r_cross.json().get("deleted") == 0

        # Note A still present
        s_notes = admin_sess.get(f"{API}/notes", timeout=30).json()
        assert note_a in {n["id"] for n in s_notes}

        # Cleanup
        admin_sess.delete(f"{API}/notes/{note_a}", timeout=30)
        ahmet_sess.delete(f"{API}/notes/{note_b}", timeout=30)

    def test_conversation_isolation(self, admin_sess, ahmet_sess):
        # Serkan chat → creates conv
        r_a = admin_sess.post(f"{API}/chat", json={"message": "serkan mesajı", "language": "tr"}, timeout=180)
        assert r_a.status_code == 200
        conv_a = r_a.json()["conversation_id"]

        # Ahmet lists convs — should NOT include serkan's
        r_list = ahmet_sess.get(f"{API}/conversations", timeout=30)
        assert r_list.status_code == 200
        ahmet_conv_ids = {c["id"] for c in r_list.json()}
        assert conv_a not in ahmet_conv_ids

        # Ahmet tries to fetch messages of serkan's conv → 404
        r_msg = ahmet_sess.get(f"{API}/conversations/{conv_a}/messages", timeout=30)
        assert r_msg.status_code == 404

        # Ahmet tries to POST chat with serkan's conv_id → 404
        r_chat_cross = ahmet_sess.post(f"{API}/chat", json={
            "message": "hijack", "conversation_id": conv_a, "language": "tr",
        }, timeout=60)
        assert r_chat_cross.status_code == 404

        # Ahmet deletes serkan's conv → deleted=0
        r_del = ahmet_sess.delete(f"{API}/conversations/{conv_a}", timeout=30)
        assert r_del.status_code == 200
        assert r_del.json().get("deleted") == 0

        # Serkan's conv still exists
        serkan_convs = admin_sess.get(f"{API}/conversations", timeout=30).json()
        assert conv_a in {c["id"] for c in serkan_convs}

        # Cleanup
        admin_sess.delete(f"{API}/conversations/{conv_a}", timeout=30)


# ============================================================
# 8) Old /api/reminders endpoints removed
# ============================================================
class TestRemindersRemoved:
    def test_reminders_get_404(self, admin_sess):
        r = admin_sess.get(f"{API}/reminders", timeout=30)
        assert r.status_code == 404, f"GET /reminders should 404, got {r.status_code}"

    def test_reminders_post_404(self, admin_sess):
        r = admin_sess.post(f"{API}/reminders", json={
            "title": "x", "remind_at": "2030-01-01T00:00:00+00:00"
        }, timeout=30)
        assert r.status_code == 404

    def test_reminders_patch_404(self, admin_sess):
        r = admin_sess.patch(f"{API}/reminders/whatever", timeout=30)
        assert r.status_code == 404

    def test_reminders_delete_404(self, admin_sess):
        r = admin_sess.delete(f"{API}/reminders/whatever", timeout=30)
        assert r.status_code == 404


# ---------------- helpers ----------------
def _read_env(key: str) -> str:
    envfile = "/app/backend/.env"
    try:
        with open(envfile) as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    return line.split("=", 1)[1].strip().strip('"').strip("'")
    except Exception:
        pass
    return ""
