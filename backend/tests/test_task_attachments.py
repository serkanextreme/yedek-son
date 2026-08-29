"""Backend tests for Sertex task attachments (chunked upload + object storage).

Covers:
  * Happy path: init → chunk → complete → list → download → delete
  * Multi-chunk 9 MB file assembly integrity
  * Multiple files per task
  * RBAC: non-viewer gets 404 on list/init/download
  * RBAC: non-uploader non-manager gets 403 on delete;
          uploader and manager can delete
  * Size limit: init > 100 MB → 400
Cleans up all created tasks/attachments.
"""
import hashlib
import io
import os

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Fallback (should not happen — env var is required in this env).
    with open("/app/frontend/.env") as fh:
        for ln in fh:
            if ln.startswith("REACT_APP_BACKEND_URL="):
                BASE_URL = ln.split("=", 1)[1].strip().rstrip("/")
                break

API = f"{BASE_URL}/api"
MAX_BYTES = 100 * 1024 * 1024
CHUNK_SIZE = 4 * 1024 * 1024  # 4 MB — matches frontend


# ---------------------------------------------------------------------------
# Session/auth helpers
# ---------------------------------------------------------------------------
def _login(username: str, password: str) -> str | None:
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password}, timeout=15)
    if r.status_code != 200:
        return None
    return r.json().get("token")


def _client(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}"})
    return s


@pytest.fixture(scope="module")
def admin_token():
    tok = _login("serkan", "19071987")
    if not tok:
        pytest.skip("admin serkan/19071987 login failed")
    return tok


@pytest.fixture(scope="module")
def manager_token():
    return _login("mgr_test", "mgr12345")


@pytest.fixture(scope="module")
def employee_token():
    return _login("emp1_test", "emp12345")


@pytest.fixture(scope="module")
def admin(admin_token):
    return _client(admin_token)


# ---------------------------------------------------------------------------
# Task lifecycle helpers
# ---------------------------------------------------------------------------
def _create_task(client: requests.Session, title: str, **extra) -> str:
    body = {"title": title, "description": "attachment test"}
    body.update(extra)
    r = client.post(f"{API}/tasks", json=body, timeout=15)
    assert r.status_code == 200, f"task create failed: {r.status_code} {r.text}"
    return r.json()["id"]


def _delete_task(client: requests.Session, tid: str):
    try:
        client.delete(f"{API}/tasks/{tid}", timeout=15)
    except Exception:
        pass


def _upload(client: requests.Session, tid: str, filename: str, data: bytes, content_type="application/octet-stream"):
    r = client.post(
        f"{API}/tasks/{tid}/attachments/init",
        json={"filename": filename, "content_type": content_type, "total_size": len(data)},
        timeout=15,
    )
    assert r.status_code == 200, f"init failed: {r.status_code} {r.text}"
    upload_id = r.json()["upload_id"]
    idx = 0
    for off in range(0, len(data), CHUNK_SIZE):
        chunk = data[off : off + CHUNK_SIZE]
        files = {"chunk": (f"chunk_{idx}", io.BytesIO(chunk), "application/octet-stream")}
        # Use a client copy without JSON content-type
        rc = requests.post(
            f"{API}/tasks/{tid}/attachments/chunk",
            headers={"Authorization": client.headers["Authorization"]},
            data={"upload_id": upload_id, "index": str(idx)},
            files=files,
            timeout=60,
        )
        assert rc.status_code == 200, f"chunk {idx} failed: {rc.status_code} {rc.text}"
        idx += 1
    r = client.post(
        f"{API}/tasks/{tid}/attachments/complete",
        json={"upload_id": upload_id},
        timeout=60,
    )
    assert r.status_code == 200, f"complete failed: {r.status_code} {r.text}"
    return r.json()


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------
class TestHappyPath:
    def test_full_flow_small_file(self, admin):
        tid = _create_task(admin, "TEST_attach_small")
        try:
            payload = b"hello world " * 20  # ~240 B
            att = _upload(admin, tid, "test_small.txt", payload, "text/plain")
            assert att["task_id"] == tid
            assert att["original_filename"] == "test_small.txt"
            assert att["size"] == len(payload)
            assert att["uploaded_by_name"] == "serkan"
            assert att.get("storage_path")

            # List
            r = admin.get(f"{API}/tasks/{tid}/attachments", timeout=15)
            assert r.status_code == 200
            lst = r.json()
            assert len(lst) == 1
            assert lst[0]["id"] == att["id"]

            # Download
            r = admin.get(f"{API}/tasks/{tid}/attachments/{att['id']}/download", timeout=30)
            assert r.status_code == 200
            assert r.content == payload
            cd = r.headers.get("Content-Disposition", "")
            assert "attachment" in cd and "test_small.txt" in cd

            # Delete (soft)
            r = admin.delete(f"{API}/tasks/{tid}/attachments/{att['id']}", timeout=15)
            assert r.status_code == 200
            r = admin.get(f"{API}/tasks/{tid}/attachments", timeout=15)
            assert r.status_code == 200 and r.json() == []
        finally:
            _delete_task(admin, tid)


