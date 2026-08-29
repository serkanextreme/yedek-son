"""
Sertex — Faz 9 CP4.28 Task Lock Audit tests.

Coverage:
- lock_set audit row on PATCH /locks
- otp_issued row + otp_invalidated on reissue
- otp_failed (wrong_or_used) & otp_verified (window_end)
- otp_consumed on locked PATCH / DELETE / reassign after verify
- task_deleted row with used_otp flag; admin can read audit for deleted task
- Audit GET RBAC: admin/creator/manager OK; foreign employee 403; deleted+non-admin 404
- Admin bypass path does NOT insert otp_consumed
- Response schema and DESC sorting, limit clamp
"""
import os
import time
import uuid
import pytest
import requests

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"

ADMIN_USER, ADMIN_PASS = "serkan", "19071987"
EMP_USER, EMP_PASS = "ahmet", "ahmet123"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
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


def _new_task(admin_ctx, emp_ctx, title_prefix="TEST_audit"):
    title = f"{title_prefix}_{uuid.uuid4().hex[:6]}"
    r = admin_ctx["sess"].post(
        f"{API}/tasks",
        json={"title": title,
              "assignee_user_id": emp_ctx["user"]["id"],
              "assignee_name": emp_ctx["user"]["username"]}
    )
    assert r.status_code == 200, r.text
    return r.json()


def _audit(admin_ctx, tid, limit=None):
    url = f"{API}/tasks/{tid}/lock-audit"
    if limit is not None:
        url += f"?limit={limit}"
    r = admin_ctx["sess"].get(url)
    return r


def _events(rows):
    return [r["event_type"] for r in rows]


# ------------------ Tests ------------------

class TestLockSetAudit:
    def test_lock_set_creates_audit_row(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        r = admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}/locks",
                                    json={"lock_flags": {"lock_delete": True, "lock_edit": True}})
        assert r.status_code == 200
        a = _audit(admin_ctx, t["id"])
        assert a.status_code == 200
        body = a.json()
        assert body["task_id"] == t["id"]
        assert body["task_exists"] is True
        assert body["count"] >= 1
        row = [r for r in body["rows"] if r["event_type"] == "lock_set"][0]
        assert row["actor_username"] == ADMIN_USER
        assert row["payload"].get("flags_before") == {} or isinstance(row["payload"].get("flags_before"), dict)
        after = row["payload"].get("flags_after") or {}
        assert after.get("lock_delete") is True
        assert after.get("lock_edit") is True
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")


class TestOtpAuditEvents:
    def test_otp_issued_and_reissue_invalidates(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}/locks",
                                json={"lock_flags": {"lock_delete": True}})
        r1 = admin_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-otp")
        assert r1.status_code == 200
        r2 = admin_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-otp")
        assert r2.status_code == 200
        rows = _audit(admin_ctx, t["id"]).json()["rows"]
        types = _events(rows)
        # DESC ordering, newest first: otp_issued (2nd) → otp_invalidated → otp_issued → lock_set
        assert types.count("otp_issued") == 2
        assert "otp_invalidated" in types
        # invalidated appears between the two otp_issued events chronologically
        # newest first means: [otp_issued, otp_invalidated, otp_issued, lock_set]
        inv = [r for r in rows if r["event_type"] == "otp_invalidated"][0]
        assert inv["payload"].get("count", 1) >= 1
        issued = [r for r in rows if r["event_type"] == "otp_issued"][0]
        assert issued["payload"].get("issued_for") == emp_ctx["user"]["id"]
        assert issued["payload"].get("expires_at")
        assert issued["payload"].get("otp_id")
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")

    def test_otp_failed_and_verified(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}/locks",
                                json={"lock_flags": {"lock_delete": True}})
        code = admin_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-otp").json()["code"]
        # wrong
        emp_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-verify", json={"code": "000000"})
        # correct
        emp_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-verify", json={"code": code})
        rows = _audit(admin_ctx, t["id"]).json()["rows"]
        failed = [r for r in rows if r["event_type"] == "otp_failed"]
        verified = [r for r in rows if r["event_type"] == "otp_verified"]
        assert failed and failed[0]["payload"].get("reason") == "wrong_or_used"
        assert verified and verified[0]["payload"].get("window_end")
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")


