"""FastAPI router for Sertex backup system (Faz 4).

Admin-only endpoints (require role=admin) — backups contain the whole DB.
"""
import logging
from pathlib import Path

from fastapi import APIRouter, HTTPException, Depends, BackgroundTasks
from fastapi.responses import FileResponse

from backup_service import (
    run_backup,
    list_backups,
    get_backup,
    delete_backup,
    prune_backups,
    scheduler_status,
    BACKUP_ROOT,
)

logger = logging.getLogger(__name__)


def build_backup_router(db, current_user):
    router = APIRouter(prefix="/backup", tags=["backup"])

    async def _admin_only(user: dict = Depends(current_user)):
        from permissions import is_super_admin
        if not is_super_admin(user):
            raise HTTPException(
                status_code=403,
                detail="Yalnızca süper yönetici bu işlemi yapabilir",
            )
        return user

    @router.get("/status")
    async def status(_user: dict = Depends(_admin_only)):
        sched = await scheduler_status()
        docs = await list_backups(db)
        total = sum(d.get("size", 0) for d in docs)
        last = docs[0] if docs else None
        return {
            "scheduler": sched,
            "count": len(docs),
            "total_bytes": total,
            "last_backup": last,
            "backup_root": str(BACKUP_ROOT),
        }

    @router.get("/list")
    async def list_all(_user: dict = Depends(_admin_only)):
        docs = await list_backups(db)
        # Strip manifest.files.errors and large manifest payload from the list
        # view to keep it snappy.
        stripped = []
        for d in docs:
            slim = {k: v for k, v in d.items() if k != "manifest"}
            m = d.get("manifest", {}) or {}
            slim["mongo_collections"] = (m.get("mongo") or {}).get("collections", 0)
            slim["mongo_bytes"] = (m.get("mongo") or {}).get("bytes", 0)
            slim["files_count"] = (m.get("files") or {}).get("count", 0)
            slim["files_bytes"] = (m.get("files") or {}).get("bytes", 0)
            slim["file_errors"] = len((m.get("files") or {}).get("errors", []) or [])
            stripped.append(slim)
        return {"backups": stripped}

    @router.post("/run")
    async def run_now(
        background_tasks: BackgroundTasks,
        _user: dict = Depends(_admin_only),
    ):
        """Kick off a backup in the background so the request returns fast."""
        background_tasks.add_task(_safe_run, db)
        return {"status": "started"}

    @router.post("/prune")
    async def prune_now(_user: dict = Depends(_admin_only)):
        r = await prune_backups(db)
        return r

    @router.get("/{backup_id}")
    async def show(backup_id: str, _user: dict = Depends(_admin_only)):
        doc = await get_backup(db, backup_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Yedek bulunamadı")
        return doc

    @router.get("/{backup_id}/download")
    async def download(backup_id: str, _user: dict = Depends(_admin_only)):
        doc = await get_backup(db, backup_id)
        if not doc:
            raise HTTPException(status_code=404, detail="Yedek bulunamadı")
        p = Path(doc["path"])
        if not p.exists():
            raise HTTPException(status_code=410, detail="Yedek dosyası diskte yok")
        return FileResponse(
            path=str(p),
            filename=doc["filename"],
            media_type="application/zip",
        )

    @router.delete("/{backup_id}")
    async def remove(backup_id: str, _user: dict = Depends(_admin_only)):
        r = await delete_backup(db, backup_id)
        return r

    return router


async def _safe_run(db):
    """Guarded background run so exceptions don't crash the worker."""
    try:
        r = await run_backup(db, trigger="manual")
        logger.info("Manual backup ok: %s", r.get("filename"))
    except Exception as e:
        logger.exception("Manual backup failed: %s", e)
