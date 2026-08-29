"""Local backup service for Sertex — Faz 4.

- Daily MongoDB dump (BSON via mongodump) + user files snapshot from Emergent
  Object Storage. Everything packed into a single `.zip` archive.
- Grandfather-Father-Son retention: 7 daily + 4 weekly + 12 monthly.
- Filesystem: `/app/backend/backups/` (persisted in the app volume).
- Exposed via `backup_router.py` with a UI in `BackupPanel.jsx`.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import os
import subprocess
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

BACKUP_ROOT = Path(os.environ.get("SERTEX_BACKUP_ROOT", "/app/backend/backups"))
BACKUP_ROOT.mkdir(parents=True, exist_ok=True)

RETENTION_DAILY = int(os.environ.get("SERTEX_BACKUP_RETENTION_DAILY", "7"))
RETENTION_WEEKLY = int(os.environ.get("SERTEX_BACKUP_RETENTION_WEEKLY", "4"))
RETENTION_MONTHLY = int(os.environ.get("SERTEX_BACKUP_RETENTION_MONTHLY", "12"))


# ---- Helpers -------------------------------------------------------------
def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(65536), b""):
            h.update(chunk)
    return h.hexdigest()


def _human_size(n: int) -> str:
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if n < 1024 or unit == "TB":
            return f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


def _iso_stamp(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d_%H%M%S")


# ---- Steps --------------------------------------------------------------
def _dump_mongo(dest_dir: Path, mongo_url: str, db_name: str) -> Dict[str, Any]:
    """Run `mongodump` for the whole db → BSON tree under dest_dir/mongodb/"""
    out_dir = dest_dir / "mongodb"
    out_dir.mkdir(parents=True, exist_ok=True)
    cmd = [
        "mongodump",
        "--uri", mongo_url,
        "--db", db_name,
        "--out", str(out_dir),
        "--quiet",
    ]
    logger.info("Running mongodump for db=%s", db_name)
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0:
        raise RuntimeError(f"mongodump failed: {r.stderr[:400]}")
    # count collections + total size
    total = 0
    coll_count = 0
    for p in out_dir.rglob("*.bson"):
        total += p.stat().st_size
        coll_count += 1
    return {"collections": coll_count, "bytes": total}


async def _dump_user_files(dest_dir: Path, db) -> Dict[str, Any]:
    """Fetch every non-deleted user file from Emergent Object Storage
    and copy to dest_dir/files/<user_id>/<original_filename>.

    Returns {count, bytes}.
    """
    from storage_service import get_object

    files_dir = dest_dir / "files"
    files_dir.mkdir(parents=True, exist_ok=True)

    cursor = db.files.find(
        {"is_deleted": {"$ne": True}},
        {"_id": 0, "id": 1, "user_id": 1, "original_filename": 1, "storage_path": 1, "size": 1},
    )
    docs = await cursor.to_list(length=100_000)

    count = 0
    total = 0
    errors: List[Dict[str, str]] = []
    for d in docs:
        user_dir = files_dir / d["user_id"]
        user_dir.mkdir(parents=True, exist_ok=True)
        # Avoid duplicate filename clash: prefix with file id
        target = user_dir / f"{d['id']}__{d['original_filename']}"
        try:
            data, _ = get_object(d["storage_path"])
            target.write_bytes(data)
            total += target.stat().st_size
            count += 1
        except Exception as e:
            logger.warning("File fetch failed for %s: %s", d["id"], e)
            errors.append({"file_id": d["id"], "error": str(e)[:200]})
    return {"count": count, "bytes": total, "errors": errors}


def _write_manifest(dest_dir: Path, meta: Dict[str, Any]) -> Path:
    manifest_path = dest_dir / "manifest.json"
    manifest_path.write_text(
        json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    return manifest_path


def _zip_tree(src_dir: Path, zip_path: Path) -> None:
    """Zip src_dir into zip_path (deflate)."""
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=6) as zf:
        for p in src_dir.rglob("*"):
            if p.is_file():
                zf.write(p, arcname=p.relative_to(src_dir))


# ---- Public API ---------------------------------------------------------
async def run_backup(db, *, trigger: str = "manual") -> Dict[str, Any]:
    """Create a full backup archive. Idempotent (each call creates a new file).

    trigger: 'manual' | 'scheduled' | 'startup'
    """
    stamp = _iso_stamp(datetime.now(timezone.utc))
    archive_name = f"sertex_backup_{stamp}.zip"
    archive_path = BACKUP_ROOT / archive_name

    mongo_url = os.environ["MONGO_URL"]
    db_name = os.environ["DB_NAME"]

    started_at = datetime.now(timezone.utc)
    with tempfile.TemporaryDirectory(prefix="sertex_bak_", dir="/tmp") as tmp:
        tmp_dir = Path(tmp)
        # 1) MongoDB dump
        mongo_stats = _dump_mongo(tmp_dir, mongo_url, db_name)
        # 2) User files
        files_stats = await _dump_user_files(tmp_dir, db)
        # 3) Manifest
        manifest = {
            "sertex_backup_version": 1,
            "created_at_utc": started_at.isoformat(),
            "trigger": trigger,
            "db_name": db_name,
            "mongo": mongo_stats,
            "files": files_stats,
            "hostname": os.environ.get("HOSTNAME", ""),
        }
        _write_manifest(tmp_dir, manifest)
        # 4) Zip everything
        _zip_tree(tmp_dir, archive_path)

    finished_at = datetime.now(timezone.utc)
    size = archive_path.stat().st_size
    sha = _sha256(archive_path)

    record = {
        "id": str(uuid.uuid4()),
        "filename": archive_name,
        "path": str(archive_path),
        "size": size,
        "size_human": _human_size(size),
        "sha256": sha,
        "created_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
        "duration_sec": round((finished_at - started_at).total_seconds(), 2),
        "trigger": trigger,
        "manifest": manifest,
        "status": "ok",
    }

    # Persist metadata
    await db.backups.insert_one(record.copy())
    # Retention prune (async)
    try:
        await prune_backups(db)
    except Exception as e:
        logger.warning("Retention prune failed: %s", e)

    # Strip Mongo _id for return
    record.pop("_id", None)
    return record


async def list_backups(db) -> List[Dict[str, Any]]:
    """Return all known backups, newest first. Cross-checks filesystem."""
    docs = await db.backups.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    on_disk = {p.name for p in BACKUP_ROOT.glob("sertex_backup_*.zip")}
    # Mark missing files as broken
    for d in docs:
        d["exists"] = d["filename"] in on_disk
    return docs


async def get_backup(db, backup_id: str) -> Optional[Dict[str, Any]]:
    return await db.backups.find_one({"id": backup_id}, {"_id": 0})


async def delete_backup(db, backup_id: str) -> Dict[str, Any]:
    doc = await get_backup(db, backup_id)
    if not doc:
        return {"deleted": 0}
    p = Path(doc["path"])
    if p.exists():
        try:
            p.unlink()
        except Exception as e:
            logger.warning("Failed to unlink %s: %s", p, e)
    await db.backups.delete_one({"id": backup_id})
    return {"deleted": 1}


# ---- Retention (GFS) ----------------------------------------------------
def _week_key(dt: datetime) -> str:
    iso = dt.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"


def _month_key(dt: datetime) -> str:
    return dt.strftime("%Y-%m")


async def prune_backups(db) -> Dict[str, Any]:
    """Enforce grandfather-father-son retention.

    Keep:
      * The most recent RETENTION_DAILY daily backups (any trigger).
      * The most recent RETENTION_WEEKLY weekly backups (1 per iso-week).
      * The most recent RETENTION_MONTHLY monthly backups (1 per year-month).
    """
    docs = await db.backups.find({}, {"_id": 0}).sort("created_at", -1).to_list(500)
    if len(docs) <= RETENTION_DAILY:
        return {"kept": len(docs), "removed": 0, "removed_ids": []}

    keep_ids: set = set()

    # 1) Newest N as "daily"
    daily = docs[:RETENTION_DAILY]
    for d in daily:
        keep_ids.add(d["id"])

    # 2) One-per-week for the last RETENTION_WEEKLY iso-weeks (skip weeks
    #    already covered by 'daily')
    weekly_seen: set = set()
    for d in docs:
        try:
            dt = datetime.fromisoformat(d["created_at"])
        except Exception:
            continue
        wk = _week_key(dt)
        if wk in weekly_seen:
            continue
        weekly_seen.add(wk)
        keep_ids.add(d["id"])
        if len(weekly_seen) >= RETENTION_WEEKLY:
            break

    # 3) One-per-month for the last RETENTION_MONTHLY months
    monthly_seen: set = set()
    for d in docs:
        try:
            dt = datetime.fromisoformat(d["created_at"])
        except Exception:
            continue
        mk = _month_key(dt)
        if mk in monthly_seen:
            continue
        monthly_seen.add(mk)
        keep_ids.add(d["id"])
        if len(monthly_seen) >= RETENTION_MONTHLY:
            break

    to_remove = [d for d in docs if d["id"] not in keep_ids]
    removed_ids: List[str] = []
    for d in to_remove:
        p = Path(d["path"])
        if p.exists():
            try:
                p.unlink()
            except Exception as e:
                logger.warning("Failed to unlink %s: %s", p, e)
        await db.backups.delete_one({"id": d["id"]})
        removed_ids.append(d["id"])

    return {"kept": len(keep_ids), "removed": len(removed_ids), "removed_ids": removed_ids}


# ---- Scheduler ----------------------------------------------------------
_scheduler = None


def start_scheduler(db, get_loop=None) -> None:
    """Start APScheduler for daily backups at 03:00 UTC. Idempotent."""
    global _scheduler
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger

    if _scheduler is not None:
        return

    hour = int(os.environ.get("SERTEX_BACKUP_HOUR", "3"))
    minute = int(os.environ.get("SERTEX_BACKUP_MINUTE", "0"))

    scheduler = AsyncIOScheduler(timezone="UTC")

    async def _job():
        try:
            logger.info("Scheduled backup starting…")
            r = await run_backup(db, trigger="scheduled")
            logger.info("Scheduled backup finished: %s (%s)",
                        r["filename"], r["size_human"])
        except Exception as e:
            logger.exception("Scheduled backup failed: %s", e)

    scheduler.add_job(
        _job,
        CronTrigger(hour=hour, minute=minute),
        id="sertex-daily-backup",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Backup scheduler started (daily at %02d:%02d UTC)", hour, minute)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception as exc:
            logger.warning("backup scheduler shutdown failed: %s", exc)
        _scheduler = None


async def scheduler_status() -> Dict[str, Any]:
    global _scheduler
    if _scheduler is None:
        return {"running": False, "jobs": []}
    jobs = []
    for j in _scheduler.get_jobs():
        next_run = j.next_run_time.isoformat() if j.next_run_time else None
        jobs.append({"id": j.id, "next_run": next_run})
    return {"running": True, "jobs": jobs}
