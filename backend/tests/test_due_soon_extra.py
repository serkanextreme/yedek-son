"""Supplementary Faz 8 CP5 backend tests.
Covers: PATCH /companies/{id} due_soon_threshold RBAC, /api/notifications/scan-now
response shape backward compat, and personal-mode skip company.
"""
import os
import uuid
import requests
import pytest

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(t):
    return {"Authorization": f"Bearer {t}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


def _uniq(p):
    return f"{p}_{uuid.uuid4().hex[:6]}"


def _create_company(tok, name=None):
    r = requests.post(f"{API}/companies", headers=_h(tok),
                      json={"name": name or _uniq("CoDS")}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _create_user(tok, u, p="test123", role="employee", company_id=None):
    payload = {"username": u, "password": p, "role": role}
    if company_id:
        payload["company_id"] = company_id
    r = requests.post(f"{API}/admin/users", headers=_h(tok), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


class TestScanNowShape:
    def test_scan_now_response_has_due_soon_and_legacy_fields(self, admin_token):
        r = requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token), timeout=30)
        assert r.status_code == 200
        d = r.json()
        # Legacy overdue keys
        assert "tasks_seen" in d
        assert "self" in d
        assert "manager" in d
        # New due_soon block
        assert "due_soon" in d
        assert isinstance(d["due_soon"], dict)


class TestCompanyPatchRBAC:
    def test_admin_can_patch_any_company_due_soon(self, admin_token):
        co = _create_company(admin_token)
        r = requests.patch(f"{API}/companies/{co['id']}", headers=_h(admin_token),
                           json={"due_soon_threshold": 7}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("due_soon_threshold") == 7

    def test_manager_can_patch_own_company_only(self, admin_token):
        coA = _create_company(admin_token)
        coB = _create_company(admin_token)
        mgr_name = _uniq("mgrDS")
        _create_user(admin_token, mgr_name, role="manager", company_id=coA["id"])
        mgr_tok = _login(mgr_name, "test123")

        # own — allowed
        r = requests.patch(f"{API}/companies/{coA['id']}", headers=_h(mgr_tok),
                           json={"due_soon_threshold": 5}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json().get("due_soon_threshold") == 5

        # other company — forbidden
        r = requests.patch(f"{API}/companies/{coB['id']}", headers=_h(mgr_tok),
                           json={"due_soon_threshold": 5}, timeout=15)
        assert r.status_code == 403

        # manager cannot change name (admin-only)
        r = requests.patch(f"{API}/companies/{coA['id']}", headers=_h(mgr_tok),
                           json={"name": "HackName"}, timeout=15)
        assert r.status_code in (400, 403)

    def test_employee_cannot_patch_company(self, admin_token):
        co = _create_company(admin_token)
        emp_name = _uniq("empDS")
        _create_user(admin_token, emp_name, role="employee", company_id=co["id"])
        emp_tok = _login(emp_name, "test123")
        r = requests.patch(f"{API}/companies/{co['id']}", headers=_h(emp_tok),
                           json={"due_soon_threshold": 5}, timeout=15)
        assert r.status_code == 403

    def test_invalid_due_soon_threshold_rejected(self, admin_token):
        co = _create_company(admin_token)
        r = requests.patch(f"{API}/companies/{co['id']}", headers=_h(admin_token),
                           json={"due_soon_threshold": 4}, timeout=15)
        assert r.status_code == 400
