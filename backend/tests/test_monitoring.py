"""Sertex — Faz 9 CP4: `/api/admin/health` + monitoring service tests.

Covers:
- RBAC guard (only admin sees the endpoint)
- Payload structure and expected keys
- ErrorCounter windowed rollup
- Structured JSON logging formatter shape
"""
import json
import logging
import os

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com"
).rstrip("/")


def _login(username: str, password: str) -> str:
    r = requests.post(
        f"{BASE_URL}/api/auth/login",
        json={"username": username, "password": password},
        timeout=15,
    )
    assert r.status_code == 200, f"Login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="module")
def admin_token():
    return _login("serkan", "19071987")


@pytest.fixture(scope="module")
def manager_token():
    return _login("mgr_test", "mgr12345")


@pytest.fixture(scope="module")
def employee_token():
    return _login("emp1_test", "emp12345")


# ============================================================================
# Integration tests — HTTP endpoint
# ============================================================================
class TestAdminHealthEndpoint:
    def test_no_auth_returns_401(self):
        r = requests.get(f"{BASE_URL}/api/admin/health", timeout=15)
        assert r.status_code == 401

    def test_employee_forbidden(self, employee_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/health",
            headers={"Authorization": f"Bearer {employee_token}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_manager_forbidden(self, manager_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/health",
            headers={"Authorization": f"Bearer {manager_token}"},
            timeout=15,
        )
        assert r.status_code == 403

    def test_admin_ok(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/health",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        assert r.status_code == 200

    def test_shape_and_keys(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/health",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        body = r.json()
        for key in ("status", "server_time", "uptime_seconds", "uptime_human",
                    "python_version", "users", "tasks", "chat", "notifications",
                    "companies", "licenses", "db", "errors"):
            assert key in body, f"Missing key {key}"
        assert body["status"] == "ok"
        # Users sub-shape
        for k in ("total", "active_24h", "admin", "manager", "employee"):
            assert k in body["users"]
            assert isinstance(body["users"][k], int)
            assert body["users"][k] >= 0
        # Tasks sub-shape
        for k in ("total", "created_24h", "done_24h", "overdue_open", "orphaned"):
            assert k in body["tasks"]
            assert isinstance(body["tasks"][k], int)
            assert body["tasks"][k] >= 0
        # Errors rollup
        errs = body["errors"]
        assert errs["window_hours"] == 24
        assert isinstance(errs["windowed"], dict)
        assert isinstance(errs["total"], dict)
        assert isinstance(errs["recent"], list)
        # DB has size fields (may be zero if empty)
        assert isinstance(body["db"], dict)

    def test_uptime_monotonically_positive(self, admin_token):
        r = requests.get(
            f"{BASE_URL}/api/admin/health",
            headers={"Authorization": f"Bearer {admin_token}"},
            timeout=15,
        )
        body = r.json()
        assert isinstance(body["uptime_seconds"], int)
        assert body["uptime_seconds"] >= 0
        assert isinstance(body["uptime_human"], str)
        assert len(body["uptime_human"]) > 0


# ============================================================================
# Unit tests — service internals (no HTTP)
# ============================================================================
class TestMonitoringUnit:
    def test_error_counter_records_and_windows(self):
        from monitoring_service import ErrorCounter
        c = ErrorCounter(window_hours=24)
        c.record("ERROR", "app", "boom")
        c.record("WARNING", "app", "meh")
        c.record("CRITICAL", "app", "kaboom")
        snap = c.snapshot()
        assert snap["window_hours"] == 24
        assert snap["total"]["ERROR"] == 1
        assert snap["total"]["WARNING"] == 1
        assert snap["total"]["CRITICAL"] == 1
        assert snap["windowed"]["ERROR"] == 1
        assert len(snap["recent"]) == 2  # only ERROR + CRITICAL captured

    def test_json_formatter_emits_valid_json(self):
        from monitoring_service import SertexJsonFormatter
        fmt = SertexJsonFormatter()
        rec = logging.LogRecord(
            name="unit_test", level=logging.INFO, pathname=__file__, lineno=1,
            msg="hello %s", args=("world",), exc_info=None,
        )
        line = fmt.format(rec)
        parsed = json.loads(line)  # must be valid JSON
        assert parsed["level"] == "INFO"
        assert parsed["logger"] == "unit_test"
        assert parsed["message"] == "hello world"
        assert "ts" in parsed

    def test_install_structured_logging_is_idempotent(self):
        from monitoring_service import install_structured_logging, _CounterHandler
        root = logging.getLogger()
        install_structured_logging()
        n1 = sum(1 for h in root.handlers if isinstance(h, _CounterHandler))
        install_structured_logging()
        n2 = sum(1 for h in root.handlers if isinstance(h, _CounterHandler))
        assert n1 == n2 == 1  # never installs a duplicate

    def test_humanize_seconds(self):
        from monitoring_service import _humanize_seconds
        assert "sn" in _humanize_seconds(30)
        assert "dk" in _humanize_seconds(120)
        assert "s" in _humanize_seconds(3700)
        assert "g" in _humanize_seconds(90000)

    def test_error_counter_recent_capped(self):
        from monitoring_service import ErrorCounter
        c = ErrorCounter(window_hours=24)
        for i in range(50):
            c.record("ERROR", "spam", f"e{i}")
        snap = c.snapshot()
        # recent list capped at 10 for API safety
        assert len(snap["recent"]) == 10
        # Latest entry preserved
        assert snap["recent"][-1]["message"].startswith("e")
