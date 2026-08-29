"""
Sertex — Reminder → Task migration test (iteration 10).

Covers the backend on_event('startup') migration:
  - Any items in db.reminders → moved to db.tasks
  - reminder_at derived from remind_at
  - status = 'done' if completed else 'pending'
  - db.reminders emptied after migration
  - Idempotent on repeat startups (same id not duplicated)
"""
import os
import uuid
import subprocess
import time
from datetime import datetime, timezone

import pytest
import requests
from pymongo import MongoClient

BASE_URL = os.environ['REACT_APP_BACKEND_URL'].rstrip('/')
API = f"{BASE_URL}/api"
DEFAULT_USER = os.environ.get("INITIAL_USERNAME", "serkan")
DEFAULT_PASS = os.environ.get("INITIAL_PASSWORD", "19071987")


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
    client = MongoClient(MONGO_URL)
    return client[DB_NAME]


@pytest.fixture(scope="module")
def auth_token():
    s = requests.Session()
    r = s.post(f"{API}/auth/login",
               json={"username": DEFAULT_USER, "password": DEFAULT_PASS},
               timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _restart_backend_and_wait():
    """Restart backend supervisor and wait for it to become healthy."""
    subprocess.run(["sudo", "supervisorctl", "restart", "backend"],
                   capture_output=True, timeout=30)
    # Wait for backend health
    deadline = time.time() + 30
    while time.time() < deadline:
        try:
            r = requests.get(f"{API}/", timeout=3)
            if r.status_code == 200:
                return
        except Exception:
            pass
        time.sleep(0.5)
    raise RuntimeError("Backend did not come back after restart")


class TestReminderMigration:
    """Verify old reminders auto-migrate to tasks on backend startup."""

    def test_migration_moves_reminders_to_tasks(self, db, auth_token):
        # Seed unique reminders directly into db.reminders
        prefix = f"MIG_{uuid.uuid4().hex[:8]}"
        r1_id = str(uuid.uuid4())
        r2_id = str(uuid.uuid4())
        now_iso = datetime.now(timezone.utc).isoformat()
        seeded = [
            {
                "id": r1_id,
                "title": f"{prefix}_pending",
                "remind_at": "2030-01-01T10:00:00+00:00",
                "completed": False,
                "created_at": now_iso,
            },
            {
                "id": r2_id,
                "title": f"{prefix}_done",
                "remind_at": "2029-12-31T09:00:00+00:00",
                "completed": True,
                "created_at": now_iso,
            },
        ]

        # Clean any leftovers for these ids, then insert
        db.reminders.delete_many({"id": {"$in": [r1_id, r2_id]}})
        db.tasks.delete_many({"id": {"$in": [r1_id, r2_id]}})
        db.reminders.insert_many([dict(s) for s in seeded])

        assert db.reminders.count_documents({"id": r1_id}) == 1
        assert db.reminders.count_documents({"id": r2_id}) == 1

        # Restart backend to trigger startup migration
        _restart_backend_and_wait()

        # db.reminders should be emptied (migration deletes all)
        assert db.reminders.count_documents({}) == 0, (
            "db.reminders should be empty after migration"
        )

        # db.tasks should contain both migrated items with correct fields
        t1 = db.tasks.find_one({"id": r1_id})
        assert t1 is not None, "Pending reminder not migrated to tasks"
        assert t1["title"] == f"{prefix}_pending"
        assert t1["status"] == "pending"
        assert t1["reminder_at"] == "2030-01-01T10:00:00+00:00"
        assert t1["due_date"] == "2030-01-01T10:00:00+00:00"
        assert t1["reminder_fired"] is False

        t2 = db.tasks.find_one({"id": r2_id})
        assert t2 is not None, "Completed reminder not migrated to tasks"
        assert t2["title"] == f"{prefix}_done"
        assert t2["status"] == "done"
        assert t2["reminder_at"] == "2029-12-31T09:00:00+00:00"

        # Migrated tasks should also be visible via API
        s = requests.Session()
        s.headers.update({"Authorization": f"Bearer {auth_token}"})
        r = s.get(f"{API}/tasks", timeout=10)
        assert r.status_code == 200
        api_ids = {t["id"] for t in r.json()}
        assert r1_id in api_ids
        assert r2_id in api_ids

        # Cleanup
        db.tasks.delete_many({"id": {"$in": [r1_id, r2_id]}})

    def test_migration_is_idempotent_on_repeat_startup(self, db):
        """Running startup twice should not duplicate migrated tasks.

        We insert one reminder, restart to migrate. Then insert a task
        with same id manually into db.reminders again would be unusual —
        so instead simulate: seed a reminder + a task with same id
        already present in db.tasks. Startup should NOT insert a duplicate
        into db.tasks even though the reminder collection has an entry.
        """
        rid = str(uuid.uuid4())
        prefix = f"IDEMP_{uuid.uuid4().hex[:6]}"
        db.reminders.delete_many({"id": rid})
        db.tasks.delete_many({"id": rid})

        # Pre-existing task with this id (simulates prior migration)
        db.tasks.insert_one({
            "id": rid,
            "title": f"{prefix}_preexisting_task",
            "description": "already migrated",
            "status": "pending",
            "due_date": None,
            "reminder_at": None,
            "reminder_fired": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        # And a reminder with the same id (would be re-attempted)
        db.reminders.insert_one({
            "id": rid,
            "title": f"{prefix}_would_duplicate",
            "remind_at": "2030-01-01T10:00:00+00:00",
            "completed": False,
            "created_at": datetime.now(timezone.utc).isoformat(),
        })

        _restart_backend_and_wait()

        # Reminders emptied
        assert db.reminders.count_documents({}) == 0

        # Exactly ONE task with this id (no duplicate insert)
        task_count = db.tasks.count_documents({"id": rid})
        assert task_count == 1, f"Expected 1 task with id={rid}, got {task_count}"

        # Existing task's title should remain unchanged (migration skipped it)
        preexisting = db.tasks.find_one({"id": rid})
        assert preexisting["title"] == f"{prefix}_preexisting_task"

        # Cleanup
        db.tasks.delete_many({"id": rid})

    def test_empty_reminders_no_side_effect(self, db):
        """If db.reminders is empty at startup, nothing bad happens."""
        db.reminders.delete_many({})
        # Snapshot task count
        before = db.tasks.count_documents({})
        _restart_backend_and_wait()
        after = db.tasks.count_documents({})
        # Task count unchanged (migration was a no-op)
        assert after == before
        assert db.reminders.count_documents({}) == 0
