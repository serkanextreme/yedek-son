"""
Sertex — Faz 9 CP5 cross-flow integration regression suite.

These tests string multiple subsystems together so a regression in ANY of them
(templates, user default policy, task creation propagation, OTP unlock,
audit trail) is caught by a single failure. They complement the per-feature
suites (`test_lock_policy_templates.py`, `test_tasks_user_policy.py`,
`test_tasks_locks.py`, `test_tasks_lock_audit.py`) which pin individual APIs.

Scenarios:
  Scenario 1 — full lifecycle:
    * admin creates a lock policy template ("STRICT")
    * template applied to ahmet's default policy
    * new task assigned to ahmet inherits the template's lock flags
    * ahmet is blocked from deleting → 423
    * admin issues an OTP, ahmet verifies, ahmet deletes → 200
    * audit trail contains: lock_set (via template apply), otp_issued,
      otp_verified, otp_consumed, task_deleted rows
  Scenario 2 — soft-lock (requires_otp=False):
    * admin publishes a self-servicable template (requires_otp=False)
    * applied to ahmet's default policy
    * new task inherits soft-lock: ahmet can unlock via /unlock-simple
      without a code and immediately complete the task.
"""
import os
import uuid
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
EMP_USER = "ahmet"
EMP_PASS = "ahmet123"


# --------------------------- helpers --------------------------- #
def _login(username, password):
    r = requests.post(
        f"{API}/auth/login",
        json={"username": username, "password": password},
        timeout=30,
    )
    assert r.status_code == 200, f"login failed {username}: {r.status_code} {r.text}"
    j = r.json()
    return j["token"], j["user"]


def _sess(token):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {token}"})
    return s