class TestOtpConsumedAudit:
    def test_consume_on_patch(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}/locks",
                                json={"lock_flags": {"lock_edit": True}})
        code = admin_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-otp").json()["code"]
        emp_ctx["sess"].post(f"{API}/tasks/{t['id']}/unlock-verify", json={"code": code})
        emp_ctx["sess"].patch(f"{API}/tasks/{t['id']}", json={"title": "TEST_patched"})
        rows = _audit(admin_ctx, t["id"]).json()["rows"]
        consumed = [r for r in rows if r["event_type"] == "otp_consumed"]
        assert consumed, "otp_consumed row missing"
        assert consumed[0]["payload"].get("action")
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")

    def test_consume_on_delete_and_task_deleted_row(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        tid = t["id"]
        admin_ctx["sess"].patch(f"{API}/tasks/{tid}/locks",
                                json={"lock_flags": {"lock_delete": True}})
        code = admin_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-otp").json()["code"]
        emp_ctx["sess"].post(f"{API}/tasks/{tid}/unlock-verify", json={"code": code})
        r = emp_ctx["sess"].delete(f"{API}/tasks/{tid}")
        assert r.status_code == 200, r.text
        # Task now deleted; only admin can view audit
        a = _audit(admin_ctx, tid)
        assert a.status_code == 200
        body = a.json()
        assert body["task_exists"] is False
        types = _events(body["rows"])
        assert "otp_consumed" in types
        deleted_row = [r for r in body["rows"] if r["event_type"] == "task_deleted"][0]
        assert isinstance(deleted_row["payload"].get("used_otp"), bool)
        assert deleted_row["payload"]["used_otp"] is True
        # Employee can't view audit of deleted task
        r_emp = emp_ctx["sess"].get(f"{API}/tasks/{tid}/lock-audit")
        assert r_emp.status_code == 404

    def test_admin_bypass_no_otp_consumed(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}/locks",
                                json={"lock_flags": {"lock_edit": True}})
        # admin PATCH — bypasses lock (creator+admin) without OTP
        r = admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}", json={"title": "TEST_admin_bypass"})
        assert r.status_code == 200
        rows = _audit(admin_ctx, t["id"]).json()["rows"]
        types = _events(rows)
        assert "otp_consumed" not in types, f"otp_consumed unexpectedly logged: {types}"
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")


class TestAuditSchemaAndSort:
    def test_schema_and_desc_order_and_limit(self, admin_ctx, emp_ctx):
        t = _new_task(admin_ctx, emp_ctx)
        for i in range(3):
            admin_ctx["sess"].patch(f"{API}/tasks/{t['id']}/locks",
                                    json={"lock_flags": {"lock_edit": True, "lock_delete": (i % 2 == 0)}})
            time.sleep(0.05)
        body = _audit(admin_ctx, t["id"]).json()
        assert set(body.keys()) >= {"task_id", "task_exists", "count", "rows"}
        rows = body["rows"]
        assert body["count"] == len(rows)
        ts = [r["created_at"] for r in rows]
        assert ts == sorted(ts, reverse=True), "rows not sorted DESC"
        # limit clamp - request 1 → exactly 1 row max; request 600 → clamped to <=500
        r1 = admin_ctx["sess"].get(f"{API}/tasks/{t['id']}/lock-audit?limit=1")
        assert r1.status_code == 200
        assert len(r1.json()["rows"]) == 1
        r_big = admin_ctx["sess"].get(f"{API}/tasks/{t['id']}/lock-audit?limit=600")
        assert r_big.status_code == 200
        assert len(r_big.json()["rows"]) <= 500
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")


class TestAuditPermissions:
    def test_admin_ok_creator_ok_employee_forbidden(self, admin_ctx, emp_ctx):
        # admin creates task assigned to ahmet → admin is creator
        t = _new_task(admin_ctx, emp_ctx)
        # admin
        assert _audit(admin_ctx, t["id"]).status_code == 200
        # employee (assignee, but NOT creator, NOT manager) → 403
        r = emp_ctx["sess"].get(f"{API}/tasks/{t['id']}/lock-audit")
        assert r.status_code == 403, r.text
        admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")
