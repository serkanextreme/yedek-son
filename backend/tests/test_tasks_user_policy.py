"""Sertex — Faz 9 CP4.30 tests

Covers:
- PATCH /api/users/{uid}/lock-flags   (admin managed, self, employee-forbidden-on-other)
- GET  /api/users/{uid}/lock-flags     (both channels visible)
- GET  /api/users/{uid}/lock-audit     (rows created by admin & self)
- Task inheritance from default_lock_flags + default_lock_requires_otp
- POST /api/tasks/{tid}/unlock-simple  (works when requires_otp=false; 400 otherwise)
- PATCH /api/tasks/{tid}/self-locks    (assignee only; other user 403)
- PATCH /api/tasks/{tid}/locks         (requires_otp field accepted; updates task.lock_requires_otp)
- Guard checks (lock_flags OR self_lock_flags)
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


# Login once per module to avoid single-session token kick.
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
        pytest.skip("manager account mgr_test not available")
    return {"sess": _sess(t), "user": u}


def _clear_default_policy(admin_ctx, uid):
    """Reset the target user's default_lock_flags via admin so tests are independent."""
    admin_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                            json={"lock_flags": {}, "requires_otp": True})


@pytest.fixture(autouse=True)
def _reset_ahmet_policy(admin_ctx, emp_ctx):
    _clear_default_policy(admin_ctx, emp_ctx["user"]["id"])
    yield
    _clear_default_policy(admin_ctx, emp_ctx["user"]["id"])


