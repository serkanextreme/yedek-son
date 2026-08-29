"""Backend verification for promoted-child bugs (parent rename cascade)."""
import os
import time
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # fallback: read frontend/.env
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"


def _login():
    r = requests.post(f"{API}/auth/login", json={"username": "serkan", "password": "19071987"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_parent_rename_cascades_promoted_from_task_title():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    parent_title = f"TEST_promote_parent_{int(time.time())}"
    # 1. create parent
    r = requests.post(f"{API}/tasks", json={"title": parent_title, "priority": "P2"}, headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    parent = r.json()
    pid = parent["id"]

    # 2. add subtask via PATCH
    sub_title = "TEST_sub_to_promote"
    r = requests.patch(f"{API}/tasks/{pid}", json={"subtasks": [{"text": sub_title, "done": False}]}, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    import uuid as _uuid
    fixed_sub_id = str(_uuid.uuid4())
    r = requests.patch(f"{API}/tasks/{pid}", json={"subtasks": [{"id": fixed_sub_id, "text": sub_title, "done": False}]}, headers=h, timeout=15)
    assert r.status_code == 200, r.text
    subs = r.json().get("subtasks", [])
    assert subs, f"subtask not persisted: {r.json()}"
    sub_id = fixed_sub_id

    # 3. promote
    r = requests.post(f"{API}/tasks/{pid}/subtasks/{sub_id}/promote", headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    child = r.json()
    cid = child["id"]
    assert child.get("promoted_from_task_id") == pid
    assert child.get("promoted_from_task_title") == parent_title

    # 4. rename parent
    new_title = parent_title + "_RENAMED"
    r = requests.patch(f"{API}/tasks/{pid}", json={"title": new_title}, headers=h, timeout=15)
    assert r.status_code == 200

    # 5. fetch child, verify title updated
    r = requests.get(f"{API}/tasks", headers=h, timeout=15)
    assert r.status_code == 200
    tasks = r.json()
    child_after = next((t for t in tasks if t["id"] == cid), None)
    assert child_after is not None, "child missing"
    assert child_after.get("promoted_from_task_title") == new_title, (
        f"stale title! expected {new_title} got {child_after.get('promoted_from_task_title')}"
    )

    # 6. set child due_date in past to test overdue rendering later
    past_iso = "2020-01-01T00:00:00Z"
    r = requests.patch(f"{API}/tasks/{cid}", json={"due_date": past_iso}, headers=h, timeout=15)
    assert r.status_code == 200, r.text

    # cleanup: delete child + parent
    requests.delete(f"{API}/tasks/{cid}", headers=h, timeout=15)
    requests.delete(f"{API}/tasks/{pid}", headers=h, timeout=15)
