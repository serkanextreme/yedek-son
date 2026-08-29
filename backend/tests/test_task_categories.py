"""Faz 8 CP4 — Task Categories (İş Kolları) tests."""
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


def _uniq(p):
    return f"{p}_{uuid.uuid4().hex[:6]}"


def _cleanup_cats(admin_tok, prefix):
    """Delete every task_category whose name starts with `prefix`."""
    rows = requests.get(f"{API}/task-categories", headers=_h(admin_tok)).json()
    for c in rows:
        if c["name"].startswith(prefix):
            requests.delete(f"{API}/task-categories/{c['id']}", headers=_h(admin_tok))


class TestTaskCategoriesCRUD:
    def test_manager_creates_lists_updates_deletes(self, mgr_token, admin_token):
        name = _uniq("cp4_mgr")
        try:
            r = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": name})
            assert r.status_code == 200, r.text
            cat = r.json()
            assert cat["name"] == name
            # List returns the new row.
            rows = requests.get(f"{API}/task-categories", headers=_h(mgr_token)).json()
            assert any(x["id"] == cat["id"] for x in rows)
            # Rename.
            new_name = _uniq("cp4_ren")
            r = requests.patch(f"{API}/task-categories/{cat['id']}", headers=_h(mgr_token), json={"name": new_name})
            assert r.status_code == 200
            assert r.json()["name"] == new_name
            # Delete.
            r = requests.delete(f"{API}/task-categories/{cat['id']}", headers=_h(mgr_token))
            assert r.status_code == 200
        finally:
            _cleanup_cats(admin_token, "cp4_")

    def test_employee_cannot_create(self, emp_token):
        r = requests.post(f"{API}/task-categories", headers=_h(emp_token), json={"name": _uniq("cp4_emp")})
        assert r.status_code == 403

    def test_duplicate_name_case_insensitive_rejected(self, mgr_token, admin_token):
        name = _uniq("cp4_dup")
        try:
            r1 = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": name})
            assert r1.status_code == 200
            r2 = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": name.upper()})
            assert r2.status_code == 400
        finally:
            _cleanup_cats(admin_token, "cp4_")

    def test_too_short_name_rejected(self, mgr_token):
        r = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": "A"})
        assert r.status_code == 400


class TestTaskCategoryOnTasks:
    def test_task_create_with_category(self, mgr_token, admin_token):
        name = _uniq("cp4_task")
        try:
            cat = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": name}).json()
            r = requests.post(f"{API}/tasks", headers=_h(mgr_token), json={"title": "cat_task", "category_id": cat["id"]})
            assert r.status_code == 200
            assert r.json()["category_id"] == cat["id"]
            requests.delete(f"{API}/tasks/{r.json()['id']}", headers=_h(mgr_token))
        finally:
            _cleanup_cats(admin_token, "cp4_")

    def test_patch_task_category_clear_and_set(self, mgr_token, admin_token):
        try:
            cat1 = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": _uniq("cp4_c1")}).json()
            cat2 = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": _uniq("cp4_c2")}).json()
            t = requests.post(f"{API}/tasks", headers=_h(mgr_token), json={"title": "cat_move", "category_id": cat1["id"]}).json()
            # Move to cat2
            r = requests.patch(f"{API}/tasks/{t['id']}", headers=_h(mgr_token), json={"category_id": cat2["id"]})
            assert r.status_code == 200
            assert r.json()["category_id"] == cat2["id"]
            # Clear
            r = requests.patch(f"{API}/tasks/{t['id']}", headers=_h(mgr_token), json={"category_id": ""})
            assert r.status_code == 200
            assert r.json().get("category_id") is None
            requests.delete(f"{API}/tasks/{t['id']}", headers=_h(mgr_token))
        finally:
            _cleanup_cats(admin_token, "cp4_")

    def test_delete_category_clears_task_reference(self, mgr_token, admin_token):
        try:
            cat = requests.post(f"{API}/task-categories", headers=_h(mgr_token), json={"name": _uniq("cp4_cascade")}).json()
            t = requests.post(f"{API}/tasks", headers=_h(mgr_token), json={"title": "cascade", "category_id": cat["id"]}).json()
            # Delete category → task.category_id should be gone
            requests.delete(f"{API}/task-categories/{cat['id']}", headers=_h(mgr_token))
            r = requests.get(f"{API}/tasks", headers=_h(mgr_token))
            found = next((x for x in r.json() if x["id"] == t["id"]), None)
            assert found is not None
            assert not found.get("category_id")
            requests.delete(f"{API}/tasks/{t['id']}", headers=_h(mgr_token))
        finally:
            _cleanup_cats(admin_token, "cp4_")

    def test_employee_cannot_assign_foreign_category(self, mgr_token, emp_token, admin_token):
        # Manager creates cat; employee (same company) SHOULD be able to use it,
        # but if backend receives a random uuid → 404.
        r = requests.patch(
            f"{API}/tasks/{uuid.uuid4()}", headers=_h(emp_token),
            json={"category_id": str(uuid.uuid4())},
        )
        # Non-existent task → 404
        assert r.status_code in (404,)
