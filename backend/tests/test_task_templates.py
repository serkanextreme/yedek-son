"""Sertex — Görev Şablonları (Task Templates) backend tests.

Verifies /api/task-templates/*:
  - create (name/title/desc/subtasks/scope) + list + get + update + delete
  - subtasks stored as {id, text}
  - instantiate → real task (status=pending, assignee=serkan, subtasks done=False)
  - template attachments (chunked upload) + instantiate copies them to the task
  - validation: short name → 400; unknown template → 404
Cleans up every created template + task at teardown.
"""
import io
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"

USERNAME = "serkan"
PASSWORD = "19071987"

_TPL_IDS: list[str] = []
_TASK_IDS: list[str] = []


@pytest.fixture(scope="module")
def client() -> requests.Session:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {r.json()['token']}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module", autouse=True)
def _cleanup(client: requests.Session):
    yield
    for tid in _TASK_IDS:
        try:
            client.delete(f"{BASE_URL}/api/tasks/{tid}/permanent", timeout=10)
        except Exception:
            pass
    for tpl in _TPL_IDS:
        try:
            client.delete(f"{BASE_URL}/api/task-templates/{tpl}", timeout=10)
        except Exception:
            pass


def _create_tpl(client, **over):
    body = {
        "name": over.get("name", "Test Şablon"),
        "title": over.get("title", "Şablon görevi"),
        "description": over.get("description", "açıklama"),
        "subtasks": over.get("subtasks", [{"text": "adım 1"}, {"text": "adım 2"}]),
        "scope": over.get("scope", "personal"),
        "reminder_days": over.get("reminder_days", 3),
    }
    r = client.post(f"{BASE_URL}/api/task-templates", json=body, timeout=15)
    assert r.status_code == 200, f"{r.status_code} {r.text}"
    d = r.json()
    _TPL_IDS.append(d["id"])
    return d


def test_create_list_get(client):
    tpl = _create_tpl(client, name="CRUD Şablon")
    assert tpl["name"] == "CRUD Şablon"
    assert len(tpl["subtasks"]) == 2
    assert all(s.get("id") and s.get("text") for s in tpl["subtasks"])
    assert tpl["scope"] == "personal"
    # list
    r = client.get(f"{BASE_URL}/api/task-templates", timeout=10)
    assert r.status_code == 200
    assert any(t["id"] == tpl["id"] for t in r.json())
    # get
    r = client.get(f"{BASE_URL}/api/task-templates/{tpl['id']}", timeout=10)
    assert r.status_code == 200 and r.json()["id"] == tpl["id"]


def test_update(client):
    tpl = _create_tpl(client, name="Güncellenecek")
    r = client.patch(
        f"{BASE_URL}/api/task-templates/{tpl['id']}",
        json={"name": "Güncellendi", "title": "Yeni başlık", "subtasks": [{"text": "tek adım"}]},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    d = r.json()
    assert d["name"] == "Güncellendi"
    assert d["title"] == "Yeni başlık"
    assert len(d["subtasks"]) == 1


def test_short_name_rejected(client):
    r = client.post(f"{BASE_URL}/api/task-templates", json={"name": "x"}, timeout=10)
    assert r.status_code == 400


def test_unknown_template_404(client):
    r = client.get(f"{BASE_URL}/api/task-templates/nope-{os.urandom(4).hex()}", timeout=10)
    assert r.status_code == 404


def test_instantiate_creates_task(client):
    tpl = _create_tpl(client, name="Kur Şablon", title="Şablondan görev", subtasks=[{"text": "a"}, {"text": "b"}])
    r = client.post(f"{BASE_URL}/api/task-templates/{tpl['id']}/instantiate", json={}, timeout=15)
    assert r.status_code == 200, r.text
    task = r.json()
    _TASK_IDS.append(task["id"])
    assert task["title"] == "Şablondan görev"
    assert task["status"] == "pending"
    assert task["assignee_name"] == USERNAME
    texts = [(s["text"], s["done"]) for s in task["subtasks"]]
    assert texts == [("a", False), ("b", False)]


def test_template_attachment_and_instantiate_copy(client):
    tpl = _create_tpl(client, name="Ekli Şablon", subtasks=[])
    tid = tpl["id"]
    # init
    r = client.post(
        f"{BASE_URL}/api/task-templates/{tid}/attachments/init",
        json={"filename": "not.txt", "content_type": "text/plain", "total_size": 11},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    upload_id = r.json()["upload_id"]
    # chunk (multipart — no JSON content-type)
    files = {"chunk": ("not.txt", io.BytesIO(b"merhaba dny"), "text/plain")}
    data = {"upload_id": upload_id, "index": "0"}
    r = client.post(
        f"{BASE_URL}/api/task-templates/{tid}/attachments/chunk",
        files=files, data=data,
        headers={"Content-Type": None},
        timeout=20,
    )
    assert r.status_code == 200, r.text
    # complete
    r = client.post(
        f"{BASE_URL}/api/task-templates/{tid}/attachments/complete",
        json={"upload_id": upload_id}, timeout=20,
    )
    assert r.status_code == 200, r.text
    # list template attachments
    r = client.get(f"{BASE_URL}/api/task-templates/{tid}/attachments", timeout=10)
    assert r.status_code == 200 and len(r.json()) == 1
    # instantiate → task should get a copy
    r = client.post(f"{BASE_URL}/api/task-templates/{tid}/instantiate", json={}, timeout=20)
    assert r.status_code == 200, r.text
    task = r.json()
    _TASK_IDS.append(task["id"])
    r = client.get(f"{BASE_URL}/api/tasks/{task['id']}/attachments", timeout=10)
    assert r.status_code == 200
    atts = r.json()
    assert len(atts) == 1 and atts[0]["original_filename"] == "not.txt"


def test_delete_template(client):
    tpl = _create_tpl(client, name="Silinecek")
    r = client.delete(f"{BASE_URL}/api/task-templates/{tpl['id']}", timeout=10)
    assert r.status_code == 200 and r.json().get("deleted") == 1
    _TPL_IDS.remove(tpl["id"])
    r = client.get(f"{BASE_URL}/api/task-templates/{tpl['id']}", timeout=10)
    assert r.status_code == 404
