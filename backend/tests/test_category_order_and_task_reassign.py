"""
Backend tests for SERTEX new features:
1. Category chip order sync (GET/PUT /api/task-categories/order)
2. Task category reassignment via PATCH (drag-onto-chip target endpoint)
3. Regression: POST /api/tasks/reorder still works
"""
import os
import time
import requests
import pytest

BASE = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login", json={"username": "serkan", "password": "19071987"}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def categories(h):
    r = requests.get(f"{BASE}/api/task-categories", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    cats = r.json()
    assert isinstance(cats, list)
    return cats


def test_get_category_order(h):
    r = requests.get(f"{BASE}/api/task-categories/order", headers=h, timeout=15)
    assert r.status_code == 200, r.text
    data = r.json()
    assert "order" in data
    assert isinstance(data["order"], list)


def test_put_category_order_persists(h, categories):
    if len(categories) < 2:
        pytest.skip("Need >=2 categories to test order")
    ids = [c["id"] for c in categories]
    # reverse the order
    reversed_ids = list(reversed(ids))
    r = requests.put(f"{BASE}/api/task-categories/order", headers=h, json={"order": reversed_ids}, timeout=15)
    assert r.status_code == 200, r.text

    # GET back
    r2 = requests.get(f"{BASE}/api/task-categories/order", headers=h, timeout=15)
    assert r2.status_code == 200
    got = r2.json()["order"]
    # Server order should include the ids we PUT (possibly filtered), in same relative order
    filtered = [i for i in got if i in reversed_ids]
    assert filtered == reversed_ids, f"Expected {reversed_ids}, got {filtered} (full: {got})"

    # restore original
    requests.put(f"{BASE}/api/task-categories/order", headers=h, json={"order": ids}, timeout=15)


def test_task_category_patch_and_clear(h, categories):
    if not categories:
        pytest.skip("No categories")
    cat = categories[0]
    # create test task uncategorized
    r = requests.post(f"{BASE}/api/tasks", headers=h, json={"title": "TEST_dragcat_" + str(int(time.time()))}, timeout=15)
    assert r.status_code in (200, 201), r.text
    task = r.json()
    tid = task["id"]
    try:
        # PATCH assign to category
        rp = requests.patch(f"{BASE}/api/tasks/{tid}", headers=h, json={"category_id": cat["id"]}, timeout=15)
        assert rp.status_code == 200, rp.text
        # GET to verify
        rg = requests.get(f"{BASE}/api/tasks/{tid}", headers=h, timeout=15)
        assert rg.status_code == 200
        assert rg.json().get("category_id") == cat["id"]

        # PATCH clear via empty string
        rp2 = requests.patch(f"{BASE}/api/tasks/{tid}", headers=h, json={"category_id": ""}, timeout=15)
        assert rp2.status_code == 200, rp2.text
        rg2 = requests.get(f"{BASE}/api/tasks/{tid}", headers=h, timeout=15)
        assert rg2.status_code == 200
        cat_val = rg2.json().get("category_id")
        assert not cat_val, f"Expected empty/null, got {cat_val!r}"
    finally:
        requests.delete(f"{BASE}/api/tasks/{tid}", headers=h, timeout=15)


def test_tasks_reorder_regression(h):
    # get some tasks
    r = requests.get(f"{BASE}/api/tasks", headers=h, timeout=15)
    assert r.status_code == 200
    tasks = r.json()
    if isinstance(tasks, dict):
        tasks = tasks.get("tasks", [])
    ids = [t["id"] for t in tasks[:3]]
    if len(ids) < 2:
        pytest.skip("Need >=2 tasks for reorder regression")
    r2 = requests.post(f"{BASE}/api/tasks/reorder", headers=h, json={"ids": ids}, timeout=15)
    assert r2.status_code in (200, 204), f"reorder failed: {r2.status_code} {r2.text}"