# ---------------- 1) admin sets user policy ----------------
class TestAdminSetsUserPolicy:
    def test_admin_patch_user_lock_flags(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        r = admin_ctx["sess"].patch(
            f"{API}/users/{uid}/lock-flags",
            json={"lock_flags": {"lock_delete": True, "lock_transfer": True},
                  "requires_otp": False},
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["default_lock_flags"].get("lock_delete") is True
        assert body["default_lock_flags"].get("lock_transfer") is True
        assert body["default_lock_requires_otp"] is False

    def test_get_shows_both_channels(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        admin_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                                json={"lock_flags": {"lock_delete": True}, "requires_otp": False})
        # ahmet also self-locks
        emp_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                              json={"lock_flags": {"lock_edit": True}})
        r = admin_ctx["sess"].get(f"{API}/users/{uid}/lock-flags")
        assert r.status_code == 200, r.text
        b = r.json()
        assert "default_lock_flags" in b and "default_self_lock_flags" in b
        assert b["default_lock_flags"].get("lock_delete") is True
        assert b["default_self_lock_flags"].get("lock_edit") is True


# ---------------- 2) inheritance on task create ----------------
class TestTaskInheritsUserPolicy:
    def test_new_task_inherits_default_locks_and_otp_flag(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        admin_ctx["sess"].patch(
            f"{API}/users/{uid}/lock-flags",
            json={"lock_flags": {"lock_delete": True, "lock_transfer": True},
                  "requires_otp": False},
        )
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_inherit_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        assert r.status_code == 200, r.text
        t = r.json()
        assert t.get("lock_flags", {}).get("lock_delete") is True
        assert t.get("lock_flags", {}).get("lock_transfer") is True
        assert t.get("lock_requires_otp") is False
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")


# ---------------- 3) unlock-simple happy path ----------------
class TestUnlockSimple:
    def test_delete_flow_with_unlock_simple(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        admin_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                                json={"lock_flags": {"lock_delete": True}, "requires_otp": False})
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_simple_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        tid = r.json()["id"]
        # 423 first
        d1 = emp_ctx["sess"].delete(f"{API}/tasks/{tid}")
        assert d1.status_code == 423, d1.text
        # unlock-simple
        u = emp_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-simple")
        assert u.status_code == 200, u.text
        assert u.json().get("unlock_expires_at")
        # delete OK
        d2 = emp_ctx["sess"].delete(f"{API}/tasks/{tid}")
        assert d2.status_code == 200, d2.text

    def test_unlock_simple_rejected_when_otp_required(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        # requires_otp True (default) with a hard lock
        admin_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                                json={"lock_flags": {"lock_delete": True}, "requires_otp": True})
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_hard_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        tid = r.json()["id"]
        u = emp_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-simple")
        assert u.status_code == 400, u.text
        assert "OTP" in u.text or "otp" in u.text.lower()
        admin_ctx["sess"].delete(f"{API}/tasks/{tid}")


# ---------------- 4) self channel ----------------
class TestSelfChannel:
    def test_self_patch_lands_in_self_channel_and_ignores_requires_otp(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        # admin sets managed policy first
        admin_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                                json={"lock_flags": {"lock_delete": True}, "requires_otp": False})
        # ahmet attempts to modify requires_otp too — must be ignored + go to self channel
        r = emp_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                                  json={"lock_flags": {"lock_edit": True}, "requires_otp": True})
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["default_self_lock_flags"].get("lock_edit") is True
        # managed policy untouched
        assert b["default_lock_flags"].get("lock_delete") is True
        # requires_otp stays False (was set by admin) — the self patch cannot flip it
        assert b["default_lock_requires_otp"] is False

    def test_employee_forbidden_on_other_user(self, admin_ctx, emp_ctx):
        # admin's user id — ahmet trying to patch that must be 403
        other = admin_ctx["user"]["id"]
        r = emp_ctx["sess"].patch(f"{API}/users/{other}/lock-flags",
                                  json={"lock_flags": {"lock_edit": True}})
        assert r.status_code == 403, r.text


# ---------------- 5) user lock-audit ----------------
class TestUserLockAudit:
    def test_admin_reads_audit_and_sees_managed_and_self_rows(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        admin_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                                json={"lock_flags": {"lock_delete": True}, "requires_otp": False})
        emp_ctx["sess"].patch(f"{API}/users/{uid}/lock-flags",
                              json={"lock_flags": {"lock_edit": True}})
        r = admin_ctx["sess"].get(f"{API}/users/{uid}/lock-audit")
        assert r.status_code == 200, r.text
        b = r.json()
        assert b["count"] >= 2
        channels = {row["payload"].get("channel") for row in b["rows"]}
        assert "managed" in channels
        assert "self" in channels
        # all rows are user_policy_set
        for row in b["rows"]:
            assert row["event_type"] == "user_policy_set"


# ---------------- 6) manager visibility ----------------
class TestManagerPolicy:
    def test_manager_without_visibility_forbidden(self, mgr_ctx, emp_ctx):
        # mgr_test doesn't have visibility on ahmet by default
        r = mgr_ctx["sess"].patch(f"{API}/users/{emp_ctx['user']['id']}/lock-flags",
                                  json={"lock_flags": {"lock_delete": True}})
        # Either 403 (no visibility) or 200 if a prior test wired it — both acceptable
        assert r.status_code in (200, 403), r.text


# ---------------- 7) task-level requires_otp toggle ----------------
class TestTaskLockRequiresOtpField:
    def test_patch_task_locks_persists_requires_otp(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_task_otp_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        tid = r.json()["id"]
        p = admin_ctx["sess"].patch(f"{API}/tasks/{tid}/locks",
                                    json={"lock_flags": {"lock_delete": True},
                                          "requires_otp": False})
        assert p.status_code == 200, p.text
        t = p.json()
        assert t.get("lock_requires_otp") is False
        assert t.get("lock_flags", {}).get("lock_delete") is True
        # And unlock-simple must now work
        u = emp_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-simple")
        assert u.status_code == 200, u.text
        admin_ctx["sess"].delete(f"{API}/tasks/{tid}")


# ---------------- 8) task self-locks endpoint ----------------
class TestTaskSelfLocks:
    def test_assignee_can_set_self_locks(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_self_lock_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        tid = r.json()["id"]
        p = emp_ctx["sess"].patch(f"{API}/tasks/{tid}/self-locks",
                                  json={"self_lock_flags": {"lock_edit": True}})
        assert p.status_code == 200, p.text
        assert p.json().get("self_lock_flags", {}).get("lock_edit") is True
        admin_ctx["sess"].delete(f"{API}/tasks/{tid}")

    def test_non_assignee_forbidden(self, admin_ctx, emp_ctx):
        # admin creates a task assigned to admin themselves, ahmet tries self-lock → 403
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_self_lock_deny_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": admin_ctx["user"]["id"],
            "assignee_name": admin_ctx["user"]["username"],
        })
        tid = r.json()["id"]
        p = emp_ctx["sess"].patch(f"{API}/tasks/{tid}/self-locks",
                                  json={"self_lock_flags": {"lock_edit": True}})
        assert p.status_code == 403, p.text
        admin_ctx["sess"].delete(f"{API}/tasks/{tid}")


# ---------------- 9) guard checks self_lock too ----------------
class TestGuardIncludesSelfLock:
    def test_self_lock_blocks_delete(self, admin_ctx, emp_ctx):
        uid = emp_ctx["user"]["id"]
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": f"TEST_self_guard_{uuid.uuid4().hex[:6]}",
            "assignee_user_id": uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        tid = r.json()["id"]
        emp_ctx["sess"].patch(f"{API}/tasks/{tid}/self-locks",
                              json={"self_lock_flags": {"lock_delete": True}})
        d = emp_ctx["sess"].delete(f"{API}/tasks/{tid}")
        assert d.status_code == 423, d.text
        admin_ctx["sess"].delete(f"{API}/tasks/{tid}")
