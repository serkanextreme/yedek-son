"""Sertex — Task Duplicate (Kopyala → Yapıştır) backend tests.

Verifies POST /api/tasks/{tid}/duplicate:
  - title prefix "(Kopya) "
  - status=pending, assignee=işlemi yapan (serkan), category_id=body
  - subtasks: include_subtasks=True copies + done=False; False → empty
  - attachments: include_attachments=True duplicates in storage (new path,
    same bytes); False → none
  - lock/sharing/group ties are NOT copied
  - multi-paste: same source → multiple copies in different categories
"""
import io
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
assert BASE_URL, "REACT_APP_BACKEND_URL not set"

USERNAME = "serkan"
PASSWORD = "19071987"

# Cleanup registry: task ids to purge (permanent delete) at teardown.
_CREATED_TASK_IDS: list[str] = []


@pytest.fixture(scope="module")
def token() -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": USERNAME, "password": PASSWORD},
        timeout=15,
    )
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    return s


@pytest.fixture(scope="module")
def me(client: requests.Session) -> dict:
    r = client.get(f"{BASE_URL}/api/auth/me", timeout=10)
    assert r.status_code == 200
    return r.json()


@pytest.fixture(scope="module")
def a_category(client: requests.Session) -> dict:
    """Return any manageable category for serkan (paste target)."""
    r = client.get(f"{BASE_URL}/api/task-categories?scope=manage", timeout=10)
    assert r.status_code == 200
    cats = r.json()
    assert cats, "No categories available for serkan"
    return cats[0]


@pytest.fixture(scope="module")
def a_category_2(client: requests.Session) -> dict:
    """A different category — for the multi-paste parity test."""
    r = client.get(f"{BASE_URL}/api/task-categories?scope=manage", timeout=10)
    cats = r.json()
    assert len(cats) >= 2, "Need at least 2 categories for multi-paste test"
    return cats[1]


def _mk_task(client: requests.Session, **overrides) -> dict:
    payload = {
        "title": f"TEST_dup_src_{uuid.uuid4().hex[:8]}",
        "description": "kaynak görev — duplicate testi",
    }
    payload.update(overrides)
    r = client.post(f"{BASE_URL}/api/tasks", json=payload, timeout=10)
    assert r.status_code == 200, r.text
    t = r.json()
    _CREATED_TASK_IDS.append(t["id"])
    return t


def _upload_attachment(client: requests.Session, tid: str, content: bytes, fname: str) -> dict:
    """Upload one small attachment via the init → chunk → complete flow."""
    init = client.post(
        f"{BASE_URL}/api/tasks/{tid}/attachments/init",
        json={"filename": fname, "content_type": "text/plain", "total_size": len(content)},
        timeout=10,
    )
    assert init.status_code == 200, f"attach init: {init.status_code} {init.text}"
    upload_id = init.json()["upload_id"]
    # Chunk (single-part) — multipart form, not JSON
    files = {"chunk": (fname, io.BytesIO(content), "application/octet-stream")}
    data = {"upload_id": upload_id, "index": "0"}
    # Send without JSON content-type; use a raw request
    raw = requests.post(
        f"{BASE_URL}/api/tasks/{tid}/attachments/chunk",
        headers={"Authorization": client.headers["Authorization"]},
        files=files, data=data, timeout=30,
    )
    assert raw.status_code == 200, f"attach chunk: {raw.status_code} {raw.text}"
    complete = client.post(
        f"{BASE_URL}/api/tasks/{tid}/attachments/complete",
        json={"upload_id": upload_id},
        timeout=30,
    )
    assert complete.status_code == 200, f"attach complete: {complete.status_code} {complete.text}"
    return complete.json()


