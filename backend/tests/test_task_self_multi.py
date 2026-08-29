"""Self-inclusive multi-assignee tests (bug fix verification).

- Creator can include themselves in assignee_user_ids and appears in the
  response's assignees array (completed=false).
- Task appears in creator's scope=mine list.
- Creator can toggle their own my-completion.
- status='done' only after ALL assignees (creator included) complete.
- Single-assignee (assignee_user_id) legacy path still works.
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
def emp_token():
    return _login("emp1_test", "emp12345")


def _uid(admin_tok, username):
    for u in requests.get(f"{API}/admin/users", headers=_h(admin_tok)).json():
        if u.get("username") == username:
            return u["id"]
    return None


def _me(tok):
    for path in ("/auth/me", "/me", "/users/me"):
        r = requests.get(f"{API}{path}", headers=_h(tok))
        if r.status_code == 200:
            return r.json()
    raise AssertionError("no /me endpoint found")


def _delete(tok, tid):
    requests.delete(f"{API}/tasks/{tid}", headers=_h(tok))


class TestSelfInclusiveMulti:
    def test_creator_included_in_assignees(self, admin_token, emp_token):
        me = _me(admin_token)
        admin_id = me["id"]
        emp_id = _uid(admin_token, "emp1_test")
        assert admin_id and emp_id

        r = requests.post(
            f"{API}/tasks", headers=_h(admin_token),
            json={"title": "SELFMULTI_TEST_creator_included",
                  "assignee_user_ids": [admin_id, emp_id]},
        )
        assert r.status_code == 200, r.text
        task = r.json()
        tid = task["id"]
        try:
            ids = [a["user_id"] for a in task["assignees"]]
            assert admin_id in ids and emp_id in ids
            assert len(task["assignees"]) == 2
            for a in task["assignees"]:
                assert a["completed"] is False
            assert task["status"] != "done"

            # Creator sees it in scope=mine
            r = requests.get(f"{API}/tasks", headers=_h(admin_token),
                             params={"scope": "mine"})
            assert r.status_code == 200
            assert any(t["id"] == tid for t in r.json())

            # Creator toggles own completion → still pending (emp not done)
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(admin_token),
                json={"completed": True},
            )
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["status"] == "pending"
            self_row = next(a for a in body["assignees"] if a["user_id"] == admin_id)
            assert self_row["completed"] is True

            # Emp completes → now all done
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(emp_token),
                json={"completed": True},
            )
            assert r.status_code == 200
            assert r.json()["status"] == "done"
        finally:
            _delete(admin_token, tid)

    def test_only_self_multi_still_single_person(self, admin_token):
        me = _me(admin_token)
        admin_id = me["id"]
        r = requests.post(
            f"{API}/tasks", headers=_h(admin_token),
            json={"title": "SELFMULTI_TEST_only_self",
                  "assignee_user_ids": [admin_id]},
        )
        assert r.status_code == 200, r.text
        task = r.json()
        tid = task["id"]
        try:
            ids = [a["user_id"] for a in task["assignees"]]
            assert admin_id in ids
            # Creator's own completion should mark task done immediately.
            r = requests.post(
                f"{API}/tasks/{tid}/my-completion", headers=_h(admin_token),
                json={"completed": True},
            )
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "done"
        finally:
            _delete(admin_token, tid)

    def test_legacy_single_assignee_still_works(self, admin_token, emp_token):
        emp_id = _uid(admin_token, "emp1_test")
        r = requests.post(
            f"{API}/tasks", headers=_h(admin_token),
            json={"title": "SELFMULTI_TEST_legacy_single",
                  "assignee_user_id": emp_id},
        )
        assert r.status_code == 200, r.text
        task = r.json()
        tid = task["id"]
        try:
            # Legacy single-assignee path — task visible to emp.
            ts = requests.get(f"{API}/tasks", headers=_h(emp_token)).json()
            assert any(t["id"] == tid for t in ts)
        finally:
            _delete(admin_token, tid)
