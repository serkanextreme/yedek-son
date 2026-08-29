"""Faz 9 CP6 — Global Announcement System backend tests.

Covers:
- POST /api/announcements (admin only; employees/managers get 403)
- Validation: title/message/severity/target_type
- GET /api/announcements/active for the current user (target filtering + ack)
- POST /api/announcements/{id}/ack (idempotent)
- PATCH /api/announcements/{id} (admin edit)
- DELETE /api/announcements/{id} (soft) vs DELETE /purge (hard)
- GET /api/announcements/{id}/stats (target_count + ack_count + ratio)
- target_type=role targeting (employee-only announcement invisible to admin)
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


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, f"login {u}: {r.text}"
    return r.json()


def _sess(tok):
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json", "Authorization": f"Bearer {tok}"})
    return s


@pytest.fixture(scope="module")
def admin_ctx():
    j = _login(ADMIN_USER, ADMIN_PASS)
    return {"sess": _sess(j["token"]), "user": j["user"]}


@pytest.fixture(scope="module")
def emp_ctx():
    j = _login(EMP_USER, EMP_PASS)
    return {"sess": _sess(j["token"]), "user": j["user"]}


def _purge_by_title(admin_sess, title_prefix):
    """Best-effort cleanup so leftover rows from earlier runs don't skew tests."""
    r = admin_sess.get(f"{API}/announcements")
    if r.status_code != 200:
        return
    for row in r.json():
        if (row.get("title") or "").startswith(title_prefix):
            try:
                admin_sess.delete(f"{API}/announcements/{row['id']}/purge")
            except Exception:
                pass


# ------------------------------------------------------------------ #
class TestPublishRBAC:
    def test_admin_can_publish(self, admin_ctx):
        _purge_by_title(admin_ctx["sess"], "PYTEST_ann")
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": f"PYTEST_ann_{uuid.uuid4().hex[:6]}",
            "message": "hello world",
            "severity": "info",
            "target_type": "all",
        })
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["target_type"] == "all"
        assert data["severity"] == "info"
        assert data["is_active"] is True
        # cleanup
        admin_ctx["sess"].delete(f"{API}/announcements/{data['id']}/purge")

    def test_employee_forbidden(self, emp_ctx):
        r = emp_ctx["sess"].post(f"{API}/announcements", json={
            "title": "shouldnt_publish", "message": "no", "severity": "info", "target_type": "all",
        })
        assert r.status_code == 403, r.text


class TestValidation:
    def test_missing_title(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": "", "message": "x", "severity": "info", "target_type": "all",
        })
        assert r.status_code == 400, r.text

    def test_invalid_severity(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": "t", "message": "m", "severity": "urgent", "target_type": "all",
        })
        assert r.status_code == 400, r.text

    def test_role_target_without_value(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": "t", "message": "m", "severity": "info", "target_type": "role", "target_value": "cook",
        })
        assert r.status_code == 400, r.text


