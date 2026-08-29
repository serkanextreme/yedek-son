"""Sertex — Faz 9 CP4.33 tests: Lock Policy Templates

Covers:
- POST   /api/lock-policy-templates   (admin creates)
- GET    /api/lock-policy-templates   (admin/manager list; employee sees empty)
- POST   as employee → 403
- PATCH  /api/lock-policy-templates/{id}  admin OK; creator OK; other creator (non-admin) → 403
- DELETE /api/lock-policy-templates/{id}  admin OK; creator OK; others → 403
- Empty name on create/patch → 400
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_USER, ADMIN_PASS = "serkan", "19071987"
EMP_USER, EMP_PASS = "ahmet", "ahmet123"
MGR_USER, MGR_PASS = "mgr_test", "mgr12345"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, f"login {u} → {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]


def _sess(tok):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin_ctx():
    t, u = _login(ADMIN_USER, ADMIN_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture(scope="module")
def emp_ctx():
    t, u = _login(EMP_USER, EMP_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture(scope="module")
def mgr_ctx():
    try:
        t, u = _login(MGR_USER, MGR_PASS)
    except AssertionError:
        pytest.skip("manager mgr_test not available")
    return {"sess": _sess(t), "user": u}


def _cleanup(admin_sess, tpl_id):
    try:
        admin_sess.delete(f"{API}/lock-policy-templates/{tpl_id}", timeout=15)
    except Exception:
        pass


class TestCreate:
    def test_admin_creates_template(self, admin_ctx):
        name = f"TEST_TPL_{uuid.uuid4().hex[:6]}"
        r = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": name,
            "description": "auto",
            "lock_flags": {"lock_edit": True, "lock_delete": True, "lock_bogus": True},
            "requires_otp": True,
        }, timeout=20)
        # response_model=LockPolicyTemplate → 200 (FastAPI default) unless explicitly 201
        assert r.status_code in (200, 201), r.text
        body = r.json()
        assert body["name"] == name
        assert body["lock_flags"].get("lock_edit") is True
        assert body["lock_flags"].get("lock_delete") is True
        # bogus keys must be stripped (whitelist)
        assert "lock_bogus" not in body["lock_flags"]
        assert body["requires_otp"] is True
        assert body.get("created_by") == admin_ctx["user"]["id"]
        assert "id" in body and isinstance(body["id"], str)
        _cleanup(admin_ctx["sess"], body["id"])

    def test_empty_name_returns_400(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": "   ",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        assert r.status_code == 400, r.text

    def test_employee_cannot_create(self, emp_ctx):
        r = emp_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": "TEST_TPL_emp_forbid",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        assert r.status_code == 403, r.text


class TestList:
    def test_admin_sees_templates(self, admin_ctx):
        name = f"TEST_TPL_L_{uuid.uuid4().hex[:6]}"
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": name, "lock_flags": {"lock_edit": True},
        }, timeout=20)
        assert c.status_code in (200, 201)
        tpl_id = c.json()["id"]
        try:
            r = admin_ctx["sess"].get(f"{API}/lock-policy-templates", timeout=20)
            assert r.status_code == 200
            body = r.json()
            assert "templates" in body and "count" in body
            assert body["count"] == len(body["templates"])
            assert any(t["id"] == tpl_id for t in body["templates"])
        finally:
            _cleanup(admin_ctx["sess"], tpl_id)

    def test_employee_sees_empty_list(self, emp_ctx):
        r = emp_ctx["sess"].get(f"{API}/lock-policy-templates", timeout=20)
        assert r.status_code == 200
        body = r.json()
        assert body["count"] == 0
        assert body["templates"] == []

    def test_manager_can_list(self, mgr_ctx):
        r = mgr_ctx["sess"].get(f"{API}/lock-policy-templates", timeout=20)
        assert r.status_code == 200
        # manager sees the (global) list, whatever it is
        assert "templates" in r.json()


class TestPatch:
    def test_admin_updates_template(self, admin_ctx):
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_P_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        tpl_id = c.json()["id"]
        try:
            new_name = f"TEST_TPL_P_upd_{uuid.uuid4().hex[:4]}"
            r = admin_ctx["sess"].patch(f"{API}/lock-policy-templates/{tpl_id}", json={
                "name": new_name,
                "lock_flags": {"lock_delete": True},
                "requires_otp": False,
            }, timeout=20)
            assert r.status_code == 200, r.text
            body = r.json()
            assert body["name"] == new_name
            assert body["lock_flags"] == {"lock_delete": True}
            assert body["requires_otp"] is False
        finally:
            _cleanup(admin_ctx["sess"], tpl_id)

    def test_empty_name_patch_returns_400(self, admin_ctx):
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_PE_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        tpl_id = c.json()["id"]
        try:
            r = admin_ctx["sess"].patch(f"{API}/lock-policy-templates/{tpl_id}", json={"name": "   "}, timeout=20)
            assert r.status_code == 400, r.text
        finally:
            _cleanup(admin_ctx["sess"], tpl_id)

    def test_non_creator_non_admin_cannot_patch(self, admin_ctx, mgr_ctx):
        # Admin creates a template, manager (non-admin, non-creator) tries to patch → 403
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_PX_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        tpl_id = c.json()["id"]
        try:
            r = mgr_ctx["sess"].patch(f"{API}/lock-policy-templates/{tpl_id}", json={"name": "hack"}, timeout=20)
            assert r.status_code == 403, r.text
        finally:
            _cleanup(admin_ctx["sess"], tpl_id)

    def test_creator_manager_can_patch_own(self, mgr_ctx):
        c = mgr_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_M_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        assert c.status_code in (200, 201), c.text
        tpl_id = c.json()["id"]
        try:
            r = mgr_ctx["sess"].patch(f"{API}/lock-policy-templates/{tpl_id}", json={"description": "mgr updated"}, timeout=20)
            assert r.status_code == 200, r.text
            assert r.json()["description"] == "mgr updated"
        finally:
            # creator can delete own
            mgr_ctx["sess"].delete(f"{API}/lock-policy-templates/{tpl_id}", timeout=15)


class TestDelete:
    def test_admin_deletes(self, admin_ctx):
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_D_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        tpl_id = c.json()["id"]
        r = admin_ctx["sess"].delete(f"{API}/lock-policy-templates/{tpl_id}", timeout=20)
        assert r.status_code == 200, r.text
        assert r.json().get("deleted") == 1
        # verify gone
        lst = admin_ctx["sess"].get(f"{API}/lock-policy-templates", timeout=20).json()
        assert not any(t["id"] == tpl_id for t in lst["templates"])

    def test_non_creator_non_admin_cannot_delete(self, admin_ctx, mgr_ctx):
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_DX_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        tpl_id = c.json()["id"]
        try:
            r = mgr_ctx["sess"].delete(f"{API}/lock-policy-templates/{tpl_id}", timeout=20)
            assert r.status_code == 403, r.text
        finally:
            _cleanup(admin_ctx["sess"], tpl_id)

    def test_employee_cannot_delete(self, admin_ctx, emp_ctx):
        c = admin_ctx["sess"].post(f"{API}/lock-policy-templates", json={
            "name": f"TEST_TPL_DE_{uuid.uuid4().hex[:6]}",
            "lock_flags": {"lock_edit": True},
        }, timeout=20)
        tpl_id = c.json()["id"]
        try:
            r = emp_ctx["sess"].delete(f"{API}/lock-policy-templates/{tpl_id}", timeout=20)
            assert r.status_code == 403, r.text
        finally:
            _cleanup(admin_ctx["sess"], tpl_id)
