"""Backend tests for workspace_mode + dual_mode persistence and /auth/me exposure.

Covers:
- PUT /api/settings/dual-mode {dual_mode:bool} -> persist + /auth/me reflects
- PUT /api/settings/workspace-mode {workspace_mode:"personal"|"team"} -> persist
- Validation error for invalid workspace_mode value
- is_owner flag exposed on /auth/me for serkan (owner) and false for mgr_test

Sequential execution — same user is never logged in twice simultaneously to
avoid the single-session kick.
"""
import os
import time

import pytest
import requests

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


def _login(username: str, password: str) -> str:
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": username, "password": password}, timeout=30)
    assert r.status_code == 200, f"login failed for {username}: {r.status_code} {r.text}"
    return r.json()["token"]


def _me(token: str) -> dict:
    r = requests.get(f"{BASE_URL}/api/auth/me", headers={"Authorization": f"Bearer {token}"}, timeout=30)
    assert r.status_code == 200, f"/auth/me failed: {r.status_code} {r.text}"
    return r.json()


def _set_workspace(token: str, mode: str):
    return requests.put(
        f"{BASE_URL}/api/settings/workspace-mode",
        headers={"Authorization": f"Bearer {token}"},
        json={"workspace_mode": mode},
        timeout=30,
    )


def _set_dual(token: str, enabled: bool):
    return requests.put(
        f"{BASE_URL}/api/settings/dual-mode",
        headers={"Authorization": f"Bearer {token}"},
        json={"dual_mode": enabled},
        timeout=30,
    )


class TestOwnerSerkan:
    """serkan (owner=true, super_admin) — dual/workspace persist + owner flag."""

    def test_serkan_flags_and_persistence(self):
        token = _login("serkan", "19071987")
        me = _me(token)
        assert me["username"] == "serkan"
        assert me.get("is_owner") is True, f"is_owner should be True for serkan, got {me.get('is_owner')}"

        # Enable dual mode
        r = _set_dual(token, True)
        assert r.status_code == 200, r.text
        assert r.json()["dual_mode"] is True
        me = _me(token)
        assert me["dual_mode"] is True

        # Set workspace_mode = personal
        r = _set_workspace(token, "personal")
        assert r.status_code == 200, r.text
        assert r.json()["workspace_mode"] == "personal"
        me = _me(token)
        assert me["workspace_mode"] == "personal"

        # Flip to team
        r = _set_workspace(token, "team")
        assert r.status_code == 200
        assert r.json()["workspace_mode"] == "team"
        me = _me(token)
        assert me["workspace_mode"] == "team"

        # Back to personal + dual on (final state that test request expects)
        r = _set_workspace(token, "personal")
        assert r.status_code == 200
        r = _set_dual(token, True)
        assert r.status_code == 200
        me = _me(token)
        assert me["workspace_mode"] == "personal"
        assert me["dual_mode"] is True

    def test_invalid_workspace_mode_rejected(self):
        token = _login("serkan", "19071987")
        r = _set_workspace(token, "bogus")
        assert r.status_code in (400, 422), f"expected 4xx, got {r.status_code}: {r.text}"


class TestManagerNonOwner:
    """mgr_test — non-owner manager. is_owner MUST be false."""

    def test_mgr_flags_and_persistence(self):
        token = _login("mgr_test", "mgr12345")
        me = _me(token)
        assert me["username"] == "mgr_test"
        assert bool(me.get("is_owner")) is False, "mgr_test must NOT be owner"
        assert me.get("role") == "manager"

        # Toggle dual on then off
        r = _set_dual(token, True)
        assert r.status_code == 200 and r.json()["dual_mode"] is True
        assert _me(token)["dual_mode"] is True
        r = _set_dual(token, False)
        assert r.status_code == 200 and r.json()["dual_mode"] is False
        assert _me(token)["dual_mode"] is False

        # Workspace personal ↔ team
        r = _set_workspace(token, "personal")
        assert r.status_code == 200 and r.json()["workspace_mode"] == "personal"
        assert _me(token)["workspace_mode"] == "personal"

        r = _set_workspace(token, "team")
        assert r.status_code == 200 and r.json()["workspace_mode"] == "team"
        assert _me(token)["workspace_mode"] == "team"

        # Leave in personal (predictable state for UI tests)
        _set_workspace(token, "personal")
