"""Faz 9 CP8.1 — regression: reorder endpoint respects multi-tenant visibility.

Before the fix, POST /tasks/reorder filtered updates by
`{id: tid, user_id: currentUser.id}` — an admin/manager reordering tasks
they created for OTHER users saw the UI shuffle transiently and then snap
back on refresh (because the DB write matched zero rows). This suite pins
the corrected behaviour.
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


def _create_task_for(admin_sess, assignee_user_id, assignee_username, title):
    r = admin_sess.post(f"{API}/tasks", json={
        "title": title,
        "assignee_user_id": assignee_user_id,
        "assignee_name": assignee_username,
    })
    assert r.status_code == 200, r.text
    return r.json()


class TestReorderMultiTenant:
    def test_admin_can_reorder_tasks_assigned_to_other_users(self, admin_ctx, emp_ctx):
        """Admin creates 3 tasks assigned to ahmet, reorders them, and
        expects the persisted sort_order to reflect the requested sequence."""
        emp_uid = emp_ctx["user"]["id"]
        prefix = f"REORDER_MT_{uuid.uuid4().hex[:6]}"
        t1 = _create_task_for(admin_ctx["sess"], emp_uid, "ahmet", f"{prefix}_A")
        t2 = _create_task_for(admin_ctx["sess"], emp_uid, "ahmet", f"{prefix}_B")
        t3 = _create_task_for(admin_ctx["sess"], emp_uid, "ahmet", f"{prefix}_C")
        try:
            # Request order: C, A, B
            r = admin_ctx["sess"].post(f"{API}/tasks/reorder", json={
                "ids": [t3["id"], t1["id"], t2["id"]],
            })
            assert r.status_code == 200, r.text
            assert r.json()["count"] == 3
            # Refetch (include all — admin sees the whole fleet)
            r2 = admin_ctx["sess"].get(f"{API}/tasks?include_all=true")
            assert r2.status_code == 200
            by_id = {t["id"]: t for t in r2.json() if t["id"] in (t1["id"], t2["id"], t3["id"])}
            # sort_order = n - idx → C=3.0, A=2.0, B=1.0
            assert by_id[t3["id"]]["sort_order"] == 3.0
            assert by_id[t1["id"]]["sort_order"] == 2.0
            assert by_id[t2["id"]]["sort_order"] == 1.0
        finally:
            for t in (t1, t2, t3):
                try:
                    admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")
                except Exception:
                    pass

    def test_assignee_view_matches_admin_reorder(self, admin_ctx, emp_ctx):
        """Ahmet fetches his own /tasks list — the order dictated by the
        admin's reorder must be honoured on his side too."""
        emp_uid = emp_ctx["user"]["id"]
        prefix = f"REORDER_ASSIGNEE_{uuid.uuid4().hex[:6]}"
        t1 = _create_task_for(admin_ctx["sess"], emp_uid, "ahmet", f"{prefix}_A")
        t2 = _create_task_for(admin_ctx["sess"], emp_uid, "ahmet", f"{prefix}_B")
        try:
            r = admin_ctx["sess"].post(f"{API}/tasks/reorder", json={"ids": [t2["id"], t1["id"]]})
            assert r.status_code == 200, r.text
            # Ahmet re-fetches
            r2 = emp_ctx["sess"].get(f"{API}/tasks")
            assert r2.status_code == 200
            rows = {t["id"]: t for t in r2.json() if t["id"] in (t1["id"], t2["id"])}
            assert rows[t2["id"]]["sort_order"] == 2.0
            assert rows[t1["id"]]["sort_order"] == 1.0
        finally:
            for t in (t1, t2):
                try:
                    admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")
                except Exception:
                    pass

    def test_employee_cannot_reorder_others_tasks(self, admin_ctx, emp_ctx):
        """Ahmet must NOT be able to influence the sort_order of a task that
        belongs to serkan (admin). The endpoint silently skips rows the
        caller can't see — no 403 spam, but nothing changes."""
        # Serkan owns this task (self-assignment via default)
        prefix = f"REORDER_ISOLATION_{uuid.uuid4().hex[:6]}"
        r = admin_ctx["sess"].post(f"{API}/tasks", json={"title": f"{prefix}_MINE"})
        assert r.status_code == 200
        adm_task = r.json()
        # Ahmet has his own task
        r2 = emp_ctx["sess"].post(f"{API}/tasks", json={"title": f"{prefix}_HIS"})
        assert r2.status_code == 200
        emp_task = r2.json()
        try:
            # Ahmet tries to reorder BOTH — his own + admin's private task
            r3 = emp_ctx["sess"].post(f"{API}/tasks/reorder", json={
                "ids": [adm_task["id"], emp_task["id"]],
            })
            assert r3.status_code == 200  # endpoint returns 200 either way
            # Verify serkan's task sort_order was NOT touched.
            r4 = admin_ctx["sess"].get(f"{API}/tasks?include_all=true")
            adm_after = next((t for t in r4.json() if t["id"] == adm_task["id"]), None)
            assert adm_after is not None
            # Original sort_order was None (fresh task) — it must remain None.
            assert adm_after.get("sort_order") in (None, 0, 0.0), (
                f"employee somehow changed admin's sort_order: {adm_after.get('sort_order')}"
            )
        finally:
            for t in (adm_task, emp_task):
                try:
                    admin_ctx["sess"].delete(f"{API}/tasks/{t['id']}")
                except Exception:
                    pass
