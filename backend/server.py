from fastapi import FastAPI, APIRouter, HTTPException, Request
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field
import uuid
from datetime import datetime, timezone


from files_router import build_files_router
from storage_service import init_storage
from rag_service import (
    ensure_indexes as ensure_rag_indexes,
)
# Faz 9 CP4.6 refactor — chat endpoint + models live in their own router.
# Re-exported here for any legacy import paths (tests, ad-hoc scripts).
from routers.chat_router import (
    build_chat_router,
)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

EMERGENT_LLM_KEY = os.environ.get("EMERGENT_LLM_KEY")

from auth import (
    seed_initial_user,
    get_current_user_factory,
    hash_password,
    require_admin,
)
from permissions import (
    run_permission_migrations,
)
from team_service import (
    ensure_indexes as ensure_team_indexes,
    start_scanner as start_team_scanner,
)

app = FastAPI(title="Sertex API")
api_router = APIRouter(prefix="/api")


# Auth dependency (bound to db)
_get_current_user_fn = None


async def current_user(request: Request):
    global _get_current_user_fn
    if _get_current_user_fn is None:
        _get_current_user_fn = await get_current_user_factory(db)
    return await _get_current_user_fn(request)


async def licensed_user(request: Request):
    """Verify JWT + require an active license (admins bypass)."""
    user = await current_user(request)
    from license_service import has_active_license as _has_active
    if not await _has_active(db, user):
        raise HTTPException(
            status_code=402,
            detail="NO_LICENSE: Aktif lisansın yok — devam etmek için bir kod kullan",
        )
    return user


