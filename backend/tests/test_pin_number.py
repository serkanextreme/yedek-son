"""Backend tests for Sıra numarasını sabitle (pin sequence number) feature.

Tests:
- Task-level number_pinned / pinned_number persistence via PATCH /api/tasks/{id}
- Subtask-level number_pinned / pinned_number persistence via PATCH subtasks array
- Clearing pin (number_pinned=false, pinned_number=null)
"""

import os
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
USERNAME = "serkan"
PASSWORD = "19071987"


@pytest.fixture(scope="module")
def token():
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    j = r.json()
    return j.get("access_token") or j.get("token")


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


def _create_task(client, text):
    r = client.post(f"{BASE_URL}/api/tasks", json={"title": text, "text": text}, timeout=15)
    assert r.status_code in (200, 201), r.text
    return r.json()


def _delete_task(client, tid):
    try:
        client.delete(f"{BASE_URL}/api/tasks/{tid}", timeout=10)
    except Exception:
        pass


def test_task_pin_and_unpin_persistence(client):
    """Pin a task with pinned_number=7, GET verifies, then unpin and verify cleared."""
    task = _create_task(client, "QA_PIN_task_auto")
    tid = task["id"]
    try:
        # PIN
        r = client.patch(
            f"{BASE_URL}/api/tasks/{tid}",
            json={"number_pinned": True, "pinned_number": 7},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("number_pinned") is True
        assert body.get("pinned_number") == 7

        # GET verify persistence
        r = client.get(f"{BASE_URL}/api/tasks", timeout=15)
        assert r.status_code == 200
        arr = r.json()
        found = next((t for t in arr if t["id"] == tid), None)
        assert found is not None
        assert found.get("number_pinned") is True
        assert found.get("pinned_number") == 7

        # UNPIN
        r = client.patch(
            f"{BASE_URL}/api/tasks/{tid}",
            json={"number_pinned": False, "pinned_number": None},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("number_pinned") in (False, None)
        assert body.get("pinned_number") in (None, 0) or body.get("pinned_number") is None

        # GET verify cleared
        r = client.get(f"{BASE_URL}/api/tasks", timeout=15)
        found = next((t for t in r.json() if t["id"] == tid), None)
        assert found is not None
        assert not found.get("number_pinned")
        assert found.get("pinned_number") in (None, 0) or found.get("pinned_number") is None
    finally:
        _delete_task(client, tid)


def test_subtask_pin_persistence(client):
    """Add subtasks via PATCH, pin one, verify persistence, unpin, verify cleared."""
    task = _create_task(client, "QA_PIN_task_with_subs")
    tid = task["id"]
    try:
        subtasks = [
            {"id": "s1", "text": "QA_sub_1", "done": False},
            {"id": "s2", "text": "QA_sub_2", "done": False, "number_pinned": True, "pinned_number": 1},
            {"id": "s3", "text": "QA_sub_3", "done": False},
        ]
        r = client.patch(f"{BASE_URL}/api/tasks/{tid}", json={"subtasks": subtasks}, timeout=15)
        assert r.status_code == 200, r.text
        body = r.json()
        subs = body.get("subtasks", [])
        assert len(subs) == 3
        s2 = next((s for s in subs if s.get("id") == "s2"), None)
        assert s2 is not None
        assert s2.get("number_pinned") is True
        assert s2.get("pinned_number") == 1

        # Reload via GET
        r = client.get(f"{BASE_URL}/api/tasks", timeout=15)
        found = next((t for t in r.json() if t["id"] == tid), None)
        assert found is not None
        s2b = next((s for s in found.get("subtasks", []) if s.get("id") == "s2"), None)
        assert s2b is not None
        assert s2b.get("number_pinned") is True
        assert s2b.get("pinned_number") == 1

        # Unpin subtask
        subtasks2 = [
            {"id": "s1", "text": "QA_sub_1", "done": False},
            {"id": "s2", "text": "QA_sub_2", "done": False, "number_pinned": False, "pinned_number": None},
            {"id": "s3", "text": "QA_sub_3", "done": False},
        ]
        r = client.patch(f"{BASE_URL}/api/tasks/{tid}", json={"subtasks": subtasks2}, timeout=15)
        assert r.status_code == 200, r.text
        s2c = next((s for s in r.json().get("subtasks", []) if s.get("id") == "s2"), None)
        assert s2c is not None
        assert not s2c.get("number_pinned")
    finally:
        _delete_task(client, tid)
