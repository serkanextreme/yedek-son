"""Faz 9 CP4.23 — Task Category Visibility E2E test.

Verifies that categories owned by Company A are hidden from an
employee in Company B by default, then appear via user-grant, then
via company-grant, and finally disappear again after revoke.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/") or "https://functional-themes.preview.emergentagent.com"
ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"


def _admin_token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": ADMIN_USER, "password": ADMIN_PASS}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_tok():
    return _admin_token()


@pytest.fixture(scope="module")
def seeded(admin_tok):
    tag = uuid.uuid4().hex[:6]
    h = _h(admin_tok)
    # Create two companies
    ca = requests.post(f"{BASE_URL}/api/companies", json={"name": f"TEST_CoA_{tag}"}, headers=h).json()
    cb = requests.post(f"{BASE_URL}/api/companies", json={"name": f"TEST_CoB_{tag}"}, headers=h).json()
    ca_id = ca.get("id") or ca.get("_id")
    cb_id = cb.get("id") or cb.get("_id")
    assert ca_id and cb_id, (ca, cb)

    # Create employee in company B
    emp_username = f"test_emp_{tag}"
    emp_password = "emp12345"
    u = requests.post(
        f"{BASE_URL}/api/admin/users",
        json={"username": emp_username, "password": emp_password, "role": "employee", "company_id": cb_id},
        headers=h,
    )
    assert u.status_code in (200, 201), u.text
    emp = u.json()
    emp_id = emp.get("id") or emp.get("_id")

    # Grant a license (needed to hit licensed endpoints)
    lic = requests.post(f"{BASE_URL}/api/admin/licenses/generate",
                       json={"type": "trial", "count": 1, "notes": "TEST_catvis"},
                       headers=h)
    assert lic.status_code == 200, lic.text
    key = lic.json()["licenses"][0]["key"]

    # Login as employee
    lr = requests.post(f"{BASE_URL}/api/auth/login", json={"username": emp_username, "password": emp_password})
    assert lr.status_code == 200, lr.text
    emp_tok = lr.json()["token"]

    # Redeem license
    rr = requests.post(f"{BASE_URL}/api/license/redeem", json={"key": key}, headers=_h(emp_tok))
    assert rr.status_code == 200, rr.text

    # Create a category owned by company A
    cat_name = f"TEST_CatA_{tag}"
    cr = requests.post(
        f"{BASE_URL}/api/task-categories",
        json={"name": cat_name, "company_id": ca_id},
        headers=h,
    )
    assert cr.status_code in (200, 201), cr.text
    cat = cr.json()
    cat_id = cat.get("id") or cat.get("_id")

    yield {
        "ca_id": ca_id, "cb_id": cb_id,
        "emp_id": emp_id, "emp_tok": emp_tok,
        "cat_id": cat_id, "cat_name": cat_name,
        "admin_h": h,
    }

    # Cleanup
    try:
        requests.delete(f"{BASE_URL}/api/task-categories/{cat_id}", headers=h)
    except Exception:
        pass
    try:
        requests.delete(f"{BASE_URL}/api/admin/users/{emp_id}?mode=hard", headers=h)
    except Exception:
        pass


def _list_my_tasks(tok):
    r = requests.get(f"{BASE_URL}/api/task-categories?scope=my_tasks", headers=_h(tok))
    assert r.status_code == 200, r.text
    return r.json()


def test_default_hidden(seeded):
    cats = _list_my_tasks(seeded["emp_tok"])
    names = [c.get("name") for c in cats]
    assert seeded["cat_name"] not in names, f"Cat should be hidden by default, got {names}"


def test_user_grant_makes_visible(seeded):
    h = seeded["admin_h"]
    r = requests.patch(
        f"{BASE_URL}/api/task-categories/{seeded['cat_id']}",
        json={"visible_to_user_ids": [seeded["emp_id"]]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert seeded["emp_id"] in body.get("visible_to_user_ids", [])

    cats = _list_my_tasks(seeded["emp_tok"])
    names = [c.get("name") for c in cats]
    assert seeded["cat_name"] in names


def test_company_grant_after_user_revoke(seeded):
    h = seeded["admin_h"]
    # Revoke user grant, add company grant
    r = requests.patch(
        f"{BASE_URL}/api/task-categories/{seeded['cat_id']}",
        json={"visible_to_user_ids": [], "visible_to_company_ids": [seeded["cb_id"]]},
        headers=h,
    )
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("visible_to_user_ids") == []
    assert seeded["cb_id"] in body.get("visible_to_company_ids", [])

    cats = _list_my_tasks(seeded["emp_tok"])
    names = [c.get("name") for c in cats]
    assert seeded["cat_name"] in names, f"Cat should be visible via company grant, got {names}"


def test_full_revoke_hides_again(seeded):
    h = seeded["admin_h"]
    r = requests.patch(
        f"{BASE_URL}/api/task-categories/{seeded['cat_id']}",
        json={"visible_to_user_ids": [], "visible_to_company_ids": []},
        headers=h,
    )
    assert r.status_code == 200, r.text

    cats = _list_my_tasks(seeded["emp_tok"])
    names = [c.get("name") for c in cats]
    assert seeded["cat_name"] not in names


def test_scope_manage_admin_sees_all(admin_tok, seeded):
    r = requests.get(f"{BASE_URL}/api/task-categories?scope=manage", headers=_h(admin_tok))
    assert r.status_code == 200, r.text
    cats = r.json()
    names = [c.get("name") for c in cats]
    assert seeded["cat_name"] in names
    # Verify new fields exist on returned model
    match = [c for c in cats if c.get("name") == seeded["cat_name"]][0]
    assert "visible_to_company_ids" in match
    assert "visible_to_user_ids" in match
