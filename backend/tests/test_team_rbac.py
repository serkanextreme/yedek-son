"""Faz 8 CP3 — Rol-Bazlı Görev Atama & Team Endpoints tests.

Covers:
- POST /api/tasks with assignee_user_id (manager → visible employee, self, invalid, admin bypass, employee blocked)
- GET /api/team/members role-based visibility
- GET /api/team/summary rollup counts (incl. overdue)
"""

import os
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(u, p):
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": u, "password": p}, timeout=15)
    assert r.status_code == 200, f"login {u} failed: {r.status_code} {r.text}"
    d = r.json()
    return d["token"], d["user"]


def _hdr(tok):
    return {"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def sessions():
    # Sequential logins to avoid SESSION_KICKED across parallel workers.
    admin_tok, admin_u = _login("serkan", "19071987")
    mgr_tok, mgr_u = _login("mgr_test", "mgr12345")
    emp_tok, emp_u = _login("emp1_test", "emp12345")
    # NOTE: after emp login, mgr/admin tokens may be alive (different users).
    # We do NOT re-login within tests; each user's single token stays valid
    # since we don't collide on the same username here.
    return {
        "admin": {"tok": admin_tok, "u": admin_u},
        "mgr": {"tok": mgr_tok, "u": mgr_u},
        "emp": {"tok": emp_tok, "u": emp_u},
    }


@pytest.fixture(scope="module")
def created_task_ids():
    ids = []
    yield ids
    # Cleanup using admin (which can view all)
    tok, _ = _login("serkan", "19071987")
    for tid in ids:
        requests.delete(f"{BASE_URL}/api/tasks/{tid}", headers=_hdr(tok), timeout=15)


# ---------- Task assignment RBAC ----------

def test_manager_assigns_to_visible_employee(sessions, created_task_ids):
    mgr = sessions["mgr"]; emp = sessions["emp"]
    r = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(mgr["tok"]),
        json={"title": "TEST_CP3 mgr->emp", "assignee_user_id": emp["u"]["id"]},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    t = r.json()
    created_task_ids.append(t["id"])
    assert t["assignee_name"] == "emp1_test"
    assert t.get("company_name") == "Test Company A"
    # Verify persistence & ownership by fetching as emp (should see it in their list)
    lr = requests.get(f"{BASE_URL}/api/tasks", headers=_hdr(emp["tok"]), timeout=15)
    assert lr.status_code == 200
    assert any(x["id"] == t["id"] for x in lr.json())


def test_manager_assigns_invalid_uid_returns_403(sessions):
    mgr = sessions["mgr"]; admin = sessions["admin"]
    # Assigning to the admin (serkan) — mgr_test has no visibility on admin.
    r = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(mgr["tok"]),
        json={"title": "TEST_CP3 mgr->admin BLOCKED", "assignee_user_id": admin["u"]["id"]},
        timeout=15,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"
    assert "atayamazsınız" in r.text or "atayamaz" in r.text
    # Random uid
    r2 = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(mgr["tok"]),
        json={"title": "TEST_CP3 mgr->random", "assignee_user_id": "no-such-user-abc123"},
        timeout=15,
    )
    assert r2.status_code == 403, r2.text


def test_manager_assigns_to_self(sessions, created_task_ids):
    mgr = sessions["mgr"]
    r = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(mgr["tok"]),
        json={"title": "TEST_CP3 mgr->self", "assignee_user_id": mgr["u"]["id"]},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    t = r.json()
    created_task_ids.append(t["id"])
    # Task list from mgr should include it
    lr = requests.get(f"{BASE_URL}/api/tasks", headers=_hdr(mgr["tok"]), timeout=15)
    assert any(x["id"] == t["id"] for x in lr.json())


def test_employee_cannot_assign_to_others(sessions):
    emp = sessions["emp"]; mgr = sessions["mgr"]
    r = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(emp["tok"]),
        json={"title": "TEST_CP3 emp->mgr BLOCKED", "assignee_user_id": mgr["u"]["id"]},
        timeout=15,
    )
    assert r.status_code == 403, f"expected 403, got {r.status_code} {r.text}"


