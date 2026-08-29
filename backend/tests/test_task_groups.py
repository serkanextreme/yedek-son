"""Backend tests for Task Grouping (Görev Bağlama) feature."""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")
API = f"{BASE_URL}/api"

USER = {"username": "ahmet", "password": "ahmet123"}


@pytest.fixture(scope="module")
def client():
    s = requests.Session()
    r = s.post(f"{API}/auth/login", json=USER, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    data = r.json()
    token = data.get("access_token") or data.get("token")
    if token:
        s.headers.update({"Authorization": f"Bearer {token}"})
    s.headers.update({"Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created_task_ids(client):
    ids = []
    for i in range(4):
        payload = {"title": f"TEST_group_task_{uuid.uuid4().hex[:6]}", "description": "grp test"}
        r = client.post(f"{API}/tasks", json=payload, timeout=30)
        assert r.status_code in (200, 201), f"task create failed {r.status_code} {r.text}"
        ids.append(r.json()["id"])
    yield ids
    # cleanup
    for tid in ids:
        try:
            client.delete(f"{API}/tasks/{tid}", timeout=15)
        except Exception:
            pass


class TestTaskGroups:
    group_id = None

    def test_create_group_requires_two(self, client, created_task_ids):
        r = client.post(f"{API}/task-groups", json={"task_ids": [created_task_ids[0]]})
        assert r.status_code == 400, f"expected 400, got {r.status_code} {r.text}"

    def test_create_group_success(self, client, created_task_ids):
        payload = {"name": "TEST_grp", "show_progress": True, "task_ids": created_task_ids[:3]}
        r = client.post(f"{API}/task-groups", json=payload)
        assert r.status_code == 201, r.text
        g = r.json()
        assert g["name"] == "TEST_grp"
        assert g["show_progress"] is True
        assert "id" in g
        TestTaskGroups.group_id = g["id"]

        # verify group_id on tasks + contiguous descending sort_order
        prev = None
        for tid in created_task_ids[:3]:
            tr = client.get(f"{API}/tasks/{tid}").json()
            assert tr["group_id"] == g["id"], f"task {tid} not linked"
            so = tr.get("sort_order")
            if prev is not None:
                assert so < prev, "sort_order should be descending"
            prev = so

    def test_list_groups(self, client):
        r = client.get(f"{API}/task-groups")
        assert r.status_code == 200
        arr = r.json()
        assert any(g["id"] == TestTaskGroups.group_id for g in arr)

    def test_patch_group_name_and_membership(self, client, created_task_ids):
        gid = TestTaskGroups.group_id
        new_ids = [created_task_ids[2], created_task_ids[0], created_task_ids[3]]  # drop idx1, add idx3, reorder
        r = client.patch(f"{API}/task-groups/{gid}", json={"name": "TEST_grp2", "show_progress": False, "task_ids": new_ids})
        assert r.status_code == 200, r.text
        g = r.json()
        assert g["name"] == "TEST_grp2"
        assert g["show_progress"] is False

        # removed task cleared
        removed = client.get(f"{API}/tasks/{created_task_ids[1]}").json()
        assert removed.get("group_id") in (None, ""), f"removed task still has group_id={removed.get('group_id')}"

        # first in new_ids should have largest sort_order
        so_first = client.get(f"{API}/tasks/{new_ids[0]}").json()["sort_order"]
        so_last = client.get(f"{API}/tasks/{new_ids[-1]}").json()["sort_order"]
        assert so_first > so_last

    def test_remove_member(self, client, created_task_ids):
        gid = TestTaskGroups.group_id
        # currently 3 members; remove one -> still 2, no dissolve
        tid = created_task_ids[3]
        r = client.delete(f"{API}/task-groups/{gid}/members/{tid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("group_dissolved") is False
        cleared = client.get(f"{API}/tasks/{tid}").json()
        assert cleared.get("group_id") in (None, "")

    def test_remove_member_dissolves(self, client, created_task_ids):
        gid = TestTaskGroups.group_id
        # 2 members remain; remove one -> should dissolve
        tid = created_task_ids[2]
        r = client.delete(f"{API}/task-groups/{gid}/members/{tid}")
        assert r.status_code == 200, r.text
        body = r.json()
        assert body.get("group_dissolved") is True
        # remaining should have group_id cleared
        other = client.get(f"{API}/tasks/{created_task_ids[0]}").json()
        assert other.get("group_id") in (None, "")

    def test_delete_group_clears_members(self, client, created_task_ids):
        # Create fresh group
        r = client.post(f"{API}/task-groups", json={"name": "TEST_del", "task_ids": created_task_ids[:2]})
        assert r.status_code == 201
        gid = r.json()["id"]
        r2 = client.delete(f"{API}/task-groups/{gid}")
        assert r2.status_code == 200
        for tid in created_task_ids[:2]:
            t = client.get(f"{API}/tasks/{tid}").json()
            assert t.get("group_id") in (None, "")
        # not in list
        arr = client.get(f"{API}/task-groups").json()
        assert not any(g["id"] == gid for g in arr)