@app.on_event("startup")
async def _startup():
    await seed_initial_user(db)
    await db.users.create_index("username", unique=True)
    await db.login_attempts.create_index("identifier")
    await db.memories.create_index("user_id")
    await db.files.create_index("user_id")
    await db.files.create_index([("user_id", 1), ("is_deleted", 1)])
    # Compound / user-scoped indexes for the NEURAL LINK stats aggregations
    # and all other per-user CRUD queries. Idempotent on repeat startup.
    try:
        await db.tasks.create_index([("user_id", 1), ("archived", 1), ("status", 1)])
        await db.notes.create_index("user_id")
        await db.conversations.create_index([("user_id", 1), ("updated_at", -1)])
        await db.messages.create_index([("user_id", 1), ("conversation_id", 1)])
        await db.reminders.create_index("user_id")
    except Exception as _e:
        logging.getLogger(__name__).warning(f"Per-user indexes failed: {_e}")

    # Faz 9 CP4.5 — Convenience indexes on the custom `id` (string) field.
    # Every collection here previously relied on a full COLLSCAN for
    # `find_one({"id": <uuid>})`, which becomes noticeable once a user
    # accumulates 500+ tasks / notes / conversations. Non-unique so an
    # accidental legacy duplicate won't abort startup — MongoDB will still
    # use these for O(log N) lookups. Each wrapped in its own try/except
    # so any single failure never blocks the others or the app boot.
    _id_index_collections = [
        "users", "tasks", "notes", "memories", "conversations", "messages",
        "files", "reminders", "companies", "notifications", "licenses",
        "task_categories", "company_permissions", "manager_visibility",
        "system_settings", "backups",
        # Faz 9 CP4.34 — lock system collections. Adding "id" index so single
        # doc lookups (delete/update by id) are O(log N).
        "task_lock_audit", "task_unlock_otps", "lock_policy_templates",
    ]
    for _coll in _id_index_collections:
        try:
            await db[_coll].create_index("id")
        except Exception as _e:
            logging.getLogger(__name__).warning(f"id index on {_coll} failed: {_e}")

    # Faz 9 CP4.34 — dedicated indexes for the lock/OTP/audit collections.
    # These are query-shape specific and shouldn't be conflated with the
    # generic "id" fallback above. Each wrapped in its own try/except so a
    # single failure doesn't block boot.
    try:
        # Audit: fastest query is "give me all events for a task, newest first".
        await db.task_lock_audit.create_index([("task_id", 1), ("created_at", -1)])
        await db.task_lock_audit.create_index("actor_user_id")
        # OTPs: single-active-lookup by (task_id, code_hash) + expiry sweeps.
        await db.task_unlock_otps.create_index([("task_id", 1), ("code_hash", 1)])
        await db.task_unlock_otps.create_index("expires_at")
        # Templates: list sorted by created_at (already the default sort).
        await db.lock_policy_templates.create_index("created_at")
        await db.lock_policy_templates.create_index("created_by")
    except Exception as _e:
        logging.getLogger(__name__).warning(f"Lock-system indexes failed: {_e}")

    await ensure_rag_indexes(db)
    await ensure_license_indexes(db)
    try:
        from email_service import ensure_indexes as ensure_email_indexes
        await ensure_email_indexes(db)
    except Exception as _e:
        logging.getLogger(__name__).warning(f"Email indexes failed: {_e}")
    # Start daily backup scheduler (idempotent)
    try:
        from backup_service import start_scheduler as _start_backup_scheduler
        _start_backup_scheduler(db)
    except Exception as _e:
        logger.warning(f"Backup scheduler start failed: {_e}")
    # Faz 9 CP7.2 — Start daily overdue-push scheduler (09:00 Europe/Istanbul).
    try:
        from overdue_push_service import start_overdue_scheduler as _start_overdue_scheduler
        _start_overdue_scheduler(db)
    except Exception as _e:
        logger.warning(f"Overdue push scheduler start failed: {_e}")
    # Arşiv v2 — Start daily trash auto-clean scheduler (03:00 UTC).
    try:
        from archive_cleanup_service import start_cleanup_scheduler as _start_trash_cleanup
        _start_trash_cleanup(db)
    except Exception as _e:
        logger.warning(f"Trash cleanup scheduler start failed: {_e}")
    # Warm up Emergent Object Storage session (non-fatal on failure)
    try:
        init_storage()
    except Exception as e:
        logging.getLogger(__name__).error(f"Storage init failed at startup: {e}")
    # Determine the founding OWNER / super-admin id (seeded first user). Used
    # only for legacy data backfills below. Never mutate an arbitrary user's
    # role here — the owner is guaranteed by seed_initial_user above.
    admin = (
        await db.users.find_one({"is_owner": True})
        or await db.users.find_one({"role": "super_admin"})
        or await db.users.find_one({"role": "admin"})
    )
    admin_id = admin["id"] if admin else None

    # Faz 8 — Multi-tenant RBAC migrations (idempotent). Must run BEFORE any
    # per-user endpoint sees traffic so `company_id` and normalized `role`
    # are consistent.
    try:
        await run_permission_migrations(db, admin_id)
    except Exception as _e:
        logging.getLogger(__name__).warning(f"Permission migrations failed: {_e}")

    # Team Faz 2 — notifications indexes + background overdue scanner. Kept
    # idempotent so app restarts and hot-reloads never spawn duplicate loops.
    try:
        await ensure_team_indexes(db)
        start_team_scanner(db)
    except Exception as _e:
        logging.getLogger(__name__).warning(f"Team scanner start failed: {_e}")

    # Migration: attach existing tasks/notes/conversations/messages without user_id to admin
    if admin_id:
        for col in ("tasks", "notes", "conversations", "messages"):
            await db[col].update_many(
                {"user_id": {"$exists": False}}, {"$set": {"user_id": admin_id}}
            )

    # One-time migration: move any old reminders into tasks (assigned to admin)
    old_reminders = await db.reminders.find({}, {"_id": 0}).to_list(length=1000)
    if old_reminders and admin_id:
        # Pre-fetch existing task IDs to avoid N+1 lookups
        candidate_ids = [r.get("id") for r in old_reminders if r.get("id")]
        existing = await db.tasks.find(
            {"id": {"$in": candidate_ids}}, {"id": 1, "_id": 0}
        ).to_list(length=len(candidate_ids) or 1) if candidate_ids else []
        existing_ids = {e["id"] for e in existing}

        to_insert = []
        for r in old_reminders:
            tid = r.get("id", str(uuid.uuid4()))
            if tid in existing_ids:
                continue
            to_insert.append({
                "id": tid,
                "user_id": admin_id,
                "title": r.get("title", "Hatırlatma"),
                "description": "",
                "status": "done" if r.get("completed") else "pending",
                "due_date": r.get("remind_at"),
                "reminder_at": r.get("remind_at"),
                "reminder_fired": False,
                "created_at": r.get("created_at", datetime.now(timezone.utc).isoformat()),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            })
        if to_insert:
            await db.tasks.insert_many(to_insert)



# ============ MODELS ============
# Chat/RAG models (ChatChart, Message, Conversation, ChatRequest,
# RagSource, ChatResponse) live in routers/chat_router.py and are
# re-exported at the top of this file (Faz 9 CP4.6 refactor).

class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    content: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class NoteCreate(BaseModel):
    content: str