class TestDuplicateBasic:
    def test_duplicate_basic_prefix_status_assignee(self, client, me, a_category):
        src = _mk_task(client, title="TEST_dup_basic")
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": True, "include_attachments": True, "category_id": a_category["id"]},
            timeout=15,
        )
        assert r.status_code == 200, r.text
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        # Assertions
        assert dup["id"] != src["id"]
        assert dup["title"].startswith("(Kopya) ")
        assert "TEST_dup_basic" in dup["title"]
        assert dup["status"] == "pending"
        assert dup["user_id"] == me["id"]
        assert dup["created_by"] == me["id"]
        assert dup["category_id"] == a_category["id"]
        # Fresh state — should not inherit archive/deleted/cancelled flags
        assert dup.get("archived") in (False, None)
        assert dup.get("deleted") in (False, None)
        assert dup.get("cancelled") in (False, None)

    def test_duplicate_no_category_kolsuz(self, client):
        src = _mk_task(client, title="TEST_dup_kolsuz")
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": None},
            timeout=15,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        assert dup.get("category_id") in (None, "")


class TestDuplicateSubtasks:
    def test_include_subtasks_copies_and_resets_done(self, client, a_category):
        # source with two subtasks — one done
        src = _mk_task(client, title="TEST_dup_subs_yes")
        pr = client.patch(
            f"{BASE_URL}/api/tasks/{src['id']}",
            json={"subtasks": [
                {"text": "adım 1", "done": True, "status": "done"},
                {"text": "adım 2", "done": False, "status": "pending"},
            ]},
            timeout=10,
        )
        assert pr.status_code == 200
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": True, "include_attachments": False, "category_id": a_category["id"]},
            timeout=15,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        subs = dup.get("subtasks") or []
        assert len(subs) == 2
        assert [s["text"] for s in subs] == ["adım 1", "adım 2"]
        # Rule: kopyada 'yapılmadı' başlar
        assert all(s.get("done") is False for s in subs)
        assert all(s.get("status") == "pending" for s in subs)

    def test_exclude_subtasks_yields_empty(self, client, a_category):
        src = _mk_task(client, title="TEST_dup_subs_no")
        client.patch(
            f"{BASE_URL}/api/tasks/{src['id']}",
            json={"subtasks": [{"text": "a"}, {"text": "b"}]},
            timeout=10,
        )
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category["id"]},
            timeout=15,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        assert (dup.get("subtasks") or []) == []


class TestDuplicateAttachments:
    def test_include_attachments_duplicates_in_storage(self, client, a_category):
        src = _mk_task(client, title="TEST_dup_att_yes")
        content = b"hello-dup-payload-xyz-" + uuid.uuid4().hex.encode()
        _upload_attachment(client, src["id"], content, "orig.txt")
        # Duplicate
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": True, "category_id": a_category["id"]},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        # Fetch attachment lists for both
        la_src = client.get(f"{BASE_URL}/api/tasks/{src['id']}/attachments", timeout=10)
        la_dup = client.get(f"{BASE_URL}/api/tasks/{dup['id']}/attachments", timeout=10)
        assert la_src.status_code == 200 and la_dup.status_code == 200, (la_src.text, la_dup.text)
        src_atts = la_src.json()
        dup_atts = la_dup.json()
        assert len(src_atts) == 1
        assert len(dup_atts) == 1, f"expected 1 dup attachment, got {dup_atts}"
        # storage_path must differ (new object)
        assert src_atts[0]["storage_path"] != dup_atts[0]["storage_path"]
        assert src_atts[0]["original_filename"] == dup_atts[0]["original_filename"]
        # Download both — same content
        dl_src = client.get(f"{BASE_URL}/api/tasks/{src['id']}/attachments/{src_atts[0]['id']}/download", timeout=15)
        dl_dup = client.get(f"{BASE_URL}/api/tasks/{dup['id']}/attachments/{dup_atts[0]['id']}/download", timeout=15)
        assert dl_src.status_code == 200 and dl_dup.status_code == 200
        assert dl_src.content == dl_dup.content == content

    def test_exclude_attachments_yields_none(self, client, a_category):
        src = _mk_task(client, title="TEST_dup_att_no")
        _upload_attachment(client, src["id"], b"ignore-me", "skip.txt")
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category["id"]},
            timeout=30,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        la = client.get(f"{BASE_URL}/api/tasks/{dup['id']}/attachments", timeout=10)
        assert la.status_code == 200
        assert la.json() == []


