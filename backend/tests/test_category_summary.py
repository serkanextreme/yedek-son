"""Sertex — Faz 9 CP2 · Category-based team summary.

Scope:
  * GET /api/team/category-summary returns aggregated task counts grouped
    by category_id for every visible task.
  * Employee sees only their own categories.
  * Manager sees categories touching their team + cross-perm.
  * Admin sees everything (no scope filter).
  * "Kolsuz" (no category) row is present when uncategorised tasks exist.
"""
import os
import uuid
from datetime import datetime, timezone, timedelta

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"


def _read_backend_env():
    env = {}
    with open("/app/backend/.env") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")
    return env


BACKEND_ENV = _read_backend_env()
MONGO_URL = BACKEND_ENV["MONGO_URL"]
DB_NAME = BACKEND_ENV["DB_NAME"]


@pytest.fixture(scope="module")
def db():
    return MongoClient(MONGO_URL)[DB_NAME]


def _login(u, p):
    r = requests.post(f"{API}/auth/login", json={"username": u, "password": p}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok):
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def cat_grid(db, admin_token):
    """Fresh grid: 1 company, 2 categories, 3 tasks per category."""
    # Cleanup
    db.tasks.delete_many({"title": {"$regex": "^CP9CAT_"}})
    db.task_categories.delete_many({"name": {"$regex": "^CP9CAT_"}})
    db.companies.delete_many({"name": {"$regex": "^CP9CAT_"}})

    r = requests.post(f"{API}/companies", headers=_h(admin_token), json={"name": "CP9CAT_Firm"})
    cid = r.json()["id"]
    # Categories
    r = requests.post(f"{API}/task-categories", headers=_h(admin_token), json={"name": "CP9CAT_Manuf", "company_id": cid, "color": "#ff0000"})
    manuf_id = r.json()["id"]
    r = requests.post(f"{API}/task-categories", headers=_h(admin_token), json={"name": "CP9CAT_Sales", "company_id": cid, "color": "#00ff00"})
    sales_id = r.json()["id"]

    # Seed tasks — Manuf: 1 done, 1 overdue, 1 pending due_soon; Sales: 2 done, 1 pending no due
    now = datetime.now(timezone.utc)
    yesterday = (now - timedelta(days=1)).isoformat()
    tomorrow = (now + timedelta(days=1)).isoformat()
    manuf_tasks = [
        {"title": "CP9CAT_Manuf_1", "category_id": manuf_id, "status": "done"},
        {"title": "CP9CAT_Manuf_2", "category_id": manuf_id, "due_date": yesterday, "status": "pending"},
        {"title": "CP9CAT_Manuf_3", "category_id": manuf_id, "due_date": tomorrow, "status": "pending"},
    ]
    sales_tasks = [
        {"title": "CP9CAT_Sales_1", "category_id": sales_id, "status": "done"},
        {"title": "CP9CAT_Sales_2", "category_id": sales_id, "status": "done"},
        {"title": "CP9CAT_Sales_3", "category_id": sales_id, "status": "pending"},
    ]
    for t in manuf_tasks + sales_tasks:
        status_override = t.pop("status", None)
        r = requests.post(f"{API}/tasks", headers=_h(admin_token), json=t)
        assert r.status_code == 200, r.text
        if status_override and status_override != "pending":
            # POST doesn't accept `status` — flip via PATCH afterwards.
            tid = r.json()["id"]
            requests.patch(f"{API}/tasks/{tid}", headers=_h(admin_token), json={"status": status_override})
    yield {"cid": cid, "manuf_id": manuf_id, "sales_id": sales_id}
    # Cleanup
    db.tasks.delete_many({"title": {"$regex": "^CP9CAT_"}})
    db.task_categories.delete_many({"name": {"$regex": "^CP9CAT_"}})
    db.companies.delete_many({"name": {"$regex": "^CP9CAT_"}})


class TestCategorySummary:
    def test_admin_sees_all_categories(self, admin_token, cat_grid):
        r = requests.get(f"{API}/team/category-summary", headers=_h(admin_token))
        assert r.status_code == 200
        data = r.json()
        names = {row["name"]: row for row in data}
        assert "CP9CAT_Manuf" in names
        assert "CP9CAT_Sales" in names

    def test_aggregation_counts_are_correct(self, admin_token, cat_grid):
        r = requests.get(f"{API}/team/category-summary", headers=_h(admin_token))
        data = r.json()
        manuf = next(row for row in data if row["name"] == "CP9CAT_Manuf")
        sales = next(row for row in data if row["name"] == "CP9CAT_Sales")
        assert manuf["total"] == 3
        assert manuf["done"] == 1
        assert manuf["overdue"] >= 1  # the yesterday task
        assert manuf["due_soon"] >= 1  # the tomorrow task
        assert sales["total"] == 3
        assert sales["done"] == 2
        assert sales["pending"] == 1

    def test_color_metadata_surfaces(self, admin_token, cat_grid):
        r = requests.get(f"{API}/team/category-summary", headers=_h(admin_token))
        data = r.json()
        manuf = next(row for row in data if row["name"] == "CP9CAT_Manuf")
        assert manuf["color"] == "#ff0000"

    def test_uncategorized_bucket_present_when_needed(self, admin_token, db):
        # Seed a Kolsuz-only task
        r = requests.post(f"{API}/tasks", headers=_h(admin_token), json={"title": "CP9CAT_UnCat_X"})
        try:
            r = requests.get(f"{API}/team/category-summary", headers=_h(admin_token))
            data = r.json()
            uncat = [row for row in data if row["category_id"] is None]
            assert len(uncat) >= 1
            assert uncat[0]["name"] == "Kolsuz"
        finally:
            db.tasks.delete_many({"title": "CP9CAT_UnCat_X"})
