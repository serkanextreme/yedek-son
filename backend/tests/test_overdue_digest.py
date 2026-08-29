"""Faz 9 CP7.2 — Overdue digest push cron tests.

Focus on the aggregation logic (not the FCM leg — that's covered by
test_fcm.py). We exercise the endpoint end-to-end but with fake tokens,
so sent=0 is fine — what matters is that the endpoint (a) reports the
correct number of users found, (b) enforces admin RBAC, (c) does not
crash when no overdue tasks exist.
"""
import os
import uuid
import pytest
import requests
from datetime import datetime, timedelta, timezone

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"
EMP_USER = "ahmet"
EMP_PASS = "ahmet123"


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
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


class TestOverdueDigest:
    def test_admin_can_trigger(self, admin_ctx):
        r = admin_ctx["sess"].post(f"{API}/fcm/run-overdue-digest")
        assert r.status_code == 200, r.text
        data = r.json()
        assert "users" in data and "sent" in data and "failed" in data
        assert isinstance(data["users"], int) and data["users"] >= 0

    def test_employee_forbidden(self, emp_ctx):
        r = emp_ctx["sess"].post(f"{API}/fcm/run-overdue-digest")
        assert r.status_code == 403, r.text

    def test_digest_counts_actual_overdue_tasks(self, admin_ctx, emp_ctx):
        """Create a task that IS overdue for ahmet, then confirm the digest
        finds at least ahmet in its user list."""
        past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
        emp_uid = emp_ctx["user"]["id"]
        title = f"PYTEST_overdue_{uuid.uuid4().hex[:6]}"
        r = admin_ctx["sess"].post(f"{API}/tasks", json={
            "title": title,
            "due_date": past,
            "assignee_user_id": emp_uid,
            "assignee_name": emp_ctx["user"]["username"],
        })
        assert r.status_code == 200, r.text
        tid = r.json()["id"]
        try:
            r2 = admin_ctx["sess"].post(f"{API}/fcm/run-overdue-digest")
            assert r2.status_code == 200
            assert r2.json()["users"] >= 1
        finally:
            admin_ctx["sess"].delete(f"{API}/tasks/{tid}")
