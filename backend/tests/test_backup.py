"""Faz 4 — Local Backup System — API tests.

Endpoints under /api/backup/* (admin only):
 - GET  /status
 - GET  /list
 - POST /run
 - POST /prune
 - GET  /{id}
 - GET  /{id}/download
 - DELETE /{id}

Also runs quick regression checks against previously-passing endpoints
(/api/health, /api/files, /api/tasks, /api/memory).
"""
from __future__ import annotations

import io
import os
import re
import time
import zipfile
from pathlib import Path

import pytest
import requests

BASE_URL = os.environ.get(
    "REACT_APP_BACKEND_URL", "https://functional-themes.preview.emergentagent.com"
).rstrip("/")
API = f"{BASE_URL}/api"

ADMIN = {"username": "serkan", "password": "19071987"}
USER = {"username": "ahmet", "password": "ahmet123"}

# The pre-existing manual backup we should NOT delete
PRESERVED_FILENAME = "sertex_backup_2026-07-23_164034.zip"


# ---- Fixtures --------------------------------------------------------------
@pytest.fixture(scope="session")
def admin_token() -> str:
    r = requests.post(f"{API}/auth/login", json=ADMIN, timeout=15)
    assert r.status_code == 200, f"admin login failed: {r.status_code} {r.text}"
    return r.json()["token"]


@pytest.fixture(scope="session")
def user_token() -> str:
    r = requests.post(f"{API}/auth/login", json=USER, timeout=15)
    assert r.status_code == 200, f"user login failed: {r.status_code} {r.text}"
    return r.json()["token"]


def _auth(t: str) -> dict:
    return {"Authorization": f"Bearer {t}"}


# ---- 1. AUTH: admin only ---------------------------------------------------
class TestBackupAuth:
    """/api/backup/* endpoints require Bearer token AND role=admin."""

    endpoints = [
        ("GET", "/backup/status"),
        ("GET", "/backup/list"),
        ("POST", "/backup/run"),
        ("POST", "/backup/prune"),
    ]

    def test_no_auth_rejects(self):
        for method, path in self.endpoints:
            r = requests.request(method, f"{API}{path}", timeout=10)
            assert r.status_code in (401, 403), (
                f"{method} {path} should require auth, got {r.status_code}"
            )

    def test_regular_user_forbidden(self, user_token):
        for method, path in self.endpoints:
            r = requests.request(
                method, f"{API}{path}", headers=_auth(user_token), timeout=10
            )
            assert r.status_code == 403, (
                f"{method} {path} should return 403 for regular user, got "
                f"{r.status_code}: {r.text[:200]}"
            )


# ---- 2. STATUS -------------------------------------------------------------
class TestBackupStatus:
    def test_status_shape(self, admin_token):
        r = requests.get(
            f"{API}/backup/status", headers=_auth(admin_token), timeout=10
        )
        assert r.status_code == 200, r.text
        data = r.json()
        # top-level
        assert "scheduler" in data
        assert "count" in data
        assert "total_bytes" in data
        assert "backup_root" in data
        assert data["backup_root"] == "/app/backend/backups"
        # scheduler
        sched = data["scheduler"]
        assert sched.get("running") is True, f"scheduler not running: {sched}"
        jobs = sched.get("jobs") or []
        assert len(jobs) >= 1, f"no scheduler jobs: {sched}"
        job = jobs[0]
        assert job["id"] == "sertex-daily-backup"
        assert job.get("next_run"), f"job missing next_run: {job}"
        # next_run must be ISO-8601 parsable
        assert re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}", job["next_run"])


