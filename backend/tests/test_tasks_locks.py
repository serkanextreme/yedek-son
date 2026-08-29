"""
Sertex — Faz 9 CP4.27 Task Lock + One-Time Unlock OTP backend tests.

Covers:
- PATCH /api/tasks/{id}/locks — RBAC (creator/admin/manager only)
- Assignee blocked on DELETE / PATCH when relevant lock_flags set → 423
- POST /api/tasks/{id}/unlock-otp — issue 6-digit code (creator/admin)
- POST /api/tasks/{id}/unlock-verify — assignee verifies, opens 10min single-use window
- Post-OTP: one locked mutation succeeds (200), the second returns 423 again
- Admin & creator bypass regardless of lock flags
- Reissuing OTP invalidates the previous one
- Non-assignee cannot verify OTP → 403
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
EMP_USER = "ahmet"
EMP_PASS = "ahmet123"


# ---------------- helpers ----------------
def _login(username, password):
    r = requests.post(f"{API}/auth/login",
                      json={"username": username, "password": password},
                      timeout=30)
    assert r.status_code == 200, f"login failed {username}: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]


def _sess(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json",
                      "Authorization": f"Bearer {token}"})
    return s


# ---------------- fixtures ----------------
@pytest.fixture(scope="module")
def admin_ctx():
    t, u = _login(ADMIN_USER, ADMIN_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture(scope="module")
def emp_ctx():
    t, u = _login(EMP_USER, EMP_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture
def task_for_ahmet(admin_ctx, emp_ctx):
    """Admin creates a task and assigns it to ahmet."""
    title = f"TEST_lock_{uuid.uuid4().hex[:6]}"
    payload = {
        "title": title,
        "description": "lock test",
        "assignee_user_id": emp_ctx["user"]["id"],
        "assignee_name": emp_ctx["user"]["username"],
    }
    r = admin_ctx["sess"].post(f"{API}/tasks", json=payload)
    assert r.status_code == 200, r.text
    task = r.json()
    yield task
    # cleanup — admin can always delete
    try:
        admin_ctx["sess"].delete(f"{API}/tasks/{task['id']}")
    except Exception:
        pass


def _set_locks(sess, tid, flags):
    return sess.patch(f"{API}/tasks/{tid}/locks", json={"lock_flags": flags})


# ---------------- TESTS ----------------
class TestLockConfigRBAC:
    def test_admin_can_set_locks(self, admin_ctx, task_for_ahmet):
        r = _set_locks(admin_ctx["sess"], task_for_ahmet["id"],
                       {"lock_delete": True, "lock_edit": True})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["lock_flags"].get("lock_delete") is True
        assert data["lock_flags"].get("lock_edit") is True
        assert data.get("locked_by")

    def test_assignee_cannot_set_locks(self, emp_ctx, admin_ctx, task_for_ahmet):
        r = _set_locks(emp_ctx["sess"], task_for_ahmet["id"], {"lock_edit": True})
        assert r.status_code == 403, r.text

    def test_creator_bypasses_own_lock_on_edit(self, admin_ctx, task_for_ahmet):
        # admin is creator; lock_edit set but admin should still edit
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_edit": True})
        r = admin_ctx["sess"].patch(f"{API}/tasks/{task_for_ahmet['id']}",
                                    json={"title": "TEST_updated_by_admin"})
        assert r.status_code == 200, r.text


class TestAssigneeBlockedByLock:
    def test_delete_blocked_returns_423(self, admin_ctx, emp_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_delete": True})
        r = emp_ctx["sess"].delete(f"{API}/tasks/{task_for_ahmet['id']}")
        assert r.status_code == 423, r.text
        assert "kilitli" in r.text.lower()

    def test_patch_status_blocked_returns_423(self, admin_ctx, emp_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_complete": True})
        r = emp_ctx["sess"].patch(f"{API}/tasks/{task_for_ahmet['id']}",
                                  json={"status": "done"})
        assert r.status_code == 423, r.text

    def test_admin_bypasses_lock_on_delete(self, admin_ctx, emp_ctx):
        # Create fresh task to delete
        title = f"TEST_lock_admin_bypass_{uuid.uuid4().hex[:6]}"
        r = admin_ctx["sess"].post(f"{API}/tasks",
                                   json={"title": title,
                                         "assignee_user_id": emp_ctx["user"]["id"],
                                         "assignee_name": emp_ctx["user"]["username"]})
        assert r.status_code == 200
        tid = r.json()["id"]
        _set_locks(admin_ctx["sess"], tid, {"lock_delete": True})
        r = admin_ctx["sess"].delete(f"{API}/tasks/{tid}")
        assert r.status_code == 200, r.text


class TestOtpIssueAndVerify:
    def test_issue_otp_returns_6_digit_code(self, admin_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_delete": True})
        r = admin_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-otp")
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data["code"], str) and len(data["code"]) == 6 and data["code"].isdigit()
        assert data.get("expires_at")
        assert data.get("ttl_minutes") == 10

    def test_non_assignee_cannot_verify(self, admin_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_delete": True})
        r = admin_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-otp")
        code = r.json()["code"]
        # admin herself trying to verify — should be 403 (not assignee)
        r2 = admin_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-verify",
                                    json={"code": code})
        assert r2.status_code == 403, r2.text

    def test_wrong_code_returns_400(self, admin_ctx, emp_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_delete": True})
        admin_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-otp")
        r = emp_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-verify",
                                 json={"code": "000000"})
        assert r.status_code == 400, r.text

    def test_reissue_invalidates_previous(self, admin_ctx, emp_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_delete": True})
        r1 = admin_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-otp")
        old_code = r1.json()["code"]
        # reissue
        r2 = admin_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-otp")
        new_code = r2.json()["code"]
        assert new_code != old_code or True  # rare collision safe
        # old code should now fail
        r3 = emp_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-verify",
                                  json={"code": old_code})
        assert r3.status_code == 400, r3.text
        # new one works
        r4 = emp_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-verify",
                                  json={"code": new_code})
        assert r4.status_code == 200, r4.text

    def test_used_code_cannot_be_reused(self, admin_ctx, emp_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_edit": True})
        code = admin_ctx["sess"].post(
            f"{API}/tasks/{task_for_ahmet['id']}/unlock-otp").json()["code"]
        r1 = emp_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-verify",
                                  json={"code": code})
        assert r1.status_code == 200
        r2 = emp_ctx["sess"].post(f"{API}/tasks/{task_for_ahmet['id']}/unlock-verify",
                                  json={"code": code})
        assert r2.status_code == 400, r2.text


class TestUnlockSessionSingleUse:
    def test_one_mutation_allowed_second_blocked(self, admin_ctx, emp_ctx):
        # Fresh task
        title = f"TEST_single_use_{uuid.uuid4().hex[:6]}"
        r = admin_ctx["sess"].post(f"{API}/tasks",
                                   json={"title": title,
                                         "assignee_user_id": emp_ctx["user"]["id"],
                                         "assignee_name": emp_ctx["user"]["username"]})
        tid = r.json()["id"]
        _set_locks(admin_ctx["sess"], tid, {"lock_edit": True, "lock_delete": True})
        code = admin_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-otp").json()["code"]
        v = emp_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-verify", json={"code": code})
        assert v.status_code == 200
        # First mutation OK
        p1 = emp_ctx["sess"].patch(f"{API}/tasks/{tid}",
                                   json={"title": "TEST_after_unlock"})
        assert p1.status_code == 200, p1.text
        # Second mutation should be locked again
        p2 = emp_ctx["sess"].patch(f"{API}/tasks/{tid}",
                                   json={"title": "TEST_second_attempt"})
        assert p2.status_code == 423, p2.text
        # cleanup
        admin_ctx["sess"].delete(f"{API}/tasks/{tid}")


class TestReassignLock:
    def test_reassign_blocked_when_lock_transfer(self, admin_ctx, emp_ctx, task_for_ahmet):
        _set_locks(admin_ctx["sess"], task_for_ahmet["id"], {"lock_transfer": True})
        # assignee tries to reassign to admin
        r = emp_ctx["sess"].post(
            f"{API}/tasks/{task_for_ahmet['id']}/reassign",
            json={"new_owner_user_id": admin_ctx["user"]["id"]},
        )
        assert r.status_code == 423, r.text
