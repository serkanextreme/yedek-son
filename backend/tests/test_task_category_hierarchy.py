"""Task Category Hierarchy — backend API tests.

Covers:
- create parent → child → grandchild (parent_id chain, per-company dup check)
- duplicate name check is per (company_id, parent_id) — same name allowed under different parents
- cascade delete removes subtree + clears category_id on affected tasks (does NOT delete tasks)
- assign task to any depth (parent, leaf)
"""
import os
import pytest
import requests
import uuid

BASE = os.environ.get("REACT_APP_BACKEND_URL").rstrip("/")
PREFIX = f"QA2_H_{uuid.uuid4().hex[:6]}_"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE}/api/auth/login",
                      json={"username": "serkan", "password": "19071987"})
    assert r.status_code == 200, r.text
    return r.json()["token"]


@pytest.fixture(scope="module")
def h(token):
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


@pytest.fixture(scope="module")
def company_id(h):
    r = requests.get(f"{BASE}/api/companies", headers=h)
    assert r.status_code == 200
    cs = r.json()
    assert len(cs) > 0
    return cs[0]["id"]


def _mk_cat(h, name, company_id, parent_id=None, color="#ff0000"):
    payload = {"name": name, "color": color, "company_id": company_id}
    if parent_id:
        payload["parent_id"] = parent_id
    r = requests.post(f"{BASE}/api/task-categories", headers=h, json=payload)
    return r


def test_hierarchy_create_parent_child_grandchild(h, company_id):
    root_name = f"{PREFIX}Root"
    child_name = f"{PREFIX}Child"
    grand_name = f"{PREFIX}Grand"

    r_root = _mk_cat(h, root_name, company_id)
    assert r_root.status_code == 200, r_root.text
    root = r_root.json()
    assert root["parent_id"] is None
    assert root["name"] == root_name
    assert root["color"] == "#ff0000"

    r_child = _mk_cat(h, child_name, company_id, parent_id=root["id"], color="#00ff00")
    assert r_child.status_code == 200, r_child.text
    child = r_child.json()
    assert child["parent_id"] == root["id"]
    assert child["color"] == "#00ff00"

    r_grand = _mk_cat(h, grand_name, company_id, parent_id=child["id"], color="#0000ff")
    assert r_grand.status_code == 200, r_grand.text
    grand = r_grand.json()
    assert grand["parent_id"] == child["id"]

    # GET listing — all three visible
    r = requests.get(f"{BASE}/api/task-categories", headers=h)
    assert r.status_code == 200
    ids = {c["id"] for c in r.json()}
    assert {root["id"], child["id"], grand["id"]} <= ids

    # Duplicate name allowed under different parent (same "Child" under grand)
    r_dup = _mk_cat(h, child_name, company_id, parent_id=grand["id"])
    assert r_dup.status_code == 200, r_dup.text

    # Duplicate name NOT allowed under same parent
    r_dup2 = _mk_cat(h, child_name, company_id, parent_id=root["id"])
    assert r_dup2.status_code == 400, r_dup2.text

    # store for later
    pytest.hier_ids = {"root": root["id"], "child": child["id"], "grand": grand["id"],
                      "dup_under_grand": r_dup.json()["id"]}


def test_assign_task_to_leaf_and_parent(h, company_id):
    ids = pytest.hier_ids
    # Create a task assigned to LEAF (grand)
    r = requests.post(f"{BASE}/api/tasks", headers=h, json={
        "title": f"{PREFIX}task_leaf", "category_id": ids["grand"], "company_id": company_id,
    })
    assert r.status_code == 200, r.text
    task_leaf = r.json()
    assert task_leaf["category_id"] == ids["grand"]

    # Create a task assigned to PARENT (root)
    r = requests.post(f"{BASE}/api/tasks", headers=h, json={
        "title": f"{PREFIX}task_root", "category_id": ids["root"], "company_id": company_id,
    })
    assert r.status_code == 200, r.text
    task_root = r.json()
    assert task_root["category_id"] == ids["root"]

    pytest.hier_task_ids = {"leaf": task_leaf["id"], "root": task_root["id"]}


def test_cascade_delete_clears_task_category(h):
    ids = pytest.hier_ids
    tids = pytest.hier_task_ids

    r = requests.delete(f"{BASE}/api/task-categories/{ids['root']}", headers=h)
    assert r.status_code == 200, r.text
    body = r.json()
    assert body["deleted"] is True
    # root + child + grand + dup_under_grand = 4
    assert body["count"] == 4, body

    # tasks should still exist but category_id cleared
    for tid in tids.values():
        r = requests.get(f"{BASE}/api/tasks/{tid}", headers=h)
        assert r.status_code == 200, r.text
        assert r.json().get("category_id") in (None, ""), r.json()

    # Categories gone from listing
    r = requests.get(f"{BASE}/api/task-categories", headers=h)
    assert r.status_code == 200
    remaining = {c["id"] for c in r.json()}
    for cid in ids.values():
        assert cid not in remaining


def test_invalid_parent(h, company_id):
    r = _mk_cat(h, f"{PREFIX}bad", company_id, parent_id="does-not-exist")
    assert r.status_code == 404


def test_cleanup_tasks(h):
    # Delete leftover tasks with our prefix
    r = requests.get(f"{BASE}/api/tasks", headers=h)
    for t in r.json():
        if (t.get("title") or "").startswith(PREFIX):
            requests.delete(f"{BASE}/api/tasks/{t['id']}", headers=h)
