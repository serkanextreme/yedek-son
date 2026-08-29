"""Sertex — Faz 8 CP5 · Due-soon reminder tests.

Scope:
    * Priority chain: task > user > company > system default
    * `reminder_disabled=True` at task level bypasses everything
    * Personal mode skips the company layer entirely
    * Scanner produces `due_soon_task` notifications for owner + fan-out
    * Idempotency: no re-fire at the same layer
    * Whitelist validation: only 1/2/3/5/7/14 accepted

We use direct DB seeding for company/user threshold fields (admin API
covers what the UI can do; the direct route lets us test personal mode
where no company setting exists).
"""
import os
import uuid
from datetime import datetime, timedelta, timezone

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


def _login(username: str, password: str) -> str:
    r = requests.post(f"{API}/auth/login",
                      json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, r.text
    return r.json()["token"]


def _h(tok: str) -> dict:
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def emp_token():
    # Employee test fixture (seeded by test_permissions/test_team_faz2 harness)
    try:
        return _login("emp1_test", "emp123")
    except Exception:
        pytest.skip("employee test account missing — run test_team_faz2 first")


def _mk_soon(days_from_now: int, hours: int = 0) -> str:
    dt = datetime.now(timezone.utc) + timedelta(days=days_from_now, hours=hours)
    return dt.isoformat()


def _create_task(tok, **kwargs):
    payload = {"title": kwargs.pop("title", f"CP5_{uuid.uuid4().hex[:6]}"), **kwargs}
    r = requests.post(f"{API}/tasks", headers=_h(tok), json=payload, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()


def _delete_task(tok, tid):
    requests.delete(f"{API}/tasks/{tid}", headers=_h(tok), timeout=10)


def _clear_notifs_for_task(db, tid):
    db.notifications.delete_many({"task_id": tid})


# ---------------------------------------------------------------------------
# 1) Config endpoint
# ---------------------------------------------------------------------------
class TestConfigEndpoint:
    def test_default_system_default_when_no_overrides(self, admin_token, db):
        # Ensure admin has no personal override
        db.users.update_one(
            {"username": "serkan"}, {"$unset": {"due_soon_threshold": ""}},
        )
        r = requests.get(f"{API}/settings/reminder-config", headers=_h(admin_token))
        d = r.json()
        assert d["system_default"] == 3
        assert d["allowed_days"] == [1, 2, 3, 5, 7, 14]
        assert d["effective"] == 3

    def test_user_override_wins_over_system(self, admin_token, db):
        r = requests.put(f"{API}/settings/reminder-threshold",
                         headers=_h(admin_token), json={"days": 7})
        assert r.status_code == 200
        d = requests.get(f"{API}/settings/reminder-config", headers=_h(admin_token)).json()
        assert d["user_threshold"] == 7
        assert d["effective"] == 7
        # cleanup
        requests.put(f"{API}/settings/reminder-threshold",
                     headers=_h(admin_token), json={"days": None})

    def test_invalid_threshold_rejected(self, admin_token):
        r = requests.put(f"{API}/settings/reminder-threshold",
                         headers=_h(admin_token), json={"days": 999})
        assert r.status_code == 400
        r = requests.put(f"{API}/settings/reminder-threshold",
                         headers=_h(admin_token), json={"days": 4})
        assert r.status_code == 400  # not in whitelist

    def test_null_days_clears_override(self, admin_token, db):
        requests.put(f"{API}/settings/reminder-threshold",
                     headers=_h(admin_token), json={"days": 2})
        requests.put(f"{API}/settings/reminder-threshold",
                     headers=_h(admin_token), json={"days": None})
        d = requests.get(f"{API}/settings/reminder-config", headers=_h(admin_token)).json()
        assert d["user_threshold"] is None
        assert d["effective"] == 3  # back to system default


# ---------------------------------------------------------------------------
# 2) Task-level fields
# ---------------------------------------------------------------------------
class TestTaskFields:
    def test_create_task_with_reminder_days(self, admin_token):
        t = _create_task(admin_token, due_date=_mk_soon(10), reminder_days=5)
        assert t["reminder_days"] == 5
        assert t["reminder_disabled"] is False
        _delete_task(admin_token, t["id"])

    def test_create_task_with_disabled_flag(self, admin_token):
        t = _create_task(admin_token, due_date=_mk_soon(2), reminder_disabled=True)
        assert t["reminder_disabled"] is True
        _delete_task(admin_token, t["id"])

    def test_invalid_reminder_days_stored_as_none(self, admin_token):
        t = _create_task(admin_token, due_date=_mk_soon(10), reminder_days=999)
        # Whitelisted → 999 gets sanitized to None (hierarchy resumes)
        assert t["reminder_days"] is None
        _delete_task(admin_token, t["id"])

    def test_patch_updates_reminder_days(self, admin_token):
        t = _create_task(admin_token, due_date=_mk_soon(10))
        r = requests.patch(f"{API}/tasks/{t['id']}", headers=_h(admin_token),
                           json={"reminder_days": 14})
        assert r.status_code == 200
        assert r.json()["reminder_days"] == 14
        # clear via zero/negative
        r = requests.patch(f"{API}/tasks/{t['id']}", headers=_h(admin_token),
                           json={"reminder_days": 0})
        assert r.json()["reminder_days"] is None
        _delete_task(admin_token, t["id"])

    def test_patch_toggles_disabled(self, admin_token):
        t = _create_task(admin_token, due_date=_mk_soon(2))
        r = requests.patch(f"{API}/tasks/{t['id']}", headers=_h(admin_token),
                           json={"reminder_disabled": True})
        assert r.json()["reminder_disabled"] is True
        r = requests.patch(f"{API}/tasks/{t['id']}", headers=_h(admin_token),
                           json={"reminder_disabled": False})
        assert r.json()["reminder_disabled"] is False
        _delete_task(admin_token, t["id"])


# ---------------------------------------------------------------------------
# 3) Scanner
# ---------------------------------------------------------------------------
class TestScanner:
    def test_scanner_fires_for_task_within_threshold(self, admin_token, db):
        # Admin task 2 days out, threshold 5 → within window
        t = _create_task(admin_token, due_date=_mk_soon(2, hours=1), reminder_days=5)
        try:
            _clear_notifs_for_task(db, t["id"])
            r = requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            assert r.status_code == 200
            data = r.json()
            assert "due_soon" in data
            # Admin should have received a self-notification
            admin_uid = _me(admin_token)["id"]
            n = db.notifications.find_one({"task_id": t["id"], "user_id": admin_uid, "type": "due_soon_task"})
            assert n is not None, "due_soon notification not created"
            assert n["days_until_due"] <= 2
        finally:
            _clear_notifs_for_task(db, t["id"])
            _delete_task(admin_token, t["id"])

    def test_scanner_skips_disabled_task(self, admin_token, db):
        t = _create_task(admin_token, due_date=_mk_soon(1), reminder_disabled=True)
        try:
            _clear_notifs_for_task(db, t["id"])
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            n = db.notifications.find_one({"task_id": t["id"], "type": "due_soon_task"})
            assert n is None, "reminder_disabled task should NOT create a notification"
        finally:
            _clear_notifs_for_task(db, t["id"])
            _delete_task(admin_token, t["id"])

    def test_scanner_skips_task_outside_window(self, admin_token, db):
        # 30 days out, threshold 3 → OUT of window, no notif
        t = _create_task(admin_token, due_date=_mk_soon(30), reminder_days=3)
        try:
            _clear_notifs_for_task(db, t["id"])
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            n = db.notifications.find_one({"task_id": t["id"], "type": "due_soon_task"})
            assert n is None
        finally:
            _clear_notifs_for_task(db, t["id"])
            _delete_task(admin_token, t["id"])

    def test_scanner_is_idempotent_at_same_layer(self, admin_token, db):
        t = _create_task(admin_token, due_date=_mk_soon(2, hours=1), reminder_days=5)
        try:
            _clear_notifs_for_task(db, t["id"])
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            requests.post(f"{API}/notifications/scan-now", headers=_h(admin_token))
            admin_uid = _me(admin_token)["id"]
            count = db.notifications.count_documents({
                "task_id": t["id"], "user_id": admin_uid, "type": "due_soon_task",
            })
            assert count == 1, f"expected exactly 1 notif, got {count}"
        finally:
            _clear_notifs_for_task(db, t["id"])
            _delete_task(admin_token, t["id"])


def _me(tok):
    return requests.get(f"{API}/auth/me", headers=_h(tok)).json()