# ---- 3. LIST ---------------------------------------------------------------
class TestBackupList:
    def test_list_shape_and_ordering(self, admin_token):
        r = requests.get(
            f"{API}/backup/list", headers=_auth(admin_token), timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "backups" in data and isinstance(data["backups"], list)
        backups = data["backups"]
        # Verify ordering newest -> oldest
        for i in range(1, len(backups)):
            assert backups[i - 1]["created_at"] >= backups[i]["created_at"], (
                "backups not newest-first"
            )
        # Verify per-item required fields
        required = {
            "id", "filename", "size", "size_human", "sha256", "created_at",
            "duration_sec", "trigger", "status", "exists",
            "mongo_collections", "mongo_bytes", "files_count", "files_bytes",
            "file_errors",
        }
        for b in backups:
            missing = required - set(b.keys())
            assert not missing, f"backup missing fields {missing}: {b}"


# ---- 4. RUN (background) ---------------------------------------------------
class TestBackupRun:
    @pytest.fixture(scope="class")
    def created_backup(self, admin_token):
        """Trigger a manual backup and wait until it appears in list."""
        # Snapshot current count
        r0 = requests.get(
            f"{API}/backup/list", headers=_auth(admin_token), timeout=10
        )
        assert r0.status_code == 200
        before_ids = {b["id"] for b in r0.json()["backups"]}
        before_count = len(before_ids)

        # Kick off backup
        r = requests.post(
            f"{API}/backup/run", headers=_auth(admin_token), timeout=10
        )
        assert r.status_code == 200, r.text
        assert r.json().get("status") == "started"

        # Poll for up to 45s for the new record
        deadline = time.time() + 45
        new_doc = None
        while time.time() < deadline:
            rl = requests.get(
                f"{API}/backup/list", headers=_auth(admin_token), timeout=10
            )
            if rl.status_code == 200:
                for b in rl.json()["backups"]:
                    if b["id"] not in before_ids and b.get("status") == "ok":
                        new_doc = b
                        break
                if new_doc:
                    break
            time.sleep(2)

        assert new_doc is not None, (
            f"No new backup appeared within 45s (before={before_count})"
        )
        return new_doc

    def test_run_returns_started_and_creates_record(self, created_backup):
        b = created_backup
        assert b["status"] == "ok"
        assert b["exists"] is True
        assert b["size"] > 0
        assert re.fullmatch(r"[0-9a-f]{64}", b["sha256"]), (
            f"bad sha256: {b['sha256']}"
        )
        assert b["trigger"] == "manual"
        assert b["mongo_collections"] >= 5, (
            f"mongo_collections too low: {b['mongo_collections']}"
        )

    def test_run_creates_file_on_disk(self, created_backup):
        p = Path("/app/backend/backups") / created_backup["filename"]
        assert p.exists(), f"backup file missing: {p}"
        assert p.stat().st_size == created_backup["size"]

    def test_download_returns_valid_zip(self, admin_token, created_backup):
        r = requests.get(
            f"{API}/backup/{created_backup['id']}/download",
            headers=_auth(admin_token),
            timeout=30,
        )
        assert r.status_code == 200, r.text[:400]
        # Content-Disposition contains filename
        cd = r.headers.get("content-disposition", "")
        assert created_backup["filename"] in cd, f"bad CD: {cd}"
        # Content-Type must be zip
        ct = r.headers.get("content-type", "")
        assert "zip" in ct.lower(), f"bad CT: {ct}"
        # Zip magic bytes
        assert r.content[:2] == b"PK", (
            f"not a zip; first bytes={r.content[:4]!r}"
        )
        # Actually openable as a zip; verify manifest.json is inside
        zf = zipfile.ZipFile(io.BytesIO(r.content))
        names = zf.namelist()
        assert "manifest.json" in names, f"no manifest.json in archive: {names[:20]}"
        # Manifest is valid JSON with expected keys
        import json as _json
        with zf.open("manifest.json") as fh:
            m = _json.loads(fh.read().decode("utf-8"))
        assert m["sertex_backup_version"] == 1
        assert "mongo" in m and "files" in m
        assert m["mongo"]["collections"] >= 5
        # BSON dumps present
        bson_names = [n for n in names if n.endswith(".bson")]
        assert len(bson_names) >= 5, f"too few bson files: {bson_names}"

    def test_get_by_id(self, admin_token, created_backup):
        r = requests.get(
            f"{API}/backup/{created_backup['id']}",
            headers=_auth(admin_token),
            timeout=10,
        )
        assert r.status_code == 200
        assert r.json()["id"] == created_backup["id"]

    def test_get_missing_returns_404(self, admin_token):
        r = requests.get(
            f"{API}/backup/does-not-exist-xyz",
            headers=_auth(admin_token),
            timeout=10,
        )
        assert r.status_code == 404


# ---- 5. DELETE -------------------------------------------------------------
class TestBackupDelete:
    def test_delete_removes_both_record_and_file(self, admin_token):
        # Create a fresh backup we can safely delete
        r = requests.post(
            f"{API}/backup/run", headers=_auth(admin_token), timeout=10
        )
        assert r.status_code == 200

        # Wait for it to finish
        deadline = time.time() + 45
        target = None
        while time.time() < deadline:
            rl = requests.get(
                f"{API}/backup/list", headers=_auth(admin_token), timeout=10
            )
            latest = rl.json()["backups"]
            if latest and latest[0].get("status") == "ok" and latest[0].get("exists"):
                target = latest[0]
                # Ensure we don't delete the preserved backup
                if target["filename"] == PRESERVED_FILENAME:
                    target = latest[1] if len(latest) > 1 else None
                if target:
                    break
            time.sleep(2)
        assert target is not None, "no backup available to delete"
        assert target["filename"] != PRESERVED_FILENAME, (
            "must not delete preserved backup"
        )

        file_path = Path("/app/backend/backups") / target["filename"]
        assert file_path.exists(), "target file should exist before delete"

        # First DELETE
        r = requests.delete(
            f"{API}/backup/{target['id']}",
            headers=_auth(admin_token),
            timeout=10,
        )
        assert r.status_code == 200, r.text
        assert r.json()["deleted"] == 1

        # File gone from disk
        assert not file_path.exists(), f"file still on disk: {file_path}"

        # Second DELETE → 0
        r2 = requests.delete(
            f"{API}/backup/{target['id']}",
            headers=_auth(admin_token),
            timeout=10,
        )
        assert r2.status_code == 200
        assert r2.json()["deleted"] == 0

        # Verify not returned by GET
        rg = requests.get(
            f"{API}/backup/{target['id']}",
            headers=_auth(admin_token),
            timeout=10,
        )
        assert rg.status_code == 404


# ---- 6. PRUNE (GFS retention) ---------------------------------------------
class TestBackupPrune:
    def test_prune_returns_shape(self, admin_token):
        r = requests.post(
            f"{API}/backup/prune", headers=_auth(admin_token), timeout=15
        )
        assert r.status_code == 200, r.text
        data = r.json()
        assert "kept" in data
        assert "removed" in data
        assert "removed_ids" in data
        assert isinstance(data["removed_ids"], list)

    def test_prune_noop_when_few_backups(self, admin_token):
        """When count <= RETENTION_DAILY (7) nothing should be removed."""
        rl = requests.get(
            f"{API}/backup/list", headers=_auth(admin_token), timeout=10
        )
        count = len(rl.json()["backups"])
        if count > 7:
            pytest.skip(f"skipping noop test: {count} backups already")
        r = requests.post(
            f"{API}/backup/prune", headers=_auth(admin_token), timeout=15
        )
        assert r.status_code == 200
        data = r.json()
        assert data["removed"] == 0, (
            f"prune should be no-op with {count} backups, removed {data['removed']}"
        )


# ---- 7. Regression: previously-passing endpoints --------------------------
class TestRegression:
    def test_health(self):
        r = requests.get(f"{API}/health", timeout=10)
        assert r.status_code == 200

    def test_files_list(self, admin_token):
        r = requests.get(f"{API}/files", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200

    def test_tasks_list(self, admin_token):
        r = requests.get(f"{API}/tasks", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200

    def test_memory_list(self, admin_token):
        r = requests.get(f"{API}/memory", headers=_auth(admin_token), timeout=10)
        assert r.status_code == 200

    def test_conversations_list(self, admin_token):
        r = requests.get(
            f"{API}/conversations", headers=_auth(admin_token), timeout=10
        )
        assert r.status_code == 200


# ---- 8. Teardown: clean up any TEST-created extra backups -----------------
@pytest.fixture(scope="session", autouse=True)
def _cleanup_created_backups(admin_token):
    """Remove all backups created during this test session, but preserve the
    pre-existing manual one referenced by the main agent."""
    # Snapshot ids before session
    r = requests.get(
        f"{API}/backup/list", headers=_auth(admin_token), timeout=10
    )
    before_ids = {b["id"] for b in r.json().get("backups", [])} if r.ok else set()
    yield
    # Delete any brand-new backups
    r2 = requests.get(
        f"{API}/backup/list", headers=_auth(admin_token), timeout=10
    )
    if not r2.ok:
        return
    for b in r2.json().get("backups", []):
        if b["id"] in before_ids:
            continue
        if b["filename"] == PRESERVED_FILENAME:
            continue
        try:
            requests.delete(
                f"{API}/backup/{b['id']}",
                headers=_auth(admin_token),
                timeout=10,
            )
        except Exception:
            pass
