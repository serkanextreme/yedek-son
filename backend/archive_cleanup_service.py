"""Otomatik Çöp Temizliği — arşivin SİLİNMİŞ (deleted=True) grubundaki görevleri,
admin/müdür tarafından ayarlanan saklama süresi (gün) dolduğunda geri dönüşü
olmayacak şekilde kalıcı siler.

Ayarlar `system_settings.key='global'` içinde:
  * trash_autoclean_enabled : bool  (kapalıyken HİÇBİR şey silinmez)
  * trash_autoclean_days    : int   (varsayılan 30)

Zamanlayıcı her gün 03:00 UTC'de çalışır (yedekleme zamanlayıcısıyla aynı saat).
"""
import logging
import os
from datetime import datetime, timezone, timedelta

logger = logging.getLogger(__name__)

_scheduler = None


async def purge_expired_trash(db) -> dict:
    """Süresi dolmuş çöp görevlerini kalıcı sil. Ayar kapalıysa no-op.
    Returns {enabled, days, cutoff, deleted}."""
    doc = await db.system_settings.find_one({"key": "global"}, {"_id": 0}) or {}
    enabled = bool(doc.get("trash_autoclean_enabled"))
    try:
        days = int(doc.get("trash_autoclean_days"))
    except (TypeError, ValueError):
        days = 30
    if days < 1:
        days = 30
    if not enabled:
        return {"enabled": False, "days": days, "cutoff": None, "deleted": 0}
    cutoff = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    # deleted_at bir ISO string; string karşılaştırması ISO-8601 için sıralamayı korur.
    r = await db.tasks.delete_many({"deleted": True, "deleted_at": {"$lt": cutoff}})
    if r.deleted_count:
        logger.info("Trash auto-clean: %d task(s) purged (older than %d days).", r.deleted_count, days)
    return {"enabled": True, "days": days, "cutoff": cutoff, "deleted": r.deleted_count}


def start_cleanup_scheduler(db, get_loop=None) -> None:
    """Günlük çöp temizliği zamanlayıcısını başlat (03:00 UTC). Idempotent."""
    global _scheduler
    from apscheduler.schedulers.asyncio import AsyncIOScheduler
    from apscheduler.triggers.cron import CronTrigger

    if _scheduler is not None:
        return

    hour = int(os.environ.get("SERTEX_TRASH_CLEAN_HOUR", "3"))
    minute = int(os.environ.get("SERTEX_TRASH_CLEAN_MINUTE", "0"))

    scheduler = AsyncIOScheduler(timezone="UTC")

    async def _job():
        try:
            r = await purge_expired_trash(db)
            if r.get("deleted"):
                logger.info("Scheduled trash clean: %s", r)
        except Exception as e:
            logger.exception("Scheduled trash clean failed: %s", e)

    scheduler.add_job(
        _job,
        CronTrigger(hour=hour, minute=minute),
        id="sertex-daily-trash-clean",
        replace_existing=True,
        misfire_grace_time=3600,
    )
    scheduler.start()
    _scheduler = scheduler
    logger.info("Trash cleanup scheduler started (daily at %02d:%02d UTC)", hour, minute)


def stop_scheduler() -> None:
    global _scheduler
    if _scheduler is not None:
        try:
            _scheduler.shutdown(wait=False)
        except Exception:
            pass
        _scheduler = None
