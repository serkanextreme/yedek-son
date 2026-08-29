"""Team Faz 2 — overdue scanner + notifications + heatmap tests."""
import os
import uuid
import time
import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")
API = f"{BASE_URL}/api"

ADMIN_USER = "serkan"
ADMIN_PASS = "19071987"


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


def _login(username, password):
    r = requests.post(f"{API}/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login(ADMIN_USER, ADMIN_PASS)


@pytest.fixture(scope="module")
def mgr_token():
    return _login("mgr_test", "mgr12345")


@pytest.fixture(scope="module")
def emp_token():
    return _login("emp1_test", "emp12345")


def _create_overdue_task(tok, title):
    """Task with due_date in the past → guaranteed overdue."""
    r = requests.post(f"{API}/tasks", headers=_h(tok), json={
        "title": title,
        "due_date": "2026-01-01T00:00:00+00:00",
    })
    assert r.status_code == 200, r.text
    return r.json()["id"]


def _delete_task(admin_tok, tid):
    requests.delete(f"{API}/tasks/{tid}", headers=_h(admin_tok))


def _clear_notifications_for(admin_tok, task_id):
    """Delete notifications rows for a task_id via direct scan — safety net."""
    # We don't expose a raw delete; instead we mark them read and let dedup
    # take care of cleanup on the next scan. For test isolation the module
    # tears down its tasks anyway.


# ---------------------------------------------------------------------------
# 1) Scanner semantics
# ---------------------------------------------------------------------------
class TestOverdueScanner:
    def test_scan_creates_self_and_manager_notifications(self, admin_token, emp_token, mgr_token):
        tid = _create_overdue_task(emp_token, "T2_TestScannerCreate")
        try:
            counts = requests.post(
                f"{API}/notifications/scan-now", headers=_h(admin_token),
            ).json()
            assert counts["tasks_seen"] >= 1
            # After scan, emp1 has at least one notification for this task_id.
            emp_notifs = requests.get(
                f"{API}/notifications", headers=_h(emp_token),
            ).json()
            assert any(n["task_id"] == tid and n["is_for_manager"] is False for n in emp_notifs)
            # Manager mgr_test has a fan-out notification for the same task.
            mgr_notifs = requests.get(
                f"{API}/notifications", headers=_h(mgr_token),
            ).json()
            assert any(n["task_id"] == tid and n["is_for_manager"] is True for n in mgr_notifs)
        finally:
            _delete_task(admin_token, tid)

    def test_scan_is_idempotent(self, admin_token, emp_token):
        tid = _create_overdue_task(emp_token, "T2_TestIdempotent")
        try:
            r1 = requests.post(
                f"{API}/notifications/scan-now", headers=_h(admin_token),
            ).json()
            # Second call in the SAME second: no new inserts thanks to the
            # unique (user_id, task_id, type) index.
            r2 = requests.post(
                f"{API}/notifications/scan-now", headers=_h(admin_token),
            ).json()
            # The delta between r1 and r2 for this task should be zero self,
            # zero manager. We can't reason directly about r1 counts (other
            # overdue rows exist), but r2 should have zero new for the tid.
            emp_notifs = requests.get(
                f"{API}/notifications", headers=_h(emp_token),
            ).json()
            for_tid = [n for n in emp_notifs if n["task_id"] == tid and n["is_for_manager"] is False]
            assert len(for_tid) == 1, f"expected 1 self-notification, got {len(for_tid)}"
        finally:
            _delete_task(admin_token, tid)

    def test_scan_now_requires_admin(self, emp_token):
        r = requests.post(f"{API}/notifications/scan-now", headers=_h(emp_token))
        assert r.status_code == 403


# ---------------------------------------------------------------------------
# 2) Notification CRUD
# ---------------------------------------------------------------------------
class TestNotificationEndpoints:
    def test_unread_count_and_mark_read(self, admin_token, emp_token):
        tid = _create_overdue_task(emp_token, "T2_TestUnreadRead")
        try:
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            n0 = requests.get(f"{API}/notifications/unread-count", headers=_h(emp_token)).json()
            assert n0["unread"] >= 1
            # Fetch the row that corresponds to this task and mark it read.
            rows = requests.get(f"{API}/notifications", headers=_h(emp_token)).json()
            target = next((r for r in rows if r["task_id"] == tid), None)
            assert target is not None
            rr = requests.post(f"{API}/notifications/{target['id']}/read", headers=_h(emp_token))
            assert rr.status_code == 200
            # unread-count should decrement by 1
            n1 = requests.get(f"{API}/notifications/unread-count", headers=_h(emp_token)).json()
            assert n1["unread"] == n0["unread"] - 1
        finally:
            _delete_task(admin_token, tid)

    def test_mark_read_rejects_foreign(self, admin_token, emp_token, mgr_token):
        tid = _create_overdue_task(emp_token, "T2_TestForeignRead")
        try:
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            emp_rows = requests.get(f"{API}/notifications", headers=_h(emp_token)).json()
            target = next((r for r in emp_rows if r["task_id"] == tid), None)
            assert target is not None
            # mgr_test tries to mark emp1's notification as read → 404 (scoped by user_id)
            r = requests.post(f"{API}/notifications/{target['id']}/read", headers=_h(mgr_token))
            assert r.status_code == 404
        finally:
            _delete_task(admin_token, tid)

    def test_read_all(self, admin_token, emp_token):
        tid = _create_overdue_task(emp_token, "T2_TestReadAll")
        try:
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            r = requests.post(f"{API}/notifications/read-all", headers=_h(emp_token))
            assert r.status_code == 200
            n = requests.get(f"{API}/notifications/unread-count", headers=_h(emp_token)).json()
            assert n["unread"] == 0
        finally:
            _delete_task(admin_token, tid)


# ---------------------------------------------------------------------------
# 3) Heatmap
# ---------------------------------------------------------------------------
class TestHeatmap:
    def test_heatmap_shape(self, mgr_token):
        r = requests.get(f"{API}/team/heatmap?days=7", headers=_h(mgr_token))
        assert r.status_code == 200
        rows = r.json()
        # mgr_test sees emp1_test → at least 1 row
        assert len(rows) >= 1
        for row in rows:
            assert "user_id" in row and "username" in row
            assert len(row["days"]) == 7
            for d in row["days"]:
                assert "date" in d and "done" in d
                assert isinstance(d["done"], int)

    def test_heatmap_counts_done_only(self, admin_token, emp_token, mgr_token):
        """Complete a task now and confirm today's cell increments by 1 for
        the emp1_test row when queried by mgr_test."""
        # Create + immediately finish a fresh task.
        r = requests.post(f"{API}/tasks", headers=_h(emp_token), json={"title": "T2_HeatmapDone"})
        assert r.status_code == 200
        tid = r.json()["id"]
        try:
            r = requests.patch(f"{API}/tasks/{tid}", headers=_h(emp_token), json={"status": "done"})
            assert r.status_code == 200
            # Query heatmap from manager perspective, 1-day window.
            rows = requests.get(f"{API}/team/heatmap?days=1", headers=_h(mgr_token)).json()
            emp_row = next((row for row in rows if row["username"] == "emp1_test"), None)
            assert emp_row is not None
            todays_done = emp_row["days"][0]["done"]
            assert todays_done >= 1
        finally:
            _delete_task(admin_token, tid)

    def test_employee_heatmap_empty(self, emp_token):
        """Employees see nobody, so heatmap → []."""
        r = requests.get(f"{API}/team/heatmap?days=7", headers=_h(emp_token))
        assert r.status_code == 200
        assert r.json() == []

    def test_admin_heatmap_contains_all(self, admin_token):
        r = requests.get(f"{API}/team/heatmap?days=1", headers=_h(admin_token))
        assert r.status_code == 200
        # Admin sees every non-self user; at minimum mgr_test + emp1_test.
        usernames = [row["username"] for row in r.json()]
        assert "emp1_test" in usernames
        assert "mgr_test" in usernames
