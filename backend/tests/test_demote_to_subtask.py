"""Backend verification for demote-to-subtask feature (Bug 2 companion)."""
import os
import time
import uuid
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    with open("/app/frontend/.env") as f:
        for line in f:
            if line.startswith("REACT_APP_BACKEND_URL"):
                BASE_URL = line.split("=", 1)[1].strip().rstrip("/")

API = f"{BASE_URL}/api"


def _login():
    r = requests.post(f"{API}/auth/login", json={"username": "serkan", "password": "19071987"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def test_demote_promoted_task_back_to_subtask():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    parent_title = f"TEST_demote_parent_{int(time.time())}"
    # create parent
    r = requests.post(f"{API}/tasks", json={"title": parent_title, "priority": "P2"}, headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    pid = r.json()["id"]

    sub_id = str(uuid.uuid4())
    sub_text = "TEST_sub_promote_then_demote"
    r = requests.patch(f"{API}/tasks/{pid}", json={"subtasks": [{"id": sub_id, "text": sub_text, "done": False}]}, headers=h, timeout=15)
    assert r.status_code == 200

    # promote
    r = requests.post(f"{API}/tasks/{pid}/subtasks/{sub_id}/promote", headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    child = r.json()
    cid = child["id"]
    assert child.get("promoted_from_task_id") == pid

    # give it a due_date + status so we can verify preservation
    due_iso = "2027-05-05T12:00:00Z"
    r = requests.patch(f"{API}/tasks/{cid}", json={"due_date": due_iso}, headers=h, timeout=15)
    assert r.status_code == 200, r.text

    # demote
    r = requests.post(f"{API}/tasks/{cid}/demote-to-subtask", headers=h, timeout=15)
    assert r.status_code in (200, 201), r.text
    parent_after = r.json()
    # child should be gone; parent should have new subtask with preserved text
    subs = parent_after.get("subtasks", [])
    assert any(s.get("text") == child.get("title") for s in subs), f"demoted subtask missing: {subs}"

    # verify child task deleted
    r = requests.get(f"{API}/tasks", headers=h, timeout=15)
    assert r.status_code == 200
    tasks = r.json()
    assert not any(t["id"] == cid for t in tasks), "child task should be deleted after demote"

    # cleanup
    requests.delete(f"{API}/tasks/{pid}", headers=h, timeout=15)


def test_demote_requires_promoted_from_task_id():
    token = _login()
    h = {"Authorization": f"Bearer {token}"}

    r = requests.post(f"{API}/tasks", json={"title": f"TEST_demote_normal_{int(time.time())}", "priority": "P2"}, headers=h, timeout=15)
    assert r.status_code in (200, 201)
    tid = r.json()["id"]
    # not promoted; demote should fail
    r = requests.post(f"{API}/tasks/{tid}/demote-to-subtask", headers=h, timeout=15)
    assert r.status_code == 400, f"expected 400 got {r.status_code}: {r.text}"

    requests.delete(f"{API}/tasks/{tid}", headers=h, timeout=15)
