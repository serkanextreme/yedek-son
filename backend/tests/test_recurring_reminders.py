"""Backend regression tests for recurring reminder fields (task create + patch).

Fields exercised: reminder_at, reminder_interval_min, reminder_repeat_total,
reminder_repeat_left. Covers create, patch persistence, PATCH clear via
explicit null, and regression (no reminder on plain create).
"""
import os
from datetime import datetime, timezone, timedelta

import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com").rstrip("/")
USER = "ahmet"
PASSWORD = "ahmet123"


@pytest.fixture(scope="module")
def token():
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": USER, "password": PASSWORD}, timeout=30)
    assert r.status_code == 200, f"login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def client(token):
    s = requests.Session()
    s.headers.update({"Authorization": f"Bearer {token}", "Content-Type": "application/json"})
    return s


@pytest.fixture(scope="module")
def created_ids():
    return []


def _future_iso(mins=60):
    return (datetime.now(timezone.utc) + timedelta(minutes=mins)).isoformat()


def test_create_recurring_reminder_at(client, created_ids):
    payload = {
        "title": "TEST_recurring_at",
        "reminder_at": _future_iso(60),
        "reminder_interval_min": 15,
        "reminder_repeat_total": 20,
        "reminder_repeat_left": 20,
    }
    r = client.post(f"{BASE_URL}/api/tasks", json=payload)
    assert r.status_code == 200, r.text
    t = r.json()
    created_ids.append(t["id"])
    assert t["reminder_at"] is not None
    assert t["reminder_interval_min"] == 15
    assert t["reminder_repeat_total"] == 20
    assert t["reminder_repeat_left"] == 20

    # GET-verify persistence
    g = client.get(f"{BASE_URL}/api/tasks/{t['id']}")
    assert g.status_code == 200
    gg = g.json()
    assert gg["reminder_interval_min"] == 15
    assert gg["reminder_repeat_total"] == 20


def test_create_recurring_reminder_relative(client, created_ids):
    # Simulate 'in 2 hours' — frontend computes reminder_at itself
    at = _future_iso(120)
    payload = {
        "title": "TEST_recurring_in",
        "reminder_at": at,
        "reminder_interval_min": 30,
        "reminder_repeat_total": 3,
        "reminder_repeat_left": 3,
    }
    r = client.post(f"{BASE_URL}/api/tasks", json=payload)
    assert r.status_code == 200, r.text
    t = r.json()
    created_ids.append(t["id"])
    assert t["reminder_interval_min"] == 30
    assert t["reminder_repeat_total"] == 3


def test_create_without_reminder_regression(client, created_ids):
    r = client.post(f"{BASE_URL}/api/tasks", json={"title": "TEST_no_reminder"})
    assert r.status_code == 200, r.text
    t = r.json()
    created_ids.append(t["id"])
    assert t.get("reminder_at") is None
    assert t.get("reminder_interval_min") is None
    assert t.get("reminder_repeat_total") is None


def test_patch_adds_recurring(client, created_ids):
    # Create bare, then patch to add recurring
    r = client.post(f"{BASE_URL}/api/tasks", json={"title": "TEST_patch_add"})
    tid = r.json()["id"]
    created_ids.append(tid)
    upd = {
        "reminder_at": _future_iso(90),
        "reminder_interval_min": 60,
        "reminder_repeat_total": 5,
        "reminder_repeat_left": 5,
    }
    p = client.patch(f"{BASE_URL}/api/tasks/{tid}", json=upd)
    assert p.status_code == 200, p.text
    pj = p.json()
    assert pj["reminder_interval_min"] == 60
    assert pj["reminder_repeat_total"] == 5
    assert pj["reminder_at"] is not None


def test_patch_title_only_does_not_touch_reminder(client, created_ids):
    # Regression: patching only the title on a task with no reminder must NOT arm one.
    r = client.post(f"{BASE_URL}/api/tasks", json={"title": "TEST_dirty_flag"})
    tid = r.json()["id"]
    created_ids.append(tid)
    p = client.patch(f"{BASE_URL}/api/tasks/{tid}", json={"title": "TEST_dirty_flag_edited"})
    assert p.status_code == 200
    pj = p.json()
    assert pj["title"] == "TEST_dirty_flag_edited"
    assert pj.get("reminder_at") is None
    assert pj.get("reminder_interval_min") is None
    assert pj.get("reminder_repeat_total") is None


def test_patch_clear_recurring_via_explicit_null(client, created_ids):
    r = client.post(f"{BASE_URL}/api/tasks", json={
        "title": "TEST_clear",
        "reminder_at": _future_iso(30),
        "reminder_interval_min": 10,
        "reminder_repeat_total": 4,
        "reminder_repeat_left": 4,
    })
    tid = r.json()["id"]
    created_ids.append(tid)
    p = client.patch(f"{BASE_URL}/api/tasks/{tid}", json={
        "reminder_at": None,
        "reminder_interval_min": None,
        "reminder_repeat_total": None,
        "reminder_repeat_left": None,
    })
    assert p.status_code == 200
    pj = p.json()
    assert pj.get("reminder_at") is None
    assert pj.get("reminder_interval_min") is None
    assert pj.get("reminder_repeat_total") is None


def test_zzz_cleanup(client, created_ids):
    for tid in created_ids:
        client.delete(f"{BASE_URL}/api/tasks/{tid}")
