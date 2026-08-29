"""iteration_42 — workspace_mode + task ownership metadata + admin company field/grouping.

Covers:
  - Task model: assignee_name + company_name optional on POST/PATCH/GET
  - workspace_mode: login/me responses + PUT /api/settings/workspace-mode
  - Admin: /admin/companies GET + admin_create_user + admin_update_user company_name flow
"""
import os
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "http://localhost:8001").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
STD_USER = "ahmet"
STD_PASS = "ahmet123"


# ---------- fixtures ----------
@pytest.fixture(scope="module")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def user_token_and_login_body():
    r = requests.post(f"{API}/auth/login", json={"username": STD_USER, "password": STD_PASS})
    assert r.status_code == 200, r.text
    body = r.json()
    return body["token"], body


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _find_user(admin_tok, username):
    r = requests.get(f"{API}/admin/users", headers=_h(admin_tok))
    assert r.status_code == 200, r.text
    body = r.json()
    users = body if isinstance(body, list) else body.get("users", [])
    for u in users:
        if isinstance(u, dict) and u.get("username") == username:
            return u
    return None


# =====================================================================
# 1) workspace_mode: login/me/PUT
# =====================================================================
class TestWorkspaceMode:
    def test_login_returns_workspace_mode(self, user_token_and_login_body):
        _, body = user_token_and_login_body
        assert "user" in body
        assert "workspace_mode" in body["user"], f"login response missing user.workspace_mode: {body['user']}"
        assert body["user"]["workspace_mode"] in ("personal", "team")

    def test_me_returns_workspace_mode(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        r = requests.get(f"{API}/auth/me", headers=_h(tok))
        assert r.status_code == 200
        me = r.json()
        assert "workspace_mode" in me
        assert me["workspace_mode"] in ("personal", "team")

    def test_put_workspace_mode_team_then_personal(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        # set to team
        r = requests.put(f"{API}/settings/workspace-mode", headers=_h(tok), json={"workspace_mode": "team"})
        assert r.status_code == 200, r.text
        assert r.json().get("workspace_mode") == "team"
        # verify persisted via /me
        me = requests.get(f"{API}/auth/me", headers=_h(tok)).json()
        assert me["workspace_mode"] == "team"
        # reset to personal
        r = requests.put(f"{API}/settings/workspace-mode", headers=_h(tok), json={"workspace_mode": "personal"})
        assert r.status_code == 200
        me2 = requests.get(f"{API}/auth/me", headers=_h(tok)).json()
        assert me2["workspace_mode"] == "personal"

    def test_put_workspace_mode_invalid_400(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        r = requests.put(f"{API}/settings/workspace-mode", headers=_h(tok), json={"workspace_mode": "invalid"})
        assert r.status_code == 400

    def test_put_workspace_mode_unauth_401(self):
        r = requests.put(f"{API}/settings/workspace-mode", json={"workspace_mode": "team"})
        assert r.status_code in (401, 403)


# =====================================================================
# 2) Task model: assignee_name + company_name
# =====================================================================
class TestTaskOwnershipFields:
    created_ids: list = []

    def test_create_task_with_owner_fields(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        payload = {
            "title": "TEST_owner_task_1",
            "description": "iteration_42 owner fields",
            "assignee_name": "TestAhmet",
            "company_name": "TestCorp",
        }
        r = requests.post(f"{API}/tasks", headers=_h(tok), json=payload)
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["title"] == payload["title"]
        assert t.get("assignee_name") == "TestAhmet"
        assert t.get("company_name") == "TestCorp"
        assert "id" in t
        TestTaskOwnershipFields.created_ids.append(t["id"])

    def test_create_task_without_owner_fields(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        payload = {"title": "TEST_owner_task_2", "description": ""}
        r = requests.post(f"{API}/tasks", headers=_h(tok), json=payload)
        assert r.status_code == 200
        t = r.json()
        # Optional fields: should be None or absent
        assert t.get("assignee_name") in (None, "")
        assert t.get("company_name") in (None, "")
        TestTaskOwnershipFields.created_ids.append(t["id"])

    def test_patch_task_add_owner_fields(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        tid = TestTaskOwnershipFields.created_ids[1]
        r = requests.patch(f"{API}/tasks/{tid}", headers=_h(tok),
                           json={"assignee_name": "UpdatedName", "company_name": "UpdCorp"})
        assert r.status_code == 200, r.text
        t = r.json()
        assert t.get("assignee_name") == "UpdatedName"
        assert t.get("company_name") == "UpdCorp"

    def test_list_tasks_still_works(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        r = requests.get(f"{API}/tasks", headers=_h(tok))
        assert r.status_code == 200
        data = r.json()
        # Accept either list or {tasks: [...]} shape
        arr = data if isinstance(data, list) else data.get("tasks", [])
        # Our created titles must be present
        titles = [t.get("title") for t in arr]
        assert "TEST_owner_task_1" in titles

    def test_patch_task_status_still_works(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        tid = TestTaskOwnershipFields.created_ids[0]
        r = requests.patch(f"{API}/tasks/{tid}", headers=_h(tok), json={"status": "done"})
        assert r.status_code == 200
        assert r.json().get("status") == "done"

    def test_cleanup_created_tasks(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        for tid in TestTaskOwnershipFields.created_ids:
            requests.delete(f"{API}/tasks/{tid}", headers=_h(tok))


# =====================================================================
# 3) Admin /admin/companies + company_name on user
# =====================================================================
class TestAdminCompanies:
    def test_admin_companies_requires_admin(self, user_token_and_login_body):
        tok, _ = user_token_and_login_body
        r = requests.get(f"{API}/admin/companies", headers=_h(tok))
        assert r.status_code == 403

    def test_admin_companies_returns_list(self, admin_token):
        r = requests.get(f"{API}/admin/companies", headers=_h(admin_token))
        assert r.status_code == 200
        body = r.json()
        assert "companies" in body
        assert isinstance(body["companies"], list)

    def test_admin_update_user_company_flow(self, admin_token):
        ahmet = _find_user(admin_token, STD_USER)
        assert ahmet is not None, "ahmet not found"
        uid = ahmet["id"]

        # baseline company list
        base_companies = set(requests.get(f"{API}/admin/companies", headers=_h(admin_token)).json()["companies"])

        # 1) assign 'TEST_AcmeLtd'
        r = requests.patch(f"{API}/admin/users/{uid}", headers=_h(admin_token),
                           json={"company_name": "TEST_AcmeLtd"})
        assert r.status_code == 200, r.text

        # verify via GET users
        u = _find_user(admin_token, STD_USER)
        assert u.get("company_name") == "TEST_AcmeLtd"

        # verify /admin/companies contains it
        companies_now = set(requests.get(f"{API}/admin/companies", headers=_h(admin_token)).json()["companies"])
        assert "TEST_AcmeLtd" in companies_now

        # 2) rename to 'TEST_NewCorp'
        r = requests.patch(f"{API}/admin/users/{uid}", headers=_h(admin_token),
                           json={"company_name": "TEST_NewCorp"})
        assert r.status_code == 200
        u = _find_user(admin_token, STD_USER)
        assert u.get("company_name") == "TEST_NewCorp"

        # 3) empty string → unset
        r = requests.patch(f"{API}/admin/users/{uid}", headers=_h(admin_token),
                           json={"company_name": ""})
        assert r.status_code == 200
        u = _find_user(admin_token, STD_USER)
        assert not u.get("company_name"), f"expected company_name removed, got {u.get('company_name')}"

        # verify companies list no longer includes those (unless someone else has them)
        companies_after = set(requests.get(f"{API}/admin/companies", headers=_h(admin_token)).json()["companies"])
        assert "TEST_NewCorp" not in companies_after
        assert "TEST_AcmeLtd" not in companies_after

    def test_non_admin_patch_forbidden(self, user_token_and_login_body, admin_token):
        tok, _ = user_token_and_login_body
        ahmet = _find_user(admin_token, STD_USER)
        r = requests.patch(f"{API}/admin/users/{ahmet['id']}", headers=_h(tok),
                           json={"company_name": "Whatever"})
        assert r.status_code == 403


# =====================================================================
# CLEANUP — restore ahmet to baseline
# =====================================================================
def test_zzz_cleanup_final_state(admin_token, user_token_and_login_body):
    """Final safety net: ensure ahmet has no company_name and workspace_mode=personal."""
    ahmet = _find_user(admin_token, STD_USER)
    assert ahmet is not None
    # Clear company
    requests.patch(f"{API}/admin/users/{ahmet['id']}", headers=_h(admin_token),
                   json={"company_name": ""})
    # Reset workspace_mode
    tok, _ = user_token_and_login_body
    requests.put(f"{API}/settings/workspace-mode", headers=_h(tok), json={"workspace_mode": "personal"})

    # Verify
    u = _find_user(admin_token, STD_USER)
    assert not u.get("company_name")
    me = requests.get(f"{API}/auth/me", headers=_h(tok)).json()
    assert me.get("workspace_mode") == "personal"
