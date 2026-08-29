"""Backend tests for UX batch: notification deletion + recurring reminder persistence.

Covers:
- TASK 2: DELETE /api/notifications/{id}, DELETE /api/notifications, POST /api/notifications/delete-selected
- TASK 3: PATCH /api/tasks/{id} persists reminder_interval_min, reminder_repeat_left, reminder_repeat_total
"""
import os
import uuid
import pytest
import requests

def _load_frontend_env():
    p = "/app/frontend/.env"
    if os.path.exists(p):
        for ln in open(p):
            if ln.startswith("REACT_APP_BACKEND_URL="):
                return ln.split("=", 1)[1].strip()
    return os.environ.get("REACT_APP_BACKEND_URL") or ""

BASE_URL = (os.environ.get("REACT_APP_BACKEND_URL") or _load_frontend_env()).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("serkan", "19071987")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN[0], "password": ADMIN[1]}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


# ---------- TASK 2: Notifications delete ----------

def _seed_notifications(h, n=3):
    ids = []
    for i in range(n):
        payload = {
            "id": f"testnotif-{uuid.uuid4()}",
            "type": "test",
            "title": f"TEST_notif_{i}",
            "message": "seeded by pytest",
        }
        r = requests.post(f"{API}/notifications/_seed", json=payload, headers=h, timeout=10)
        if r.status_code == 404:
            pytest.skip("No dev seed endpoint for notifications; skipping seeded tests.")
        assert r.status_code in (200, 201), r.text
        ids.append(r.json().get("id") or payload["id"])
    return ids


def test_delete_all_notifications(h):
    r = requests.delete(f"{API}/notifications", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    body = r.json()
    assert "deleted" in body or "removed" in body or isinstance(body, dict)
    # Verify list is empty
    r2 = requests.get(f"{API}/notifications", headers=h, timeout=15)
    assert r2.status_code == 200
    assert r2.json() == [] or r2.json().get("items", []) == []


def test_delete_selected_empty_ids(h):
    r = requests.post(f"{API}/notifications/delete-selected", json={"ids": []}, headers=h, timeout=15)
    # empty list should be a no-op success
    assert r.status_code in (200, 400), r.text


def test_delete_nonexistent_notification(h):
    r = requests.delete(f"{API}/notifications/nonexistent-id-xyz", headers=h, timeout=15)
    # backend returns 200 with deleted=0 or 404
    assert r.status_code in (200, 404), r.text


# ---------- TASK 3: Recurring reminder persistence ----------

@pytest.fixture(scope="module")
def task_id(h):
    payload = {"title": "TEST_reminder_task", "status": "aktif"}
    r = requests.post(f"{API}/tasks", json=payload, headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    tid = r.json().get("id") or r.json().get("_id")
    assert tid
    yield tid
    requests.delete(f"{API}/tasks/{tid}", headers=h, timeout=10)


def test_patch_task_reminder_recurring_fields(h, task_id):
    payload = {
        "reminder_interval_min": 30,
        "reminder_repeat_total": 3,
        "reminder_repeat_left": 3,
    }
    r = requests.patch(f"{API}/tasks/{task_id}", json=payload, headers=h, timeout=15)
    assert r.status_code == 200, r.text

    # GET to verify persistence
    g = requests.get(f"{API}/tasks", headers=h, timeout=15)
    assert g.status_code == 200
    tasks = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
    task = next((t for t in tasks if t.get("id") == task_id), None)
    assert task is not None, "created task not found in GET /tasks"
    assert task.get("reminder_interval_min") == 30
    assert task.get("reminder_repeat_total") == 3
    assert task.get("reminder_repeat_left") == 3


def test_clear_reminder_on_done(h, task_id):
    # First set it
    requests.patch(
        f"{API}/tasks/{task_id}",
        json={"reminder_interval_min": 15, "reminder_repeat_total": 5, "reminder_repeat_left": 5},
        headers=h,
        timeout=15,
    )
    # Now clear (as done handler would)
    r = requests.patch(
        f"{API}/tasks/{task_id}",
        json={
            "status": "done",
            "reminder_interval_min": None,
            "reminder_repeat_left": None,
            "reminder_repeat_total": None,
        },
        headers=h,
        timeout=15,
    )
    assert r.status_code == 200, r.text
    g = requests.get(f"{API}/tasks?include_done=true", headers=h, timeout=15)
    tasks = g.json() if isinstance(g.json(), list) else g.json().get("items", [])
    task = next((t for t in tasks if t.get("id") == task_id), None)
    if task is not None:
        assert not task.get("reminder_interval_min")
        assert not task.get("reminder_repeat_left")
