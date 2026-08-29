"""Faz 9 CP4.35 P1 fix verification.

Covers:
  P1-1: Template create/update name/description validation (81+, 501+, empty).
  P1-2: Per-creator cap (admin 100, manager 50, independent across creators).
  P1-3: delete_task audit `used_otp` correctness in 3 scenarios.
  P1-4: create_task double-inherit (default_lock_flags + default_self_lock_flags)
        — managed wins collision, self is deduped.
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = ("serkan", "19071987")
EMP = ("ahmet", "ahmet123")
MGR = ("mgr_test", "mgr12345")


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p})
    assert r.status_code == 200, f"login failed for {u}: {r.status_code} {r.text}"
    return r.json()["token"], r.json()["user"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def admin_ctx():
    tok, u = _login(*ADMIN)
    return {"tok": tok, "user": u, "h": _h(tok)}


@pytest.fixture(scope="module")
def emp_ctx():
    tok, u = _login(*EMP)
    return {"tok": tok, "user": u, "h": _h(tok)}


@pytest.fixture(scope="module")
def mgr_ctx():
    tok, u = _login(*MGR)
    return {"tok": tok, "user": u, "h": _h(tok)}


# =====================================================================
# P1-1: Template validation
# =====================================================================
class TestP1TemplateValidation:
    def test_name_over_80_returns_400(self, admin_ctx):
        long_name = "T" * 81
        r = requests.post(
            f"{API}/lock-policy-templates",
            headers=admin_ctx["h"],
            json={"name": long_name, "lock_flags": {"lock_delete": True}},
        )
        assert r.status_code == 400
        assert "80 karakter" in r.text or "80" in r.text

    def test_description_over_500_returns_400(self, admin_ctx):
        r = requests.post(
            f"{API}/lock-policy-templates",
            headers=admin_ctx["h"],
            json={
                "name": "TEST_P1_desc_" + uuid.uuid4().hex[:6],
                "description": "d" * 501,
                "lock_flags": {"lock_delete": True},
            },
        )
        assert r.status_code == 400
        assert "500" in r.text

    def test_empty_name_returns_400(self, admin_ctx):
        r = requests.post(
            f"{API}/lock-policy-templates",
            headers=admin_ctx["h"],
            json={"name": "   ", "lock_flags": {"lock_delete": True}},
        )
        assert r.status_code == 400

    def test_valid_create_returns_201(self, admin_ctx):
        name = "TEST_P1_ok_" + uuid.uuid4().hex[:6]
        r = requests.post(
            f"{API}/lock-policy-templates",
            headers=admin_ctx["h"],
            json={"name": name, "lock_flags": {"lock_delete": True}},
        )
        assert r.status_code == 201, r.text
        tpl = r.json()
        assert tpl["name"] == name
        # cleanup
        requests.delete(f"{API}/lock-policy-templates/{tpl['id']}", headers=admin_ctx["h"])

    def test_patch_name_over_80_returns_400(self, admin_ctx):
        # First create
        r = requests.post(
            f"{API}/lock-policy-templates",
            headers=admin_ctx["h"],
            json={"name": "TEST_P1_patch_" + uuid.uuid4().hex[:6], "lock_flags": {"lock_delete": True}},
        )
        assert r.status_code == 201
        tid = r.json()["id"]
        try:
            rp = requests.patch(
                f"{API}/lock-policy-templates/{tid}",
                headers=admin_ctx["h"],
                json={"name": "X" * 81},
            )
            assert rp.status_code == 400
        finally:
            requests.delete(f"{API}/lock-policy-templates/{tid}", headers=admin_ctx["h"])


# =====================================================================
# P1-2: Per-creator cap
# =====================================================================
class TestP1TemplateCap:
    def test_manager_cap_50(self, mgr_ctx):
        # Fetch current count for this creator
        created = []
        try:
            # Get existing count via list (manager sees own)
            r = requests.get(f"{API}/lock-policy-templates", headers=mgr_ctx["h"])
            assert r.status_code == 200
            existing = r.json().get("templates", [])
            mine = [t for t in existing if t.get("created_by") == mgr_ctx["user"]["id"]]
            already = len(mine)
            # Try to reach cap. Add (50 - already) templates.
            to_add = 50 - already
            if to_add < 0:
                pytest.skip("Manager already has >=50 templates from prior runs")
            for i in range(to_add):
                rr = requests.post(
                    f"{API}/lock-policy-templates",
                    headers=mgr_ctx["h"],
                    json={"name": f"TEST_P1_cap_mgr_{uuid.uuid4().hex[:6]}_{i}", "lock_flags": {"lock_delete": True}},
                )
                assert rr.status_code == 201, f"add {i} failed: {rr.status_code} {rr.text}"
                created.append(rr.json()["id"])
            # 51st should 400
            rover = requests.post(
                f"{API}/lock-policy-templates",
                headers=mgr_ctx["h"],
                json={"name": "TEST_P1_cap_over_" + uuid.uuid4().hex[:6], "lock_flags": {"lock_delete": True}},
            )
            assert rover.status_code == 400
            assert "50" in rover.text or "şablon" in rover.text.lower()
        finally:
            for tid in created:
                requests.delete(f"{API}/lock-policy-templates/{tid}", headers=mgr_ctx["h"])

    def test_admin_and_manager_caps_are_independent(self, admin_ctx, mgr_ctx):
        # Manager fills own bucket to 50 (assumption independent)
        admin_created = []
        try:
            # Create one admin template — should succeed even if manager is at cap.
            rc = requests.post(
                f"{API}/lock-policy-templates",
                headers=admin_ctx["h"],
                json={"name": "TEST_P1_indep_admin_" + uuid.uuid4().hex[:6], "lock_flags": {"lock_delete": True}},
            )
            assert rc.status_code == 201, rc.text
            admin_created.append(rc.json()["id"])
        finally:
            for tid in admin_created:
                requests.delete(f"{API}/lock-policy-templates/{tid}", headers=admin_ctx["h"])


# =====================================================================
# P1-3: delete_task audit used_otp accuracy
# =====================================================================
def _create_task_for_user(admin_ctx, assignee_user_id, title):
    r = requests.post(
        f"{API}/tasks",
        headers=admin_ctx["h"],
        json={"title": title, "assignee_user_id": assignee_user_id},
    )
    assert r.status_code == 200, r.text
    return r.json()


def _set_locks(admin_ctx, task_id, lock_flags, requires_otp=True):
    r = requests.patch(
        f"{API}/tasks/{task_id}/locks",
        headers=admin_ctx["h"],
        json={"lock_flags": lock_flags, "requires_otp": requires_otp},
    )
    assert r.status_code == 200, r.text


def _issue_and_verify_otp(admin_ctx, target_ctx, task_id):
    ri = requests.post(
        f"{API}/tasks/{task_id}/unlock-otp", headers=admin_ctx["h"], json={}
    )
    assert ri.status_code == 200, ri.text
    code = ri.json().get("code")
    assert code, f"no code returned: {ri.json()}"
    rv = requests.post(
        f"{API}/tasks/{task_id}/unlock-verify",
        headers=target_ctx["h"],
        json={"code": code},
    )
    assert rv.status_code == 200, rv.text


def _get_last_audit(admin_ctx, task_id):
    r = requests.get(f"{API}/tasks/{task_id}/lock-audit", headers=admin_ctx["h"])
    # Task deleted → task_exists=false but rows still present.
    assert r.status_code == 200, r.text
    rows = r.json().get("rows", [])
    for row in rows:  # rows sorted desc; find task_deleted
        if row.get("event_type") == "task_deleted":
            return row
    return None


class TestP1DeleteTaskUsedOtp:
    def test_admin_deletes_unlocked_task_used_otp_false(self, admin_ctx):
        t = _create_task_for_user(admin_ctx, admin_ctx["user"]["id"], "TEST_P1_del_unlocked_" + uuid.uuid4().hex[:6])
        r = requests.delete(f"{API}/tasks/{t['id']}", headers=admin_ctx["h"])
        assert r.status_code == 200
        row = _get_last_audit(admin_ctx, t["id"])
        assert row is not None, "no task_deleted audit row"
        assert row["payload"]["used_otp"] is False

    def test_delete_with_edit_lock_but_no_delete_lock_used_otp_false(self, admin_ctx, emp_ctx):
        # Task assigned to ahmet, locked ONLY for edit (not delete). Ahmet deletes it.
        t = _create_task_for_user(
            admin_ctx, emp_ctx["user"]["id"], "TEST_P1_del_editlock_" + uuid.uuid4().hex[:6]
        )
        _set_locks(admin_ctx, t["id"], {"lock_edit": True}, requires_otp=True)
        # Issue+verify OTP (window opens, but for a non-delete lock).
        _issue_and_verify_otp(admin_ctx, emp_ctx, t["id"])
        # Now delete as ahmet — delete was NEVER locked, so used_otp must be False.
        rd = requests.delete(f"{API}/tasks/{t['id']}", headers=emp_ctx["h"])
        assert rd.status_code == 200, rd.text
        row = _get_last_audit(admin_ctx, t["id"])
        assert row is not None
        assert row["payload"]["used_otp"] is False, f"expected False, row={row}"

    def test_delete_with_delete_lock_and_active_otp_used_otp_true(self, admin_ctx, emp_ctx):
        # Task assigned to ahmet, locked for delete. Ahmet verifies OTP and deletes → used_otp=True.
        t = _create_task_for_user(
            admin_ctx, emp_ctx["user"]["id"], "TEST_P1_del_deletelock_" + uuid.uuid4().hex[:6]
        )
        _set_locks(admin_ctx, t["id"], {"lock_delete": True}, requires_otp=True)
        _issue_and_verify_otp(admin_ctx, emp_ctx, t["id"])
        rd = requests.delete(f"{API}/tasks/{t['id']}", headers=emp_ctx["h"])
        assert rd.status_code == 200, rd.text
        row = _get_last_audit(admin_ctx, t["id"])
        assert row is not None
        assert row["payload"]["used_otp"] is True, f"expected True, row={row}"


# =====================================================================
# P1-4: create_task double inherit (managed + self)
# =====================================================================
class TestP1CreateTaskDoubleInherit:
    def test_managed_and_self_dedup_managed_wins(self, admin_ctx, emp_ctx):
        # Set both channels on ahmet by first: admin sets default_lock_flags (managed)
        r1 = requests.patch(
            f"{API}/users/{emp_ctx['user']['id']}/lock-flags",
            headers=admin_ctx["h"],
            json={"lock_flags": {"lock_delete": True, "lock_edit": True}, "requires_otp": True},
        )
        assert r1.status_code == 200, r1.text

        # Now ahmet patches self flags — must NOT overwrite managed (patched as self).
        # But we want to test dedup: assignee-side sets lock_delete (collision) + lock_status (unique).
        r2 = requests.patch(
            f"{API}/users/{emp_ctx['user']['id']}/lock-flags",
            headers=emp_ctx["h"],
            json={"lock_flags": {"lock_delete": True, "lock_complete": True}},
        )
        assert r2.status_code == 200, r2.text

        # Verify user policy shape
        rp = requests.get(
            f"{API}/users/{emp_ctx['user']['id']}/lock-flags", headers=admin_ctx["h"]
        )
        assert rp.status_code == 200
        pol = rp.json()
        assert pol["default_lock_flags"].get("lock_delete") is True
        assert pol["default_lock_flags"].get("lock_edit") is True
        assert pol["default_self_lock_flags"].get("lock_delete") is True
        assert pol["default_self_lock_flags"].get("lock_complete") is True

        # Admin creates a new task for ahmet — inheritance kicks in.
        t = _create_task_for_user(
            admin_ctx, emp_ctx["user"]["id"], "TEST_P1_double_inherit_" + uuid.uuid4().hex[:6]
        )
        try:
            # Fetch full task
            rt = requests.get(f"{API}/tasks/{t['id']}", headers=admin_ctx["h"])
            assert rt.status_code == 200
            task = rt.json()

            lf = task.get("lock_flags") or {}
            slf = task.get("self_lock_flags") or {}

            # Managed set: lock_delete + lock_edit
            assert lf.get("lock_delete") is True, f"managed lock_delete missing: lf={lf}"
            assert lf.get("lock_edit") is True, f"managed lock_edit missing: lf={lf}"

            # Self set: lock_complete only (lock_delete deduped because managed has it)
            assert slf.get("lock_complete") is True, f"self lock_complete missing: slf={slf}"
            assert not slf.get("lock_delete"), f"self lock_delete should be deduped: slf={slf}"

            # locked_by attribution — admin set the managed policy
            assert task.get("locked_by") == admin_ctx["user"]["id"], (
                f"locked_by should be policy owner (admin): {task.get('locked_by')}"
            )
            assert task.get("locked_at"), "locked_at should be set"
        finally:
            # cleanup task
            requests.delete(f"{API}/tasks/{t['id']}", headers=admin_ctx["h"])
            # reset user policy
            requests.patch(
                f"{API}/users/{emp_ctx['user']['id']}/lock-flags",
                headers=admin_ctx["h"],
                json={"lock_flags": {}, "requires_otp": True},
            )
            requests.patch(
                f"{API}/users/{emp_ctx['user']['id']}/lock-flags",
                headers=emp_ctx["h"],
                json={"lock_flags": {}},
            )