def test_admin_can_assign_to_any_user(sessions, created_task_ids):
    admin = sessions["admin"]; emp = sessions["emp"]
    r = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(admin["tok"]),
        json={"title": "TEST_CP3 admin->emp", "assignee_user_id": emp["u"]["id"]},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    t = r.json()
    created_task_ids.append(t["id"])
    assert t["assignee_name"] == "emp1_test"


# ---------- /api/team/members ----------

def test_team_members_manager(sessions):
    mgr = sessions["mgr"]; emp = sessions["emp"]
    r = requests.get(f"{BASE_URL}/api/team/members", headers=_hdr(mgr["tok"]), timeout=15)
    assert r.status_code == 200, r.text
    members = r.json()
    ids = [m["id"] for m in members]
    assert emp["u"]["id"] in ids
    assert mgr["u"]["id"] not in ids  # self excluded
    # Verify shape
    m = next(x for x in members if x["id"] == emp["u"]["id"])
    assert m["username"] == "emp1_test"
    assert m.get("company_name") == "Test Company A"


def test_team_members_admin_sees_all_except_self(sessions):
    admin = sessions["admin"]
    r = requests.get(f"{BASE_URL}/api/team/members", headers=_hdr(admin["tok"]), timeout=15)
    assert r.status_code == 200
    members = r.json()
    ids = [m["id"] for m in members]
    assert admin["u"]["id"] not in ids
    assert len(members) >= 2  # mgr_test + emp1_test at minimum


def test_team_members_employee_empty(sessions):
    emp = sessions["emp"]
    r = requests.get(f"{BASE_URL}/api/team/members", headers=_hdr(emp["tok"]), timeout=15)
    assert r.status_code == 200
    assert r.json() == []


# ---------- /api/team/summary ----------

def test_team_summary_manager_has_emp_rollup(sessions):
    mgr = sessions["mgr"]; emp = sessions["emp"]
    r = requests.get(f"{BASE_URL}/api/team/summary", headers=_hdr(mgr["tok"]), timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    row = next((x for x in rows if x["user_id"] == emp["u"]["id"]), None)
    assert row is not None, f"emp1_test not in summary: {rows}"
    for k in ("username", "role", "company_name", "total", "done", "pending", "paused", "overdue"):
        assert k in row, f"missing key {k}"
    assert row["username"] == "emp1_test"
    assert row["total"] >= 1  # at least the mgr->emp task from earlier test
    assert isinstance(row["overdue"], int)


def test_team_summary_overdue_counted(sessions, created_task_ids):
    """Create an overdue task for emp1_test and verify count reflects it."""
    admin = sessions["admin"]; mgr = sessions["mgr"]; emp = sessions["emp"]
    past = (datetime.now(timezone.utc) - timedelta(days=1)).isoformat()
    # Read baseline
    r0 = requests.get(f"{BASE_URL}/api/team/summary", headers=_hdr(mgr["tok"]), timeout=15).json()
    base_row = next((x for x in r0 if x["user_id"] == emp["u"]["id"]), None)
    base_overdue = base_row["overdue"] if base_row else 0
    # Create overdue task via admin
    r = requests.post(
        f"{BASE_URL}/api/tasks",
        headers=_hdr(admin["tok"]),
        json={"title": "TEST_CP3 overdue", "assignee_user_id": emp["u"]["id"], "due_date": past},
        timeout=15,
    )
    assert r.status_code == 200, r.text
    created_task_ids.append(r.json()["id"])
    r1 = requests.get(f"{BASE_URL}/api/team/summary", headers=_hdr(mgr["tok"]), timeout=15).json()
    new_row = next(x for x in r1 if x["user_id"] == emp["u"]["id"])
    assert new_row["overdue"] == base_overdue + 1, f"overdue should increase: {base_overdue}->{new_row['overdue']}"


def test_team_summary_employee_empty(sessions):
    emp = sessions["emp"]
    r = requests.get(f"{BASE_URL}/api/team/summary", headers=_hdr(emp["tok"]), timeout=15)
    assert r.status_code == 200
    assert r.json() == []


def test_team_summary_admin_sees_all(sessions):
    admin = sessions["admin"]
    r = requests.get(f"{BASE_URL}/api/team/summary", headers=_hdr(admin["tok"]), timeout=15)
    assert r.status_code == 200
    rows = r.json()
    ids = [x["user_id"] for x in rows]
    assert admin["u"]["id"] not in ids
    assert len(rows) >= 2