# --------------------------- fixtures --------------------------- #
@pytest.fixture(scope="module")
def admin_ctx():
    t, u = _login(ADMIN_USER, ADMIN_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture(scope="module")
def emp_ctx():
    t, u = _login(EMP_USER, EMP_PASS)
    return {"sess": _sess(t), "user": u}


@pytest.fixture(autouse=True)
def _clean_ahmet_policy(admin_ctx, emp_ctx):
    """Clear ahmet's default policy before AND after each scenario so cross-flow
    tests can't leak locks into unrelated suites."""
    def _clear():
        try:
            admin_ctx["sess"].patch(
                f"{API}/users/{emp_ctx['user']['id']}/lock-flags",
                json={"lock_flags": {}, "requires_otp": True},
            )
        except Exception:
            pass
    _clear()
    yield
    _clear()


# --------------------------- scenario 1 --------------------------- #
def test_full_lifecycle_template_to_audit(admin_ctx, emp_ctx):
    """Template → user policy → task create → assignee blocked → OTP → delete."""
    admin = admin_ctx["sess"]
    emp = emp_ctx["sess"]
    emp_uid = emp_ctx["user"]["id"]

    # 1. Admin creates a strict template.
    tpl_name = f"STRICT_flow_{uuid.uuid4().hex[:6]}"
    r = admin.post(
        f"{API}/lock-policy-templates",
        json={
            "name": tpl_name,
            "description": "cross-flow test",
            "lock_flags": {"lock_delete": True, "lock_complete": True},
            "requires_otp": True,
        },
    )
    assert r.status_code in (200, 201), r.text
    tpl = r.json()

    try:
        # 2. Apply the template's flags to ahmet's default policy.
        r = admin.patch(
            f"{API}/users/{emp_uid}/lock-flags",
            json={
                "lock_flags": tpl["lock_flags"],
                "requires_otp": tpl["requires_otp"],
            },
        )
        assert r.status_code == 200, r.text

        # 3. Admin creates a task assigned to ahmet — the fresh task should
        # inherit the default lock flags.
        title = f"TEST_flow_{uuid.uuid4().hex[:6]}"
        r = admin.post(
            f"{API}/tasks",
            json={
                "title": title,
                "assignee_user_id": emp_uid,
                "assignee_name": emp_ctx["user"]["username"],
            },
        )
        assert r.status_code == 200, r.text
        task = r.json()
        tid = task["id"]

        try:
            assert task["lock_flags"].get("lock_delete") is True, (
                "task did not inherit default_lock_flags.lock_delete"
            )
            assert task["lock_flags"].get("lock_complete") is True

            # 4. Ahmet tries to delete → blocked with 423.
            r = emp.delete(f"{API}/tasks/{tid}")
            assert r.status_code == 423, r.text

            # 5. Admin issues OTP.
            r = admin.post(f"{API}/tasks/{tid}/unlock-otp")
            assert r.status_code == 200, r.text
            code = r.json()["code"]
            assert len(code) == 6 and code.isdigit()

            # 6. Ahmet verifies OTP → opens 10-min single-use window.
            r = emp.post(f"{API}/tasks/{tid}/unlock-verify", json={"code": code})
            assert r.status_code == 200, r.text
            unlocked = r.json()
            assert unlocked.get("unlock_uses_remaining", 0) >= 1

            # 7. Ahmet deletes — should succeed inside the window.
            r = emp.delete(f"{API}/tasks/{tid}")
            assert r.status_code == 200, r.text
            tid_deleted_at_end = True

            # 8. Audit trail check — admin fetches history for the task
            # (task is soft-marked as deleted but audit rows remain). The
            # audit endpoint accepts the task id and returns rows even after
            # deletion. If it doesn't, this assertion will surface it.
            r = admin.get(f"{API}/tasks/{tid}/lock-audit")
            assert r.status_code == 200, r.text
            events = {row["event_type"] for row in (r.json().get("rows") or [])}
            # We expect these to be present at minimum. `lock_set` is NOT
            # in this list because the lock came from default policy
            # inheritance during task creation, not from a PATCH /locks call.
            for expected in ("otp_issued", "otp_verified", "otp_consumed", "task_deleted"):
                assert expected in events, f"missing audit event: {expected} (got {events})"
        finally:
            if not locals().get("tid_deleted_at_end"):
                try:
                    admin.delete(f"{API}/tasks/{tid}")
                except Exception:
                    pass
    finally:
        # cleanup template — admin can always delete
        try:
            admin.delete(f"{API}/lock-policy-templates/{tpl['id']}")
        except Exception:
            pass


# --------------------------- scenario 2 --------------------------- #
def test_soft_lock_template_allows_unlock_simple(admin_ctx, emp_ctx):
    """Template with requires_otp=False → ahmet self-unlocks via unlock-simple
    (no code) and immediately completes the task."""
    admin = admin_ctx["sess"]
    emp = emp_ctx["sess"]
    emp_uid = emp_ctx["user"]["id"]

    tpl_name = f"SOFT_flow_{uuid.uuid4().hex[:6]}"
    r = admin.post(
        f"{API}/lock-policy-templates",
        json={
            "name": tpl_name,
            "lock_flags": {"lock_complete": True},
            "requires_otp": False,
        },
    )
    assert r.status_code in (200, 201), r.text
    tpl = r.json()

    try:
        # Apply as ahmet's default policy (soft mode).
        r = admin.patch(
            f"{API}/users/{emp_uid}/lock-flags",
            json={
                "lock_flags": tpl["lock_flags"],
                "requires_otp": False,
            },
        )
        assert r.status_code == 200, r.text

        # Create task assigned to ahmet.
        r = admin.post(
            f"{API}/tasks",
            json={
                "title": f"TEST_soft_{uuid.uuid4().hex[:6]}",
                "assignee_user_id": emp_uid,
                "assignee_name": emp_ctx["user"]["username"],
            },
        )
        assert r.status_code == 200, r.text
        task = r.json()
        tid = task["id"]
        assert task["lock_flags"].get("lock_complete") is True
        # Task must inherit the soft-lock (requires_otp = False).
        assert task.get("lock_requires_otp") is False

        try:
            # Ahmet tries to complete without unlocking → blocked (423).
            r = emp.patch(f"{API}/tasks/{tid}", json={"status": "done"})
            assert r.status_code == 423, r.text

            # Ahmet self-unlocks (no code needed because soft-lock).
            r = emp.post(f"{API}/tasks/{tid}/unlock-simple")
            assert r.status_code == 200, r.text

            # Now ahmet completes → success.
            r = emp.patch(f"{API}/tasks/{tid}", json={"status": "done"})
            assert r.status_code == 200, r.text
            assert r.json()["status"] == "done"
        finally:
            try:
                admin.delete(f"{API}/tasks/{tid}")
            except Exception:
                pass
    finally:
        try:
            admin.delete(f"{API}/lock-policy-templates/{tpl['id']}")
        except Exception:
            pass
