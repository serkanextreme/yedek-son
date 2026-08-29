"""Backend tests — Task Category hierarchy (rollup stats + re-parent/cycle).

Covers the new feature set:
  - GET  /api/task-categories/stats           (direct task counts per category)
  - PATCH /api/task-categories/{id}           (re-parent, cycle guard, root)

Uses admin `serkan` for scope=all. Creates TEST_ prefixed categories/tasks
and cleans them up at the end.
"""
import os
import uuid
import pytest
import requests

def _load_url():
    v = os.environ.get("REACT_APP_BACKEND_URL")
    if v:
        return v.rstrip("/")
    fe_env = "/app/frontend/.env"
    if os.path.exists(fe_env):
        with open(fe_env) as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    return line.split("=", 1)[1].strip().rstrip("/")
    raise RuntimeError("REACT_APP_BACKEND_URL not set")

BASE_URL = _load_url()
API = f"{BASE_URL}/api"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{API}/auth/login", json={"username": "serkan", "password": "19071987"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def H(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def company_id(H):
    r = requests.get(f"{API}/companies", headers=H, timeout=15)
    assert r.status_code == 200, r.text
    rows = r.json()
    assert rows, "Need at least one company for hierarchy tests"
    return rows[0]["id"]


@pytest.fixture(scope="module")
def hierarchy(H, company_id):
    """Create TEST_parent -> TEST_child hierarchy and 3 tasks (2 parent, 1 child; 1 done)."""
    suffix = uuid.uuid4().hex[:6]
    created_cats = []
    created_tasks = []

    r = requests.post(f"{API}/task-categories",
                      headers=H,
                      json={"name": f"TEST_parent_{suffix}", "company_id": company_id},
                      timeout=15)
    assert r.status_code == 200, r.text
    parent = r.json()
    created_cats.append(parent["id"])

    r = requests.post(f"{API}/task-categories",
                      headers=H,
                      json={"name": f"TEST_child_{suffix}", "company_id": company_id, "parent_id": parent["id"]},
                      timeout=15)
    assert r.status_code == 200, r.text
    child = r.json()
    created_cats.append(child["id"])

    # Sibling root (for re-parent tests)
    r = requests.post(f"{API}/task-categories",
                      headers=H,
                      json={"name": f"TEST_sibling_{suffix}", "company_id": company_id},
                      timeout=15)
    assert r.status_code == 200, r.text
    sibling = r.json()
    created_cats.append(sibling["id"])

    def _mk_task(title, cat_id, status="todo"):
        payload = {"title": title, "category_id": cat_id, "company_id": company_id}
        rr = requests.post(f"{API}/tasks", headers=H, json=payload, timeout=15)
        assert rr.status_code == 200, rr.text
        t = rr.json()
        created_tasks.append(t["id"])
        if status == "done":
            up = requests.patch(f"{API}/tasks/{t['id']}", headers=H, json={"status": "done"}, timeout=15)
            assert up.status_code == 200, up.text
        return t

    _mk_task(f"TEST_pt1_{suffix}", parent["id"], "todo")
    _mk_task(f"TEST_pt2_{suffix}", parent["id"], "done")
    _mk_task(f"TEST_ct1_{suffix}", child["id"], "todo")

    yield {"parent": parent, "child": child, "sibling": sibling, "company_id": company_id}

    # Teardown
    for tid in created_tasks:
        try:
            requests.delete(f"{API}/tasks/{tid}", headers=H, timeout=10)
        except Exception:
            pass
    # Delete children first (cascade may exist but be safe)
    for cid in reversed(created_cats):
        try:
            requests.delete(f"{API}/task-categories/{cid}", headers=H, timeout=10)
        except Exception:
            pass


# ---------------------------------------------------------- stats endpoint --
class TestStatsEndpoint:
    def test_stats_admin_returns_direct_counts(self, H, hierarchy):
        r = requests.get(f"{API}/task-categories/stats", headers=H, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert isinstance(data, dict)
        p_id = hierarchy["parent"]["id"]
        c_id = hierarchy["child"]["id"]
        assert p_id in data, f"Parent id missing from stats: {list(data.keys())[:5]}"
        assert c_id in data, "Child id missing from stats"
        assert data[p_id] == {"total": 2, "done": 1}, data[p_id]
        assert data[c_id] == {"total": 1, "done": 0}, data[c_id]

    def test_stats_shape_is_flat_map(self, H, hierarchy):
        """Stats must be direct (non-rolled-up) — parent should show 2, not 3."""
        r = requests.get(f"{API}/task-categories/stats", headers=H, timeout=15)
        assert r.status_code == 200
        d = r.json()[hierarchy["parent"]["id"]]
        assert d["total"] == 2, "Backend stats must return DIRECT counts (rollup is FE)"


# ----------------------------------------------------- re-parent + cycle ---
class TestReparent:
    def test_reparent_to_other_root(self, H, hierarchy):
        """Move sibling under parent."""
        sid = hierarchy["sibling"]["id"]
        pid = hierarchy["parent"]["id"]
        r = requests.patch(f"{API}/task-categories/{sid}", headers=H, json={"parent_id": pid}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["parent_id"] == pid

        # GET verification via list
        rl = requests.get(f"{API}/task-categories", headers=H, timeout=15)
        assert rl.status_code == 200
        found = next((c for c in rl.json() if c["id"] == sid), None)
        assert found and found["parent_id"] == pid

    def test_reparent_back_to_root(self, H, hierarchy):
        sid = hierarchy["sibling"]["id"]
        r = requests.patch(f"{API}/task-categories/{sid}", headers=H, json={"parent_id": None}, timeout=15)
        assert r.status_code == 200, r.text
        assert r.json()["parent_id"] in (None, "")

        rl = requests.get(f"{API}/task-categories", headers=H, timeout=15)
        found = next((c for c in rl.json() if c["id"] == sid), None)
        assert found and (found.get("parent_id") in (None, ""))

    def test_reparent_under_self_rejected(self, H, hierarchy):
        pid = hierarchy["parent"]["id"]
        r = requests.patch(f"{API}/task-categories/{pid}", headers=H, json={"parent_id": pid}, timeout=15)
        assert r.status_code == 400, r.text
        assert "kendi" in r.json().get("detail", "").lower()

    def test_reparent_cycle_under_own_descendant_rejected(self, H, hierarchy):
        """Move parent under child (child is descendant of parent) -> 400."""
        pid = hierarchy["parent"]["id"]
        cid = hierarchy["child"]["id"]
        r = requests.patch(f"{API}/task-categories/{pid}", headers=H, json={"parent_id": cid}, timeout=15)
        assert r.status_code == 400, r.text
        detail = r.json().get("detail", "")
        assert "alt" in detail.lower() and "taşın" in detail.lower(), detail
