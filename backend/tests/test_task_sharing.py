"""Görev Paylaşımı + Çok Kişili Atama — backend regression suite.

Covers:
  ÖZELLİK A — multi-assignee tasks + per-person completion ("2/4 tamamlandı").
  ÖZELLİK B — per-task share ACL (view/edit/complete/delete/assign) + notify.
  /users/search endpoint.
"""
import os
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"


def _h(t):
    return {"Authorization": f"Bearer {t}"}


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def mgr_token():
    return _login("mgr_test", "mgr12345")


@pytest.fixture(scope="module")
def emp_token():
    return _login("emp1_test", "emp12345")


def _user_id(admin_tok, username):
    for u in requests.get(f"{API}/admin/users", headers=_h(admin_tok)).json():
        if u.get("username") == username:
            return u["id"]
    return None


def _delete(tok, tid):
    requests.delete(f"{API}/tasks/{tid}", headers=_h(tok))


class TestMultiAssignee:
    def test_multi_assignee_per_person_completion(self, admin_token, mgr_token, emp_token):
        mgr_id = _user_id(admin_token, "mgr_test")
        emp_id = _user_id(admin_token, "emp1_test")
        assert mgr_id and emp_id
        r = requests.post(
            f"{API}/tasks", headers=_h(admin_token),
            json={"title": "MA_TEST_multi", "assignee_user_ids": [mgr_id, emp_id]},
        )
        assert r.status_code == 200, r.text
        task = r.json()
        tid = task["id"]
        try:
            assert len(task["assignees"]) == 2
            assert task["status"] != "done"
            # Both assignees see the task in their own list.
            for tok in (mgr_token, emp_token):
                ts = requests.get(f"{API}/tasks", headers=_h(tok)).json()
                assert any(t["id"] == tid for t in ts)
            # emp completes → still pending (2/... not all done).
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(emp_token),
                json={"completed": True},
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "pending"
            # mgr completes → all done → task done.
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(mgr_token),
                json={"completed": True},
            )
            assert r.status_code == 200
            body = r.json()
            assert body["status"] == "done"
            assert all(a["completed"] for a in body["assignees"])
            # mgr un-checks → reverts to pending.
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(mgr_token),
                json={"completed": False},
            )
            assert r.json()["status"] == "pending"
        finally:
            _delete(admin_token, tid)

    def test_non_assignee_cannot_use_my_completion(self, admin_token, mgr_token):
        # Task assigned only to admin's own id is not multi; use a real multi.
        emp_id = _user_id(admin_token, "emp1_test")
        r = requests.post(
            f"{API}/tasks", headers=_h(admin_token),
            json={"title": "MA_TEST_guard", "assignee_user_ids": [emp_id]},
        )
        tid = r.json()["id"]
        try:
            # mgr_test is NOT an assignee → 403.
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(mgr_token),
                json={"completed": True},
            )
            assert r.status_code == 403, r.text
        finally:
            _delete(admin_token, tid)


class TestTaskSharing:
    def test_share_grants_visibility_and_perms(self, admin_token, mgr_token):
        mgr_id = _user_id(admin_token, "mgr_test")
        r = requests.post(f"{API}/tasks", headers=_h(admin_token), json={"title": "SH_TEST_visible"})
        tid = r.json()["id"]
        try:
            # mgr can't see admin's private task.
            ts = requests.get(f"{API}/tasks", headers=_h(mgr_token)).json()
            assert not any(t["id"] == tid for t in ts)
            # Share with edit (no delete).
            r = requests.put(
                f"{API}/tasks/{tid}/shares", headers=_h(admin_token),
                json={"shares": [{"user_id": mgr_id, "perms": {
                    "view": True, "edit": True, "complete": True,
                    "delete": False, "assign": False}}], "notify": True},
            )
            assert r.status_code == 200, r.text
            # Now visible.
            ts = requests.get(f"{API}/tasks", headers=_h(mgr_token)).json()
            assert any(t["id"] == tid for t in ts)
            # Edit works.
            r = requests.patch(f"{API}/tasks/{tid}", headers=_h(mgr_token), json={"title": "SH edited"})
            assert r.status_code == 200, r.text
            assert r.json()["title"] == "SH edited"
            # Delete blocked (no delete perm) → deleted 0.
            r = requests.delete(f"{API}/tasks/{tid}", headers=_h(mgr_token))
            assert r.json().get("deleted") == 0
            # Notification created for mgr.
            ns = requests.get(f"{API}/notifications", headers=_h(mgr_token)).json()
            assert any(n.get("task_id") == tid and n.get("type") == "task_shared" for n in ns)
        finally:
            _delete(admin_token, tid)

    def test_share_view_only_cannot_edit(self, admin_token, mgr_token):
        mgr_id = _user_id(admin_token, "mgr_test")
        r = requests.post(f"{API}/tasks", headers=_h(admin_token), json={"title": "SH_TEST_viewonly"})
        tid = r.json()["id"]
        try:
            requests.put(
                f"{API}/tasks/{tid}/shares", headers=_h(admin_token),
                json={"shares": [{"user_id": mgr_id, "perms": {"view": True}}], "notify": False},
            )
            r = requests.patch(f"{API}/tasks/{tid}", headers=_h(mgr_token), json={"title": "nope"})
            assert r.status_code == 403, r.text
        finally:
            _delete(admin_token, tid)

    def test_non_owner_cannot_share(self, admin_token, mgr_token, emp_token):
        # emp1_test creates a task; mgr_test (not creator/company-mgr-of-task?) —
        # actually mgr can see emp, so mgr CAN share. Use emp trying to share
        # admin's task instead → 403.
        r = requests.post(f"{API}/tasks", headers=_h(admin_token), json={"title": "SH_TEST_owner"})
        tid = r.json()["id"]
        emp_id = _user_id(admin_token, "emp1_test")
        try:
            r = requests.put(
                f"{API}/tasks/{tid}/shares", headers=_h(emp_token),
                json={"shares": [{"user_id": emp_id, "perms": {"view": True}}], "notify": False},
            )
            assert r.status_code == 403, r.text
        finally:
            _delete(admin_token, tid)


class TestUserSearch:
    def test_search_returns_matches(self, mgr_token):
        r = requests.get(f"{API}/users/search", headers=_h(mgr_token), params={"q": "emp1_test"})
        assert r.status_code == 200, r.text
        names = [u["username"] for u in r.json()]
        assert "emp1_test" in names

    def test_empty_query_returns_empty(self, mgr_token):
        r = requests.get(f"{API}/users/search", headers=_h(mgr_token), params={"q": ""})
        assert r.status_code == 200
        assert r.json() == []