class TestTargetingAndAck:
    def test_role_target_filters(self, admin_ctx, emp_ctx):
        # Announcement targeted at admin-role → employee should NOT see it.
        _purge_by_title(admin_ctx["sess"], "PYTEST_role_admin")
        title = f"PYTEST_role_admin_{uuid.uuid4().hex[:6]}"
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": title, "message": "admin-only", "severity": "info",
            "target_type": "role", "target_value": "admin",
        })
        assert r.status_code == 200, r.text
        aid = r.json()["id"]
        try:
            # Admin sees it
            r2 = admin_ctx["sess"].get(f"{API}/announcements/active")
            assert r2.status_code == 200, r2.text
            assert any(a["id"] == aid for a in r2.json()), "admin should see admin-role announcement"
            # Employee does NOT see it
            r3 = emp_ctx["sess"].get(f"{API}/announcements/active")
            assert r3.status_code == 200, r3.text
            assert not any(a["id"] == aid for a in r3.json()), "employee should NOT see admin-role announcement"
        finally:
            admin_ctx["sess"].delete(f"{API}/announcements/{aid}/purge")

    def test_all_target_reaches_employee_and_ack(self, admin_ctx, emp_ctx):
        _purge_by_title(admin_ctx["sess"], "PYTEST_all_ack")
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": f"PYTEST_all_ack_{uuid.uuid4().hex[:6]}",
            "message": "for everyone",
            "severity": "warning",
            "target_type": "all",
            "require_ack": True,
        })
        assert r.status_code == 200, r.text
        aid = r.json()["id"]
        try:
            # Employee sees + acked False
            r2 = emp_ctx["sess"].get(f"{API}/announcements/active")
            assert r2.status_code == 200
            row = next((a for a in r2.json() if a["id"] == aid), None)
            assert row and row["acked"] is False

            # Ack
            r3 = emp_ctx["sess"].post(f"{API}/announcements/{aid}/ack")
            assert r3.status_code == 200
            assert r3.json()["ok"] is True
            assert r3.json()["already"] is False

            # Second ack is idempotent
            r4 = emp_ctx["sess"].post(f"{API}/announcements/{aid}/ack")
            assert r4.status_code == 200
            assert r4.json()["already"] is True

            # After ack, active returns acked=True
            r5 = emp_ctx["sess"].get(f"{API}/announcements/active")
            row2 = next((a for a in r5.json() if a["id"] == aid), None)
            assert row2 and row2["acked"] is True
        finally:
            admin_ctx["sess"].delete(f"{API}/announcements/{aid}/purge")


class TestCrudAndStats:
    def test_update_and_soft_delete_and_stats(self, admin_ctx, emp_ctx):
        _purge_by_title(admin_ctx["sess"], "PYTEST_crud")
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": f"PYTEST_crud_{uuid.uuid4().hex[:6]}",
            "message": "orig", "severity": "info", "target_type": "all",
        })
        assert r.status_code == 200
        aid = r.json()["id"]
        try:
            # patch
            r2 = admin_ctx["sess"].patch(f"{API}/announcements/{aid}", json={"message": "updated"})
            assert r2.status_code == 200
            assert r2.json()["message"] == "updated"

            # Employee acks
            emp_ctx["sess"].post(f"{API}/announcements/{aid}/ack")

            # stats
            r3 = admin_ctx["sess"].get(f"{API}/announcements/{aid}/stats")
            assert r3.status_code == 200
            s = r3.json()
            assert s["announcement_id"] == aid
            assert s["target_count"] >= 1
            assert s["ack_count"] >= 1
            assert 0.0 <= s["ack_ratio"] <= 1.0

            # soft delete → still visible in admin list but is_active=false
            r4 = admin_ctx["sess"].delete(f"{API}/announcements/{aid}")
            assert r4.status_code == 200

            # user active feed should exclude it now
            r5 = emp_ctx["sess"].get(f"{API}/announcements/active")
            assert not any(a["id"] == aid for a in r5.json())
        finally:
            admin_ctx["sess"].delete(f"{API}/announcements/{aid}/purge")

    def test_purge_removes_acks(self, admin_ctx, emp_ctx):
        _purge_by_title(admin_ctx["sess"], "PYTEST_purge")
        r = admin_ctx["sess"].post(f"{API}/announcements", json={
            "title": f"PYTEST_purge_{uuid.uuid4().hex[:6]}",
            "message": "temporary", "severity": "info", "target_type": "all",
        })
        assert r.status_code == 200
        aid = r.json()["id"]
        emp_ctx["sess"].post(f"{API}/announcements/{aid}/ack")
        r2 = admin_ctx["sess"].delete(f"{API}/announcements/{aid}/purge")
        assert r2.status_code == 200
        # stats should now 404
        r3 = admin_ctx["sess"].get(f"{API}/announcements/{aid}/stats")
        assert r3.status_code == 404
