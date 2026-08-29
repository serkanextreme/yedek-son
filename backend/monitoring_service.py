"""Sertex — Faz 9 CP4: Production Monitoring.

In-memory error counter + structured JSON logging + `/api/admin/health`
metrics aggregator. Zero external dependencies (no APM SaaS) so we can
still run entirely inside the K8s pod.

Components:
- `ErrorCounter`: thread-safe rolling counter (last 24h + all-time totals).
- `SertexJsonFormatter`: `logging.Formatter` that emits JSON lines. Called
  by the app root logger *and* the FastAPI request middleware.
- `install_error_hook(logger_name)`: attaches a `logging.Handler` that
  bumps the counter on any WARNING+ log record.
- `build_health_snapshot(db)`: async — returns the payload consumed by
  the `/api/admin/health` endpoint (uptime, uv counts, backend errors,
  DB stats).

Kept intentionally small and dependency-free.
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import platform
import time
from collections import deque
from datetime import datetime, timezone, timedelta
from threading import Lock
from typing import Any, Dict, Optional

_BOOT_TS = time.time()


# ---------------------------------------------------------------------------
# Error counter — in-memory, tracks WARNING/ERROR/CRITICAL log events
# ---------------------------------------------------------------------------
class ErrorCounter:
    """Lightweight in-process counter for backend errors."""

    def __init__(self, window_hours: int = 24) -> None:
        self._lock = Lock()
        self._window_seconds = window_hours * 3600
        self._events: deque[tuple[float, str, str]] = deque(maxlen=1000)
        self._total_by_level: Dict[str, int] = {"WARNING": 0, "ERROR": 0, "CRITICAL": 0}
        # Recent (last 20) error messages for the admin dashboard.
        self._recent_errors: deque[dict] = deque(maxlen=20)

    def record(self, level: str, logger_name: str, message: str) -> None:
        now = time.time()
        with self._lock:
            self._events.append((now, level, logger_name))
            self._total_by_level[level] = self._total_by_level.get(level, 0) + 1
            if level in ("ERROR", "CRITICAL"):
                self._recent_errors.append({
                    "ts": datetime.fromtimestamp(now, tz=timezone.utc).isoformat(),
                    "level": level,
                    "logger": logger_name,
                    "message": message[:300],
                })

    def snapshot(self) -> Dict[str, Any]:
        cutoff = time.time() - self._window_seconds
        with self._lock:
            windowed = {"WARNING": 0, "ERROR": 0, "CRITICAL": 0}
            for ts, lvl, _ in self._events:
                if ts >= cutoff:
                    windowed[lvl] = windowed.get(lvl, 0) + 1
            return {
                "window_hours": self._window_seconds // 3600,
                "windowed": dict(windowed),
                "total": dict(self._total_by_level),
                "recent": list(self._recent_errors)[-10:],
            }


ERROR_COUNTER = ErrorCounter(window_hours=24)


# ---------------------------------------------------------------------------
# JSON log formatter
# ---------------------------------------------------------------------------
class SertexJsonFormatter(logging.Formatter):
    """Emit each log record as a single JSON line."""

    def format(self, record: logging.LogRecord) -> str:  # type: ignore[override]
        payload = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exception"] = self.formatException(record.exc_info)
        # Attach extras (added via `logger.info("x", extra={...})`)
        for k, v in record.__dict__.items():
            if k in ("args", "msg", "message", "levelname", "levelno",
                     "pathname", "filename", "module", "exc_info", "exc_text",
                     "stack_info", "lineno", "funcName", "created", "msecs",
                     "relativeCreated", "thread", "threadName", "processName",
                     "process", "name"):
                continue
            try:
                json.dumps(v)
                payload[k] = v
            except (TypeError, ValueError):
                payload[k] = str(v)
        return json.dumps(payload, ensure_ascii=False)


# ---------------------------------------------------------------------------
# Handler that feeds the counter
# ---------------------------------------------------------------------------
class _CounterHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:  # type: ignore[override]
        if record.levelno < logging.WARNING:
            return
        try:
            ERROR_COUNTER.record(record.levelname, record.name, record.getMessage())
        except Exception:
            pass  # bilerek sessiz: bu bir logging handler; burada log atmak sonsuz döngü yaratır


def install_structured_logging(json_mode: bool = False) -> None:
    """Wire the counter handler into the root logger.

    When SERTEX_LOG_JSON=1 (or `json_mode=True`), swap the default text
    formatter for JSON output. Idempotent.
    """
    root = logging.getLogger()
    # Guard against duplicate handler installs on hot-reload.
    already = any(isinstance(h, _CounterHandler) for h in root.handlers)
    if not already:
        h = _CounterHandler()
        h.setLevel(logging.WARNING)
        root.addHandler(h)

    if json_mode or os.environ.get("SERTEX_LOG_JSON") == "1":
        for h in root.handlers:
            if isinstance(h, _CounterHandler):
                continue
            try:
                h.setFormatter(SertexJsonFormatter())
            except Exception:
                pass  # bilerek sessiz: logging kurulumu sırasında, henüz güvenilir bir log kanalı yok


# ---------------------------------------------------------------------------
# Health snapshot builder
# ---------------------------------------------------------------------------
async def build_health_snapshot(db) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    day_ago = (now - timedelta(hours=24)).isoformat()

    async def _safe_count(coll: str, q: dict) -> int:
        try:
            return await db[coll].count_documents(q)
        except Exception:
            return 0

    async def _safe(fn):
        try:
            return await fn()
        except Exception:
            return None

    users_total = await _safe_count("users", {})
    users_active_24h = await _safe_count(
        "users", {"last_login_at": {"$gte": day_ago}}
    )
    users_admin = await _safe_count("users", {"role": "admin"})
    users_manager = await _safe_count("users", {"role": "manager"})
    users_employee = await _safe_count("users", {"role": "employee"})

    tasks_total = await _safe_count("tasks", {})
    tasks_created_24h = await _safe_count(
        "tasks", {"created_at": {"$gte": day_ago}}
    )
    tasks_done_24h = await _safe_count(
        "tasks",
        {"status": "done", "updated_at": {"$gte": day_ago}},
    )
    tasks_overdue = await _safe_count(
        "tasks",
        {
            "status": {"$ne": "done"},
            "due_date": {"$lt": now.isoformat(), "$ne": None},
            "$or": [{"archived": {"$exists": False}}, {"archived": False}],
        },
    )
    tasks_orphaned = await _safe_count("tasks", {"orphaned": True})

    conversations_24h = await _safe_count(
        "conversations", {"updated_at": {"$gte": day_ago}}
    )
    messages_24h = await _safe_count("messages", {"created_at": {"$gte": day_ago}})
    notifications_unread = await _safe_count("notifications", {"read_at": None})

    # DB stats — a rough size roll-up
    db_stats: Dict[str, Any] = {}
    try:
        raw = await db.command("dbStats")
        db_stats = {
            "collections": raw.get("collections", 0),
            "data_size_mb": round((raw.get("dataSize") or 0) / (1024 * 1024), 2),
            "storage_size_mb": round((raw.get("storageSize") or 0) / (1024 * 1024), 2),
            "index_size_mb": round((raw.get("indexSize") or 0) / (1024 * 1024), 2),
            "objects": raw.get("objects", 0),
        }
    except Exception:
        db_stats = {}

    # Companies + licenses
    companies_total = await _safe_count("companies", {})
    licenses_active = await _safe_count(
        "licenses",
        {"status": "active"},
    )

    uptime_s = int(time.time() - _BOOT_TS)
    errors = ERROR_COUNTER.snapshot()

    return {
        "status": "ok",
        "server_time": now.isoformat(),
        "uptime_seconds": uptime_s,
        "uptime_human": _humanize_seconds(uptime_s),
        "python_version": platform.python_version(),
        "users": {
            "total": users_total,
            "active_24h": users_active_24h,
            "admin": users_admin,
            "manager": users_manager,
            "employee": users_employee,
        },
        "tasks": {
            "total": tasks_total,
            "created_24h": tasks_created_24h,
            "done_24h": tasks_done_24h,
            "overdue_open": tasks_overdue,
            "orphaned": tasks_orphaned,
        },
        "chat": {
            "conversations_24h": conversations_24h,
            "messages_24h": messages_24h,
        },
        "notifications": {
            "unread": notifications_unread,
        },
        "companies": {
            "total": companies_total,
        },
        "licenses": {
            "active": licenses_active,
        },
        "db": db_stats,
        "errors": errors,
    }


def _humanize_seconds(s: int) -> str:
    days, rem = divmod(s, 86400)
    hours, rem = divmod(rem, 3600)
    minutes, _ = divmod(rem, 60)
    parts = []
    if days: parts.append(f"{days}g")
    if hours: parts.append(f"{hours}s")
    if minutes and not days: parts.append(f"{minutes}dk")
    if not parts: parts.append(f"{s}sn")
    return " ".join(parts)
