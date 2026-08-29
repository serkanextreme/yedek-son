"""
Sertex — Tasks feature backend tests.

Covers:
- GET /api/tasks — returns list
- POST /api/tasks — creates task with default status='pending'
- PATCH /api/tasks/{id} — updates status (pending/done/paused)
- PATCH /api/tasks/{id} — invalid status returns 400
- DELETE /api/tasks/{id} — deletes
- All /api/tasks* endpoints require Bearer auth (401 without)
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

DEFAULT_USER = os.environ.get("INITIAL_USERNAME", "serkan")
DEFAULT_PASS = os.environ.get("INITIAL_PASSWORD", "19071987")


# ---------------- Fixtures ----------------
@pytest.fixture(scope="module")
def anon():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def token(anon):
    r = anon.post(
        f"{API}/auth/login",
        json={"username": DEFAULT_USER, "password": DEFAULT_PASS},
        timeout=30,
    )
    assert r.status_code == 200, f"Login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def auth(token):
    s = requests.Session()
    s.headers.update({
        "Content-Type": "application/json",
        "Authorization": f"Bearer {token}",
    })
    return s


@pytest.fixture
def created_task(auth):
    """Create a task for tests that need it; clean up after."""
    title = f"TEST_{uuid.uuid4().hex[:8]}"
    r = auth.post(f"{API}/tasks", json={"title": title, "description": "smoke", "due_date": None})
    assert r.status_code == 200, r.text
    task = r.json()
    yield task
    auth.delete(f"{API}/tasks/{task['id']}")


# ---------------- AUTH GUARDS ----------------
class TestTasksAuth:
    """All /api/tasks* endpoints require Bearer token."""

    def test_list_requires_auth(self, anon):
        r = anon.get(f"{API}/tasks")
        assert r.status_code == 401, r.text

    def test_create_requires_auth(self, anon):
        r = anon.post(f"{API}/tasks", json={"title": "nope"})
        assert r.status_code == 401

    def test_patch_requires_auth(self, anon):
        r = anon.patch(f"{API}/tasks/doesnotexist", json={"status": "done"})
        assert r.status_code == 401

    def test_delete_requires_auth(self, anon):
        r = anon.delete(f"{API}/tasks/doesnotexist")
        assert r.status_code == 401


# ---------------- BASIC LIST ----------------
class TestTasksList:
    def test_list_returns_array(self, auth):
        r = auth.get(f"{API}/tasks")
        assert r.status_code == 200
        assert isinstance(r.json(), list)


# ---------------- CREATE ----------------
class TestTasksCreate:
    def test_create_minimal(self, auth):
        title = f"TEST_{uuid.uuid4().hex[:8]}"
        r = auth.post(f"{API}/tasks", json={"title": title})
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["title"] == title
        assert t["description"] == ""
        assert t["status"] == "pending"
        assert t["due_date"] is None
        assert isinstance(t["id"], str) and len(t["id"]) > 10
        assert "created_at" in t and "updated_at" in t

        # Verify persistence via GET list
        r2 = auth.get(f"{API}/tasks")
        assert r2.status_code == 200
        assert any(x["id"] == t["id"] for x in r2.json())

        # Cleanup
        auth.delete(f"{API}/tasks/{t['id']}")

    def test_create_with_all_fields(self, auth):
        title = f"TEST_{uuid.uuid4().hex[:8]}"
        due = (datetime.now(timezone.utc) + timedelta(days=1)).isoformat()
        r = auth.post(
            f"{API}/tasks",
            json={"title": title, "description": "detail", "due_date": due},
        )
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["title"] == title
        assert t["description"] == "detail"
        assert t["due_date"] == due
        assert t["status"] == "pending"
        auth.delete(f"{API}/tasks/{t['id']}")


# ---------------- UPDATE (status) ----------------
class TestTasksPatchStatus:
    def test_set_status_done(self, auth, created_task):
        r = auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "done"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "done"
        # Verify persistence
        lst = auth.get(f"{API}/tasks").json()
        got = next(x for x in lst if x["id"] == created_task["id"])
        assert got["status"] == "done"

    def test_set_status_paused(self, auth, created_task):
        r = auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "paused"})
        assert r.status_code == 200
        assert r.json()["status"] == "paused"

    def test_set_status_pending(self, auth, created_task):
        # First set to done, then back to pending
        auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "done"})
        r = auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "pending"})
        assert r.status_code == 200
        assert r.json()["status"] == "pending"

    def test_invalid_status_returns_400(self, auth, created_task):
        r = auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "bogus"})
        assert r.status_code == 400, r.text
        # ensure the underlying status did not change
        lst = auth.get(f"{API}/tasks").json()
        got = next(x for x in lst if x["id"] == created_task["id"])
        assert got["status"] == "pending"

    def test_patch_unknown_id_returns_404(self, auth):
        r = auth.patch(f"{API}/tasks/{uuid.uuid4()}", json={"status": "done"})
        assert r.status_code == 404

    def test_updated_at_changes(self, auth, created_task):
        original_updated = created_task["updated_at"]
        # small sleep-ish: rely on iso microsecond precision; still assert not equal after PATCH
        r = auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "done"})
        assert r.status_code == 200
        assert r.json()["updated_at"] != original_updated


# ---------------- DELETE ----------------
class TestTasksDelete:
    def test_delete_task(self, auth):
        title = f"TEST_DEL_{uuid.uuid4().hex[:8]}"
        c = auth.post(f"{API}/tasks", json={"title": title}).json()
        r = auth.delete(f"{API}/tasks/{c['id']}")
        assert r.status_code == 200
        assert r.json().get("deleted") == 1
        # Verify no longer in list
        lst = auth.get(f"{API}/tasks").json()
        assert not any(x["id"] == c["id"] for x in lst)

    def test_delete_unknown_ok(self, auth):
        # Backend currently returns {"deleted": 0} rather than 404 — record behavior
        r = auth.delete(f"{API}/tasks/{uuid.uuid4()}")
        assert r.status_code == 200
        assert r.json().get("deleted") == 0


# ---------------- OVERDUE (frontend-computed but server accepts past dates) ----------------
class TestTasksOverdueSupport:
    def test_create_task_with_past_due_date(self, auth):
        title = f"TEST_OVERDUE_{uuid.uuid4().hex[:8]}"
        past = "2020-01-01T00:00:00+00:00"
        r = auth.post(f"{API}/tasks", json={"title": title, "due_date": past})
        assert r.status_code == 200
        t = r.json()
        assert t["due_date"] == past
        assert t["status"] == "pending"  # backend does not auto-flip to overdue
        auth.delete(f"{API}/tasks/{t['id']}")


# ---------------- NEW: 'overdue' status value ----------------
class TestTasksOverdueStatus:
    def test_set_status_overdue(self, auth, created_task):
        r = auth.patch(f"{API}/tasks/{created_task['id']}", json={"status": "overdue"})
        assert r.status_code == 200, r.text
        assert r.json()["status"] == "overdue"
        # Verify persistence
        lst = auth.get(f"{API}/tasks").json()
        got = next(x for x in lst if x["id"] == created_task["id"])
        assert got["status"] == "overdue"


# ---------------- NEW: reminder_at + reminder_fired ----------------
class TestTasksReminder:
    def test_create_task_includes_reminder_fields(self, auth):
        title = f"TEST_REM_{uuid.uuid4().hex[:8]}"
        r = auth.post(f"{API}/tasks", json={"title": title})
        assert r.status_code == 200
        t = r.json()
        # Reminder defaults
        assert t.get("reminder_at") is None
        assert t.get("reminder_fired") is False
        auth.delete(f"{API}/tasks/{t['id']}")

    def test_create_with_reminder_at(self, auth):
        title = f"TEST_REM_{uuid.uuid4().hex[:8]}"
        future = "2030-01-01T10:00:00+00:00"
        r = auth.post(f"{API}/tasks", json={"title": title, "reminder_at": future})
        assert r.status_code == 200
        t = r.json()
        assert t["reminder_at"] == future
        assert t["reminder_fired"] is False
        auth.delete(f"{API}/tasks/{t['id']}")

    def test_patch_sets_reminder_and_resets_fired(self, auth, created_task):
        tid = created_task["id"]
        # First mark as fired
        r0 = auth.patch(f"{API}/tasks/{tid}", json={"reminder_fired": True})
        assert r0.status_code == 200
        assert r0.json()["reminder_fired"] is True

        # Now set a new reminder_at (without explicitly passing reminder_fired)
        future = "2030-06-01T09:00:00+00:00"
        r = auth.patch(f"{API}/tasks/{tid}", json={"reminder_at": future})
        assert r.status_code == 200
        body = r.json()
        assert body["reminder_at"] == future
        # Backend must auto-reset reminder_fired to False
        assert body["reminder_fired"] is False

    def test_patch_clears_reminder_with_null(self, auth, created_task):
        tid = created_task["id"]
        # Set a reminder
        future = "2030-06-01T09:00:00+00:00"
        auth.patch(f"{API}/tasks/{tid}", json={"reminder_at": future})
        # Clear it
        r = auth.patch(f"{API}/tasks/{tid}", json={"reminder_at": None})
        assert r.status_code == 200
        body = r.json()
        assert body["reminder_at"] is None
        assert body["reminder_fired"] is False

    def test_patch_reminder_fired_true(self, auth, created_task):
        tid = created_task["id"]
        # Set reminder first
        future = "2030-06-01T09:00:00+00:00"
        auth.patch(f"{API}/tasks/{tid}", json={"reminder_at": future})
        # Mark as fired
        r = auth.patch(f"{API}/tasks/{tid}", json={"reminder_fired": True})
        assert r.status_code == 200
        body = r.json()
        assert body["reminder_fired"] is True
        # reminder_at should remain set
        assert body["reminder_at"] == future

        # Verify persistence
        lst = auth.get(f"{API}/tasks").json()
        got = next(x for x in lst if x["id"] == tid)
        assert got["reminder_fired"] is True
        assert got["reminder_at"] == future