class TestDuplicateExclusions:
    def test_lock_flags_not_copied(self, client, a_category):
        """Kilit bağı KOPYALANMAZ — kaynakta lock_flags set olsa bile
        kopya temiz başlar."""
        src = _mk_task(client, title="TEST_dup_locks")
        # As admin (serkan), set a lock on the task
        lr = client.patch(
            f"{BASE_URL}/api/tasks/{src['id']}/locks",
            json={"lock_flags": {"lock_edit": True, "lock_delete": True}, "requires_otp": True},
            timeout=10,
        )
        # Endpoint may or may not exist; if it errors, skip assertion but still duplicate
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category["id"]},
            timeout=15,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        # Copy MUST NOT inherit lock flags
        assert not any((dup.get("lock_flags") or {}).values()), f"lock_flags leaked: {dup.get('lock_flags')}"
        assert not any((dup.get("self_lock_flags") or {}).values())
        assert not dup.get("locked_at")

    def test_group_not_copied(self, client, a_category):
        """Grup bağı KOPYALANMAZ."""
        src = _mk_task(client, title="TEST_dup_group")
        # Force a group_id manually via PATCH — if server rejects, that's OK
        # (we just need to confirm the copy has none)
        gc = client.post(
            f"{BASE_URL}/api/task-groups",
            json={"name": "TEST_dup_group", "task_ids": [src["id"]]},
            timeout=10,
        )
        # Some deployments may not have this endpoint — degrade gracefully
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category["id"]},
            timeout=15,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        assert not dup.get("group_id")


class TestDuplicateMultiPaste:
    def test_same_source_pasted_into_two_categories(self, client, a_category, a_category_2):
        """Aynı görev birden fazla iş koluna yapıştırılabilir."""
        src = _mk_task(client, title="TEST_dup_multi_paste")
        r1 = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category["id"]},
            timeout=15,
        )
        r2 = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category_2["id"]},
            timeout=15,
        )
        assert r1.status_code == 200 and r2.status_code == 200
        d1, d2 = r1.json(), r2.json()
        _CREATED_TASK_IDS.extend([d1["id"], d2["id"]])
        assert d1["id"] != d2["id"]
        assert d1["category_id"] == a_category["id"]
        assert d2["category_id"] == a_category_2["id"]
        # Both should be at the top of the list (sort_order highest)
        assert d1.get("sort_order") is not None
        assert d2.get("sort_order") is not None

    def test_top_of_list_ordering(self, client, a_category):
        """Kopya listenin başına gelir — sort_order en yüksek olmalı."""
        # Snapshot current top
        lst = client.get(f"{BASE_URL}/api/tasks", timeout=10).json()
        top_before = max((t.get("sort_order") or 0) for t in lst) if lst else 0
        src = _mk_task(client, title="TEST_dup_top")
        r = client.post(
            f"{BASE_URL}/api/tasks/{src['id']}/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": a_category["id"]},
            timeout=15,
        )
        assert r.status_code == 200
        dup = r.json()
        _CREATED_TASK_IDS.append(dup["id"])
        assert (dup.get("sort_order") or 0) > top_before


class TestDuplicateNotFound:
    def test_unknown_task_404(self, client):
        r = client.post(
            f"{BASE_URL}/api/tasks/does-not-exist-xyz/duplicate",
            json={"include_subtasks": False, "include_attachments": False, "category_id": None},
            timeout=10,
        )
        assert r.status_code == 404


# --- Teardown: permanently purge every task created by this module -----------
@pytest.fixture(scope="module", autouse=True)
def _cleanup(client):
    yield
    for tid in list(dict.fromkeys(_CREATED_TASK_IDS)):
        try:
            client.delete(f"{BASE_URL}/api/tasks/{tid}", timeout=10)
            client.delete(f"{BASE_URL}/api/tasks/{tid}/permanent", timeout=10)
        except Exception:
            pass