class Reminder(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    remind_at: str  # ISO datetime string
    completed: bool = False
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class ReminderCreate(BaseModel):
    title: str
    remind_at: str


class TTSRequest(BaseModel):
    text: str
    voice: str = "onyx"


# ============ CHAT ============
# Faz 9 CP4.6 refactor — the /chat endpoint (previously ~155 lines here,
# including SYSTEM_PROMPT_TR / SYSTEM_PROMPT_EN and all memory + RAG +
# chart intent glue) now lives in routers/chat_router.py. This file mounts
# that router further down. Legacy imports still work via the top-of-file
# re-export block.


# ============ TASKS / CATEGORIES / ORPHANS ============
# Faz 9 refactor — all task-related endpoints (list/create/update/delete,
# subtasks, reorder, reassign, categories CRUD, orphan pool) live in
# routers/tasks_router.py. `Task`, `TaskCreate`, `TaskUpdate`, `Subtask`,
# `TaskCategory` models are also re-exported from there so the rest of the
# codebase (chat auto-tagger, tests) can still import them from server.
from routers.tasks_router import (
    build_tasks_router,
)




@api_router.get("/")
async def root():
    return {"service": "Sertex", "status": "online"}


@api_router.get("/health")
async def api_health():
    """Health probe exposed under `/api` for load balancers behind ingress."""
    return {"status": "ok", "service": "sertex"}


app.include_router(api_router)
from license_service import (
    ensure_indexes as ensure_license_indexes,
)
app.include_router(build_files_router(db, licensed_user), prefix="/api")
from excel_router import build_excel_router
app.include_router(build_excel_router(db, licensed_user), prefix="/api")
from backup_router import build_backup_router
app.include_router(build_backup_router(db, current_user), prefix="/api")
from license_router import build_license_router
_lic_router, _lic_admin_router = build_license_router(db, current_user)
app.include_router(_lic_router, prefix="/api")
app.include_router(_lic_admin_router, prefix="/api")
from email_router import build_email_router
app.include_router(build_email_router(db, licensed_user), prefix="/api")
from permissions_router import build_permissions_router
app.include_router(build_permissions_router(db, current_user), prefix="/api")
# Faz 9 refactor — tasks + categories + orphans live in their own module.
app.include_router(build_tasks_router(db, licensed_user, current_user), prefix="/api")
# Faz 9 refactor — team + notifications + weather.
from routers.team_router import build_team_router
app.include_router(build_team_router(db, licensed_user, current_user, require_admin), prefix="/api")
# Faz 9 refactor — admin CRUD + system quota + stats/summary.
from routers.admin_router import build_admin_router
app.include_router(build_admin_router(db, current_user, require_admin, hash_password), prefix="/api")
# Faz 9 refactor — auth (login/me/change-*) + settings (workspace mode + reminder).
from routers.auth_router import build_auth_router
app.include_router(build_auth_router(db, current_user), prefix="/api")
# Faz 9 CP4.6 refactor — chat: /chat endpoint + models.
app.include_router(build_chat_router(db, licensed_user, EMERGENT_LLM_KEY), prefix="/api")
# Faz 9 refactor — personal user-scoped: notes, memory, conversations, tts/stt.
from routers.personal_router import build_personal_router
app.include_router(build_personal_router(db, licensed_user, current_user, EMERGENT_LLM_KEY), prefix="/api")
# Faz 9 CP6 — Global Announcement System (admin-to-fleet broadcasts via SSE).
from routers.announcements_router import build_announcements_router
app.include_router(build_announcements_router(db, licensed_user, current_user, require_admin), prefix="/api")
# Faz 9 CP7 — FCM Push Notifications (mobile background alerts via Firebase).
from routers.fcm_router import build_fcm_router
app.include_router(build_fcm_router(db, current_user, require_admin), prefix="/api")

# Web Push (VAPID) — tarayıcı bildirimleri (Service Worker + pywebpush).
from routers.push_router import build_push_router
app.include_router(build_push_router(db, current_user), prefix="/api")


# Health check endpoints (used by Kubernetes/load balancer probes)
@app.get("/health")
async def health():
    return {"status": "ok", "service": "sertex"}


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=[o.strip() for o in os.environ.get('CORS_ORIGINS', '*').split(',') if o.strip()],
    allow_methods=["*"],
    allow_headers=["*"],
)

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Faz 9 CP4 — Production monitoring: wire the counter handler + optional JSON
# formatter into the root logger. Idempotent on hot-reload.
try:
    from monitoring_service import install_structured_logging
    install_structured_logging()
except Exception as _e:
    logger.warning(f"Monitoring install failed: {_e}")


# P2 — Merkezî hata loglama: yakalanmayan (HTTPException DIŞI) tüm hatalar artık
# sessiz kalmaz; tam traceback loglanır + monitoring sayacına düşer, istemciye
# temiz bir 500 döner. HTTPException'lar FastAPI'nin kendi handler'ıyla işlenir.
from fastapi.responses import JSONResponse


@app.exception_handler(Exception)
async def _unhandled_exception_handler(request: Request, exc: Exception):
    logger.exception(f"Unhandled error: {request.method} {request.url.path} -> {exc}")
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
