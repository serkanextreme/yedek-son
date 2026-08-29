"""Extended RBAC/Süper Yönetici tests — supplements test_super_admin_hierarchy.py.

Covers items from the review request that the base file does not:
  * super-only endpoints: /admin/chat-prompt, /backup/status, /admin/users/{id}/impersonate
  * GET /admin/super-admins returns 200 for owner/super
  * admin caps: can_view_company_tasks toggles /api/team/members visibility
  * extra_company_ids grant expands visible_user_ids
  * non-owner super_admin (temp) cannot promote/revoke another super admin
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
API = f"{BASE_URL}/api"
OWNER = {"username": "serkan", "password": "19071987"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    return r.json().get("token") if r.status_code == 200 else None


def _h(tok):
    return {"Authorization": f"Bearer {tok}"} if tok else {}


@pytest.fixture(scope="module")
def owner_tok():
    tok = _login(OWNER)
    assert tok, "owner login failed"
    return tok


@pytest.fixture(scope="module")
def scenario(owner_tok):
    """Create isolated company + admin + employee + a SECOND company (for extra_company_ids)."""
    oh = _h(owner_tok)
    sfx = uuid.uuid4().hex[:6]
    cA = requests.post(f"{API}/companies", headers=oh, json={"name": f"RBACX-A-{sfx}"}, timeout=30).json()
    cB = requests.post(f"{API}/companies", headers=oh, json={"name": f"RBACX-B-{sfx}"}, timeout=30).json()
    admin_u = f"rbacx_admin_{sfx}"
    emp_u = f"rbacx_emp_{sfx}"
    emp_b_u = f"rbacx_empB_{sfx}"
    pw = "rbactest12345"
    admin = requests.post(f"{API}/admin/users", headers=oh,
                          json={"username": admin_u, "password": pw, "role": "admin",
                                "company_id": cA["id"]}, timeout=30).json()
    emp = requests.post(f"{API}/admin/users", headers=oh,
                        json={"username": emp_u, "password": pw, "role": "employee",
                              "company_id": cA["id"]}, timeout=30).json()
    empB = requests.post(f"{API}/admin/users", headers=oh,
                         json={"username": emp_b_u, "password": pw, "role": "employee",
                               "company_id": cB["id"]}, timeout=30).json()
    data = {
        "cA": cA["id"], "cB": cB["id"],
        "admin_id": admin["id"], "emp_id": emp["id"], "empB_id": empB["id"],
        "admin_u": admin_u, "emp_u": emp_u, "empB_u": emp_b_u, "pw": pw,
    }
    yield data
    fresh = _h(_login(OWNER))
    for uid in (admin["id"], emp["id"], empB["id"]):
        try:
            requests.delete(f"{API}/admin/users/{uid}?mode=hard", headers=fresh, timeout=30)
        except Exception:
            pass


# ------- 1. super-only endpoints not in base file -------

def test_extra_super_only_endpoints(owner_tok, scenario):
    at = _login({"username": scenario["admin_u"], "password": scenario["pw"]})
    ah = _h(at)
    # chat-prompt (admin config), backup status, impersonate someone
    r1 = requests.get(f"{API}/admin/chat-prompt", headers=ah, timeout=30)
    assert r1.status_code == 403, f"chat-prompt admin got {r1.status_code}"
    r2 = requests.get(f"{API}/backup/status", headers=ah, timeout=30)
    assert r2.status_code in (403, 404), f"backup/status admin got {r2.status_code}"
    r3 = requests.post(f"{API}/admin/users/{scenario['emp_id']}/impersonate", headers=ah, timeout=30)
    assert r3.status_code == 403, f"impersonate admin got {r3.status_code}"
    # owner allowed
    oh = _h(owner_tok)
    assert requests.get(f"{API}/admin/chat-prompt", headers=oh, timeout=30).status_code == 200


def test_owner_can_list_super_admins(owner_tok):
    r = requests.get(f"{API}/admin/super-admins", headers=_h(owner_tok), timeout=30)
    assert r.status_code == 200
    data = r.json()
    supers = data if isinstance(data, list) else data.get("super_admins", [])
    usernames = {u.get("username") for u in supers}
    assert "serkan" in usernames


# ------- 2. can_view_company_tasks cap toggles /team/members visibility -------

def test_view_company_tasks_cap_toggles_team_visibility(owner_tok, scenario):
    oh = _h(owner_tok)
    # Ensure cap OFF first
    requests.patch(f"{API}/admin/users/{scenario['admin_id']}/admin-caps", headers=oh,
                   json={"can_view_company_tasks": False}, timeout=30)
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    r_off = requests.get(f"{API}/team/members", headers=ah, timeout=30)
    assert r_off.status_code == 200
    off_ids = {m["id"] for m in r_off.json()}
    assert scenario["emp_id"] not in off_ids, "cap OFF: admin should NOT see company member in /team/members"

    # Toggle ON
    requests.patch(f"{API}/admin/users/{scenario['admin_id']}/admin-caps", headers=oh,
                   json={"can_view_company_tasks": True}, timeout=30)
    ah2 = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    r_on = requests.get(f"{API}/team/members", headers=ah2, timeout=30)
    assert r_on.status_code == 200
    on_ids = {m["id"] for m in r_on.json()}
    assert scenario["emp_id"] in on_ids, "cap ON: admin should see own-company employee"


# ------- 3. extra_company_ids grants visibility to a SECOND company -------

def test_extra_company_ids_extends_admin_scope(owner_tok, scenario):
    oh = _h(owner_tok)
    # baseline: admin does NOT see empB (different company)
    requests.patch(f"{API}/admin/users/{scenario['admin_id']}/admin-caps", headers=oh,
                   json={"extra_company_ids": []}, timeout=30)
    ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    users_before = {u["username"] for u in requests.get(f"{API}/admin/users", headers=ah, timeout=30).json()}
    assert scenario["empB_u"] not in users_before

    # grant extra_company_ids = [cB]
    requests.patch(f"{API}/admin/users/{scenario['admin_id']}/admin-caps", headers=oh,
                   json={"extra_company_ids": [scenario["cB"]]}, timeout=30)
    ah2 = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
    users_after = {u["username"] for u in requests.get(f"{API}/admin/users", headers=ah2, timeout=30).json()}
    assert scenario["empB_u"] in users_after, f"extra_company_ids should expand scope, got {users_after}"


# ------- 4. temp super admin (NON-owner) cannot promote/revoke another super -------

def test_non_owner_super_cannot_promote(owner_tok, scenario):
    oh = _h(owner_tok)
    aid = scenario["admin_id"]
    # promote admin -> temp super
    r = requests.post(f"{API}/admin/users/{aid}/super-admin", headers=oh, json={"hours": 1}, timeout=30)
    assert r.status_code == 200
    try:
        ah = _h(_login({"username": scenario["admin_u"], "password": scenario["pw"]}))
        # Now this temp super tries to promote empB
        r2 = requests.post(f"{API}/admin/users/{scenario['empB_id']}/super-admin",
                           headers=ah, json={"hours": 1}, timeout=30)
        assert r2.status_code == 403, f"temp super should NOT be able to promote another user, got {r2.status_code}"
        # And cannot revoke itself either (owner-only)
        r3 = requests.delete(f"{API}/admin/users/{aid}/super-admin", headers=ah, timeout=30)
        assert r3.status_code == 403
    finally:
        # revert
        oh2 = _h(_login(OWNER))
        requests.delete(f"{API}/admin/users/{aid}/super-admin", headers=oh2, timeout=30)
