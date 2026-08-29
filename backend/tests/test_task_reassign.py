"""Faz 8 CP3 extension — Task reassign context-menu action."""
import os
import uuid
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


def _create_task(tok, title):
    r = requests.post(f"{API}/tasks", headers=_h(tok), json={"title": title})
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete_task(tok, tid):
    requests.delete(f"{API}/tasks/{tid}", headers=_h(tok))


def _user_id(admin_tok, username):
    for u in requests.get(f"{API}/admin/users", headers=_h(admin_tok)).json():
        if u.get("username") == username:
            return u["id"]
    return None


class TestReassign:
    def test_manager_reassigns_own_task_to_visible_employee(self, admin_token, mgr_token, emp_token):
        emp_id = _user_id(admin_token, "emp1_test")
        assert emp_id
        tid = _create_task(mgr_token, "Reassign_Test_1")
        try:
            r = requests.post(
                f"{API}/tasks/{tid}/reassign", headers=_h(mgr_token),
                json={"new_owner_user_id": emp_id},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["assignee_name"] == "emp1_test"
            # emp1_test now sees the task in their own list.
            emp_tasks = requests.get(f"{API}/tasks", headers=_h(emp_token)).json()
            assert any(t["id"] == tid for t in emp_tasks)
        finally:
            _delete_task(admin_token, tid)

    def test_reassign_to_invisible_target_403(self, admin_token, mgr_token):
        # mgr_test has NO visibility on serkan; passing serkan's id → 403
        serkan_id = _user_id(admin_token, "serkan")
        assert serkan_id
        tid = _create_task(mgr_token, "Reassign_Test_403")
        try:
            r = requests.post(
                f"{API}/tasks/{tid}/reassign", headers=_h(mgr_token),
                json={"new_owner_user_id": serkan_id},
            )
            assert r.status_code == 403
        finally:
            _delete_task(admin_token, tid)

    def test_reassign_task_not_owned_by_caller_returns_404(self, admin_token, emp_token):
        # emp1_test cannot see mgr_test → cannot reassign mgr's task.
        # Actually emp1_test doesn't own the task and can't see mgr — so 404
        # (existence hidden). Use a random uuid guaranteed non-owned.
        r = requests.post(
            f"{API}/tasks/{uuid.uuid4()}/reassign", headers=_h(emp_token),
            json={"new_owner_user_id": _user_id(admin_token, "emp1_test")},
        )
        assert r.status_code == 404

    def test_reassign_same_owner_400(self, admin_token, mgr_token):
        mgr_id = _user_id(admin_token, "mgr_test")
        tid = _create_task(mgr_token, "Reassign_Test_same")
        try:
            r = requests.post(
                f"{API}/tasks/{tid}/reassign", headers=_h(mgr_token),
                json={"new_owner_user_id": mgr_id},
            )
            assert r.status_code == 400
        finally:
            _delete_task(admin_token, tid)

    def test_admin_can_reassign_between_any_users(self, admin_token, emp_token):
        emp_id = _user_id(admin_token, "emp1_test")
        mgr_id = _user_id(admin_token, "mgr_test")
        tid = _create_task(emp_token, "Reassign_Test_Admin_Bypass")
        try:
            r = requests.post(
                f"{API}/tasks/{tid}/reassign", headers=_h(admin_token),
                json={"new_owner_user_id": mgr_id},
            )
            assert r.status_code == 200, r.text
            assert r.json()["assignee_name"] == "mgr_test"
        finally:
            _delete_task(admin_token, tid)
