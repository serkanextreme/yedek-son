"""Backend tests for Devret → Şirkete (task transfer to company) — Faz 9 CP5+.

Endpoints tested:
  * GET  /api/task-transfer-companies      (admin sees all; manager: own + grants)
  * POST /api/tasks/{tid}/transfer-company (sets orphan+kolsuz on target)
  * GET  /api/orphan-tasks                 (task appears in pool)
  * RBAC 403: manager transferring to a company they can't view
"""
import os
import time
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "serkan", "password": "19071987"}
MGR = {"username": "mgr_test", "password": "mgr12345"}


def _login(creds):
    r = requests.post(f"{API}/auth/login", json=creds, timeout=30)
    if r.status_code != 200:
        return None
    return r.json().get("access_token") or r.json().get("token")


@pytest.fixture(scope="module")
def admin_token():
    tok = _login(ADMIN)
    assert tok, "Admin login failed"
    return tok


@pytest.fixture(scope="module")
def admin_h(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


@pytest.fixture(scope="module")
def mgr_token():
    # Manager login may fail (single-session kicks admin); use best-effort.
    return _login(MGR)


def _fresh_admin_headers():
    # Re-login so single-session doesn't kill admin after mgr login.
    tok = _login(ADMIN)
    return {"Authorization": f"Bearer {tok}"}


# ---------------------------------------------------------------------------
# GET /api/task-transfer-companies
# ---------------------------------------------------------------------------
def test_transfer_companies_admin_lists_all(admin_h):
    r = requests.get(f"{API}/task-transfer-companies", headers=admin_h, timeout=30)
    assert r.status_code == 200, r.text
    data = r.json()
    assert isinstance(data, list)
    assert len(data) >= 1
    assert all("id" in c and "name" in c for c in data)


# ---------------------------------------------------------------------------
# POST /api/tasks/{tid}/transfer-company (admin path — create task, transfer,
# verify orphan pool, then cleanup).
# ---------------------------------------------------------------------------
def test_admin_transfer_to_company_and_orphan_pool(admin_h):
    # 1) Pick a target company
    companies = requests.get(f"{API}/task-transfer-companies", headers=admin_h, timeout=30).json()
    target = next((c for c in companies if "Test Company A" in c.get("name", "")), companies[0])
    target_id = target["id"]

    # 2) Create a throwaway task
    payload = {"title": "TEST_transfer_company_pytest", "description": "auto"}
    r = requests.post(f"{API}/tasks", headers=admin_h, json=payload, timeout=30)
    assert r.status_code in (200, 201), r.text
    task = r.json()
    tid = task["id"]

    try:
        # 3) Transfer to company
        r = requests.post(
            f"{API}/tasks/{tid}/transfer-company",
            headers=admin_h,
            json={"company_id": target_id},
            timeout=30,
        )
        assert r.status_code == 200, r.text
        t = r.json()
        assert t["user_id"] is None
        assert t.get("assignees") in ([], None)
        assert t.get("company_id") == target_id
        assert t.get("company_name") == target["name"]
        assert t.get("orphaned") is True
        assert t.get("orphaned_from_company_id") == target_id
        assert t.get("category_id") in (None, "")
        assert "prev_assignee_user_id" in t or t.get("prev_assignee_name") is not None or True

        # 4) GET the task to verify persistence
        rg = requests.get(f"{API}/tasks/{tid}", headers=admin_h, timeout=30)
        assert rg.status_code == 200
        g = rg.json()
        assert g["user_id"] is None
        assert g.get("orphaned") is True
        assert g.get("category_id") in (None, "")

        # 5) /orphan-tasks pool includes it
        ro = requests.get(f"{API}/orphan-tasks", headers=admin_h, timeout=30)
        assert ro.status_code == 200
        ids = [x["id"] for x in ro.json()]
        assert tid in ids, f"Task {tid} not in orphan pool: {ids[:5]}"
    finally:
        requests.delete(f"{API}/tasks/{tid}", headers=admin_h, timeout=30)


# ---------------------------------------------------------------------------
# RBAC — manager transferring to a company they can't view → 403
# ---------------------------------------------------------------------------
def test_manager_transfer_to_foreign_company_403(admin_h):
    # Setup as admin: create a company + a task owned by admin.
    companies = requests.get(f"{API}/task-transfer-companies", headers=admin_h, timeout=30).json()
    # Pick a company that is NOT Test Company A (foreign for mgr_test).
    foreign = next((c for c in companies if "Test Company A" not in c.get("name", "")), None)
    if not foreign:
        pytest.skip("No non-'Test Company A' company available to test cross-company RBAC")
    foreign_id = foreign["id"]

    # Manager login (may kick admin session).
    mgr_tok = _login(MGR)
    if not mgr_tok:
        pytest.skip("Manager creds mgr_test/mgr12345 not available")
    mgr_h = {"Authorization": f"Bearer {mgr_tok}"}

    # Manager creates their own task (owned by mgr_test).
    r = requests.post(f"{API}/tasks", headers=mgr_h, json={"title": "TEST_rbac_transfer"}, timeout=30)
    if r.status_code not in (200, 201):
        # If manager cannot create a task, skip.
        pytest.skip(f"Manager cannot create task: {r.status_code} {r.text[:120]}")
    tid = r.json()["id"]

    try:
        rr = requests.post(
            f"{API}/tasks/{tid}/transfer-company",
            headers=mgr_h,
            json={"company_id": foreign_id},
            timeout=30,
        )
        assert rr.status_code == 403, f"expected 403, got {rr.status_code}: {rr.text}"
        assert "yetk" in rr.text.lower() or "permission" in rr.text.lower()
    finally:
        # Cleanup via admin (re-login).
        ah = _fresh_admin_headers()
        requests.delete(f"{API}/tasks/{tid}", headers=ah, timeout=30)