class TestMultiChunk:
    def test_9mb_file_3_chunks_integrity(self, admin):
        tid = _create_task(admin, "TEST_attach_9mb")
        try:
            # Deterministic ~9 MB payload
            size = 9 * 1024 * 1024
            payload = os.urandom(size)
            original_hash = hashlib.sha256(payload).hexdigest()
            att = _upload(admin, tid, "big_9mb.bin", payload, "application/octet-stream")
            assert att["size"] == size

            r = admin.get(f"{API}/tasks/{tid}/attachments/{att['id']}/download", timeout=120)
            assert r.status_code == 200
            assert len(r.content) == size
            assert hashlib.sha256(r.content).hexdigest() == original_hash
        finally:
            _delete_task(admin, tid)


class TestMultipleFiles:
    def test_three_files_all_listed(self, admin):
        tid = _create_task(admin, "TEST_attach_multi")
        try:
            uploaded = []
            for i in range(3):
                data = f"file-{i}-".encode() + os.urandom(100)
                att = _upload(admin, tid, f"multi_{i}.bin", data)
                uploaded.append(att["id"])
            r = admin.get(f"{API}/tasks/{tid}/attachments", timeout=15)
            assert r.status_code == 200
            ids = {a["id"] for a in r.json()}
            assert ids == set(uploaded)
            assert len(ids) == 3
        finally:
            _delete_task(admin, tid)


class TestRBACView:
    def test_non_viewer_gets_404_on_all_attachment_endpoints(self, admin, employee_token):
        if not employee_token:
            pytest.skip("emp1_test login unavailable")
        emp = _client(employee_token)
        # Admin creates a private task (owned by serkan; emp1_test is another company)
        tid = _create_task(admin, "TEST_attach_rbac_view")
        try:
            # Emp cannot list
            r = emp.get(f"{API}/tasks/{tid}/attachments", timeout=15)
            assert r.status_code == 404
            # Cannot init
            r = emp.post(
                f"{API}/tasks/{tid}/attachments/init",
                json={"filename": "x.txt", "content_type": "text/plain", "total_size": 5},
                timeout=15,
            )
            assert r.status_code == 404
            # Admin uploads a file so download can be tested
            att = _upload(admin, tid, "priv.txt", b"secret data", "text/plain")
            r = emp.get(f"{API}/tasks/{tid}/attachments/{att['id']}/download", timeout=15)
            assert r.status_code == 404
        finally:
            _delete_task(admin, tid)


class TestRBACDelete:
    def test_delete_permission_matrix(self, admin, manager_token, employee_token):
        if not (manager_token and employee_token):
            pytest.skip("manager/employee login unavailable")
        mgr = _client(manager_token)
        emp = _client(employee_token)

        # Manager creates a task owned by themselves inside Test Company A.
        # Share it explicitly with emp1_test so emp can view/upload.
        tid = _create_task(mgr, "TEST_attach_rbac_del")
        try:
            # Look up emp1_test user id
            r = admin.get(f"{API}/admin/users", timeout=15)
            assert r.status_code == 200
            emp_row = next((u for u in r.json() if u.get("username") == "emp1_test"), None)
            assert emp_row, "emp1_test user not found"
            # Share with emp so they can view+upload
            r = mgr.put(
                f"{API}/tasks/{tid}/shares",
                json={"shares": [{"user_id": emp_row["id"], "perms": {"view": True}}], "notify": False},
                timeout=15,
            )
            assert r.status_code == 200, f"share failed: {r.status_code} {r.text}"

            # Employee uploads a file
            emp_att = _upload(emp, tid, "emp_upload.txt", b"employee data", "text/plain")

            # Manager uploads another file
            mgr_att = _upload(mgr, tid, "mgr_upload.txt", b"manager data", "text/plain")

            # Employee CANNOT delete the manager's file
            r = emp.delete(f"{API}/tasks/{tid}/attachments/{mgr_att['id']}", timeout=15)
            assert r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}"

            # Employee CAN delete their own file
            r = emp.delete(f"{API}/tasks/{tid}/attachments/{emp_att['id']}", timeout=15)
            assert r.status_code == 200

            # Manager CAN delete their own file
            r = mgr.delete(f"{API}/tasks/{tid}/attachments/{mgr_att['id']}", timeout=15)
            assert r.status_code == 200

            # Employee uploads again, admin (not owner but admin) deletes it
            emp_att2 = _upload(emp, tid, "emp_upload2.txt", b"more", "text/plain")
            r = admin.delete(f"{API}/tasks/{tid}/attachments/{emp_att2['id']}", timeout=15)
            assert r.status_code == 200
        finally:
            _delete_task(mgr, tid)


class TestSizeLimit:
    def test_init_over_100mb_rejected(self, admin):
        tid = _create_task(admin, "TEST_attach_size_limit")
        try:
            r = admin.post(
                f"{API}/tasks/{tid}/attachments/init",
                json={"filename": "huge.bin", "content_type": "application/octet-stream", "total_size": MAX_BYTES + 1},
                timeout=15,
            )
            assert r.status_code == 400
            body = r.text
            assert "büyük" in body or "100" in body
        finally:
            _delete_task(admin, tid)
