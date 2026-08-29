"""Sertex — Task models + shared lock helpers.

Extracted from `routers/tasks_router.py` during the Faz 9 CP5 refactor.
Every symbol below was previously a top-level definition in that file;
behavior is BYTE-IDENTICAL. The router imports from this module.

Do NOT add new logic here unless the router needs it. This module exists
solely to bring the router file back below ~1200 lines so it fits in a
single reviewer's working memory.
"""
from datetime import datetime, timezone
from typing import Dict, List, Optional
import hashlib
import logging
import uuid

from pydantic import BaseModel, Field


log = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
_ALLOWED_REMINDER_DAYS = {1, 2, 3, 5, 7, 14}

# Faz 9 CP4.27 — Task lock flags. Each flag maps 1:1 with an assignee-side
# action the creator may want to restrict. Kept as a flat list so the frontend
# can render a simple checkbox grid without magic strings drifting.
_LOCK_FLAG_KEYS = (
    "lock_edit",            # title / description
    "lock_delete",          # DELETE /tasks/{id}
    "lock_complete",        # status → done
    "lock_pause",           # status → paused
    "lock_mark_overdue",    # status → overdue
    "lock_transfer",        # POST /tasks/{id}/reassign
    "lock_move_category",   # category_id change
    "lock_reset_size",      # UI-only (sort_order)
    "lock_reminder",        # reminder_at / reminder_days / reminder_disabled
    "lock_upcoming_alert",  # reminder_days ("yaklaşan uyarısı")
    "lock_archive",         # archived=true
    "lock_change_date",     # due_date change
    "lock_subtask",         # subtasks add/remove
)
# OTP config — single-use, short-lived unlock codes handed out by creator.
_OTP_TTL_MINUTES = 10
_OTP_DIGITS = 6


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------
def _validate_reminder_days(v):
    """Whitelist reminder-day values. Anything else → None (clear override)."""
    if v is None:
        return None
    try:
        iv = int(v)
    except Exception:
        return None
    return iv if iv in _ALLOWED_REMINDER_DAYS else None


def _hash_otp(code: str) -> str:
    """SHA-256 hex digest — codes are short-lived + single-use so bcrypt would
    be overkill, but we never store plaintext."""
    return hashlib.sha256(code.encode("utf-8")).hexdigest()


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


# Faz 9 CP4.28 — Lock Audit Log. Every meaningful lock-lifecycle event is
# persisted here for KVKK-compliance & internal accountability. Codes are
# NEVER stored — only metadata (who / when / what).
# Retention policy: currently unbounded. If KVKK retention becomes a
# requirement, add a TTL index on `created_at` or a periodic sweeper. Also
# recommended (once traffic grows): compound index on (task_id, created_at DESC).
async def _log_lock_event(db, task_id: str, actor: dict, event_type: str, payload: Optional[dict] = None) -> None:
    """Append a single audit row. Failures are logged (WARN) but not raised
    so lock endpoints stay reliable even if the audit collection is briefly
    unavailable — the audit trail losing a row is preferable to a lock
    action failing for the end user."""
    try:
        row = {
            "id": str(uuid.uuid4()),
            "task_id": task_id,
            "event_type": event_type,   # lock_set | otp_issued | otp_verified | otp_consumed | otp_failed | otp_invalidated | task_deleted
            "actor_user_id": actor.get("id") if actor else None,
            "actor_username": actor.get("username") if actor else None,
            "actor_role": actor.get("role") if actor else None,
            "created_at": _now_iso(),
            "payload": payload or {},
        }
        await db.task_lock_audit.insert_one(row)
    except Exception as exc:  # pragma: no cover — observable via logs
        log.warning(
            "audit row lost (task=%s event=%s actor=%s): %s",
            task_id, event_type, (actor or {}).get("username"), exc,
        )


# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------
class Subtask(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    text: str
    done: bool = False
    status: Optional[str] = "pending"
    due_date: Optional[str] = None
    reminder_fired: bool = False
    # Sıra numarası sabitleme — True ise bu alt görev sürüklense de sıra
    # numarası değişmez; pinned_number gösterilir, diğerleri bu numarayı atlar.
    number_pinned: bool = False
    pinned_number: Optional[int] = None


# Görev Paylaşımı + Çok Kişili Atama (Task Sharing & Multi-Assignee)
# --------------------------------------------------------------------------
# ÖZELLİK A — a single task assigned to multiple users, each tracking their
# own completion. The task only becomes `done` when EVERY assignee marks
# their own portion complete ("2/4 tamamlandı").
class TaskAssignee(BaseModel):
    user_id: str
    name: Optional[str] = None
    completed: bool = False
    completed_at: Optional[str] = None


# ÖZELLİK B — per-task ACL. A task can be shared with any user in the system
# with granular permissions. `view` is the baseline (always forced True on a
# share) — it decides whether the task appears in the recipient's list.
class TaskSharePerms(BaseModel):
    view: bool = True
    edit: bool = False
    complete: bool = False
    delete: bool = False
    assign: bool = False


class TaskShare(BaseModel):
    user_id: str
    name: Optional[str] = None
    perms: TaskSharePerms = Field(default_factory=TaskSharePerms)


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str
    description: str = ""
    status: str = "pending"
    # Owner of the task. Exposed in responses so the frontend can group the
    # "Personel Görevleri" view by person.
    user_id: Optional[str] = None
    # Başlangıç tarihi (opsiyonel) — due_date ile aynı mantık. Yumuşak kural:
    # start_date <= due_date (frontend'de doğrulanır; backend tamamen opsiyonel).
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    # Otomatik tamamlanma tarihi. Durum "done" olduğunda otomatik yazılır,
    # başka bir duruma dönünce temizlenir. Yetkili kullanıcı manuel de düzenler.
    completed_at: Optional[str] = None
    reminder_at: Optional[str] = None
    reminder_fired: bool = False
    snoozed_until: Optional[str] = None
    subtasks: List[Subtask] = Field(default_factory=list)
    sort_order: Optional[float] = None
    # Sıra numarası sabitleme — True ise görev sürüklense de sıra numarası
    # sabit kalır (pinned_number); diğer görevler bu numarayı atlar (çakışma yok).
    number_pinned: bool = False
    pinned_number: Optional[int] = None
    archived: bool = False
    archived_at: Optional[str] = None
    # İptal — "İptal Et" ile işaretlenen görev. Arşivin "İPTAL" grubuna düşer
    # (cancelled=True + archived=True). uncancel ile geri alınır.
    cancelled: bool = False
    cancelled_at: Optional[str] = None
    # Çöp Kutusu (soft-delete) — "Sil" artık görevi kalıcı silmez; deleted=True
    # yapıp arşivin "SİLİNMİŞ" grubuna taşır. restore ile geri yüklenir; kalıcı
    # silme (permanent) yalnızca admin tarafından yapılır.
    deleted: bool = False
    deleted_at: Optional[str] = None
    deleted_by: Optional[str] = None
    # İptal/Silme neden notu (politika: off/optional/required — admin belirler).
    cancel_reason: Optional[str] = None
    delete_reason: Optional[str] = None
    assignee_name: Optional[str] = None
    # Sahibin (user_id) gerçek kullanıcı adı — tekil görev okumasında (GET
    # /tasks/{id}) users tablosundan çözülüp doldurulur. assignee_name boş
    # kalabildiğinden, görev sahibini net göstermek için kullanılır.
    owner_username: Optional[str] = None
    company_name: Optional[str] = None
    category_id: Optional[str] = None
    reminder_days: Optional[int] = None
    reminder_disabled: bool = False
    # Tekrarlı hatırlatma (recurring reminder). interval_min set + repeat_left>0
    # → the frontend reschedules reminder_at every interval, decrementing
    # repeat_left, until it hits 0 or the task is completed.
    reminder_interval_min: Optional[int] = None
    reminder_repeat_left: Optional[int] = None
    reminder_repeat_total: Optional[int] = None
    # Görev Bazlı Sessiz — True ise bu görev sabah "günlük geciken özeti"ne
    # (overdue_daily + FCM digest) dahil edilmez. Gerçek-zamanlı gecikme
    # bildirimini etkilemez.
    digest_muted: bool = False
    due_soon_fired_at_days: Optional[int] = None
    company_id: Optional[str] = None
    # Görev Bağlama (Task Group/Chain) — birbirine bağlı görevler tek blok
    # halinde yan yana gösterilir. group_id boşsa görev bağımsızdır.
    group_id: Optional[str] = None
    orphaned: bool = False
    orphaned_at: Optional[str] = None
    orphaned_from_company_id: Optional[str] = None
    prev_assignee_user_id: Optional[str] = None
    # Alt görevden yükseltme (promote) — bu görev başka bir görevin alt
    # unsurundan oluşturulduysa ana görevin kimliği/başlığı burada tutulur;
    # UI'da "‹Ana görev› görevinin alt unsuru" rozeti gösterilir.
    promoted_from_task_id: Optional[str] = None
    promoted_from_task_title: Optional[str] = None
    # Görev Paylaşımı + Çok Kişili Atama:
    #   assignees   → ÖZELLİK A (multi-assignee, per-person completion). Empty
    #                 means the legacy single-owner behaviour applies.
    #   shared_with → ÖZELLİK B (per-task ACL). Users here see the task in
    #                 their list (perms.view) and may mutate it per their perms.
    assignees: List[TaskAssignee] = Field(default_factory=list)
    shared_with: List[TaskShare] = Field(default_factory=list)
    # Faz 9 CP4.27 — Task Lock system. `created_by` is the user who spawned the
    # row (needed to authorize lock changes when creator != assignee). Empty
    # `lock_flags` == unrestricted; the assignee sees actions greyed out when
    # a flag is True and needs a fresh OTP unlock session to bypass.
    # Faz 9 CP4.30 — `self_lock_flags` are locks the assignee set on themselves
    # (distraction-avoidance). Freely removable by the assignee. Combined with
    # `lock_flags` at guard time — either being True triggers the lock check.
    # `lock_requires_otp` (True = strict, needs OTP; False = soft, user can
    # bypass via /unlock-simple).
    created_by: Optional[str] = None
    lock_flags: Dict[str, bool] = Field(default_factory=dict)
    self_lock_flags: Dict[str, bool] = Field(default_factory=dict)
    lock_requires_otp: bool = True
    locked_by: Optional[str] = None
    locked_at: Optional[str] = None
    unlock_expires_at: Optional[str] = None
    unlock_uses_remaining: int = 0
    unlock_last_verified_at: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskCreate(BaseModel):
    title: str
    description: str = ""
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    reminder_at: Optional[str] = None
    assignee_name: Optional[str] = None
    company_name: Optional[str] = None
    category_id: Optional[str] = None
    assignee_user_id: Optional[str] = None
    reminder_days: Optional[int] = None
    reminder_disabled: Optional[bool] = None
    company_id: Optional[str] = None
    # Tekrarlı hatırlatma (recurring reminder) — görev oluştururken de
    # ayarlanabilsin diye eklendi ("her yerde olsun"). interval_min + repeat
    # birlikte verilir; scheduler her tetiklemede reschedule eder.
    reminder_interval_min: Optional[int] = None
    reminder_repeat_left: Optional[int] = None
    reminder_repeat_total: Optional[int] = None
    # ÖZELLİK A — çok kişili atama. When provided (non-empty) the task is
    # created with an `assignees` list; the legacy `assignee_user_id`
    # (single-owner transfer) is ignored in favour of this.
    assignee_user_ids: Optional[List[str]] = None


class TaskUpdate(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    status: Optional[str] = None
    start_date: Optional[str] = None
    due_date: Optional[str] = None
    completed_at: Optional[str] = None
    reminder_at: Optional[str] = None
    reminder_fired: Optional[bool] = None
    snoozed_until: Optional[str] = None
    subtasks: Optional[List[Subtask]] = None
    sort_order: Optional[float] = None
    archived: Optional[bool] = None
    assignee_name: Optional[str] = None
    company_name: Optional[str] = None
    category_id: Optional[str] = None
    reminder_days: Optional[int] = None
    reminder_disabled: Optional[bool] = None
    reminder_interval_min: Optional[int] = None
    reminder_repeat_left: Optional[int] = None
    reminder_repeat_total: Optional[int] = None
    digest_muted: Optional[bool] = None
    number_pinned: Optional[bool] = None
    pinned_number: Optional[int] = None


class ReorderTasksReq(BaseModel):
    ids: List[str]


class CategoryOrderReq(BaseModel):
    order: List[str] = []


class TaskReassignRequest(BaseModel):
    new_owner_user_id: str


# ---------------------------------------------------------------------------
# Görev Dosya Ekleri (attachments) — chunked upload + object storage
# ---------------------------------------------------------------------------
class TaskAttachment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    task_id: str
    company_id: Optional[str] = None
    storage_path: str
    original_filename: str
    content_type: Optional[str] = None
    size: int = 0
    uploaded_by: Optional[str] = None
    uploaded_by_name: Optional[str] = None
    is_deleted: bool = False
    created_at: str = Field(default_factory=_now_iso)


class AttachmentInitReq(BaseModel):
    filename: str
    content_type: Optional[str] = None
    total_size: int = 0


class AttachmentCompleteReq(BaseModel):
    upload_id: str


# Görevi bir ŞİRKETE devret — görev sahipsiz (orphan) + kolsuz olarak hedef
# şirketin "Yarım Kalan İşler" havuzuna düşer; oradan o şirkette biri sahiplenir.
class TaskCompanyTransferRequest(BaseModel):
    company_id: str


# Dürt / Hatırlat — optional custom message for the nudge (c).
class TaskNudgeRequest(BaseModel):
    message: str = Field(default="", max_length=200)


# ÖZELLİK B — set/replace the share ACL of a task (PUT /tasks/{id}/shares).
class TaskShareEntry(BaseModel):
    user_id: str
    perms: TaskSharePerms = Field(default_factory=TaskSharePerms)


class TaskShareRequest(BaseModel):
    shares: List[TaskShareEntry] = Field(default_factory=list)
    # When True the newly-added recipients get a bell + FCM notification.
    notify: bool = True


# ÖZELLİK A — an assignee toggles their OWN completion checkbox
# (POST /tasks/{id}/my-completion).
class TaskMyCompletionRequest(BaseModel):
    completed: bool = True


# Faz 9 CP4.27 — Task lock configuration (PATCH /tasks/{id}/locks).
class TaskLockPatch(BaseModel):
    lock_flags: Dict[str, bool]
    # Faz 9 CP4.30 — optional OTP requirement toggle. When False, the assignee
    # can bypass the lock via POST /tasks/{id}/unlock-simple without a code.
    # Omit → keep the task's current value.
    requires_otp: Optional[bool] = None


# Faz 9 CP4.30 — Assignee self-lock (distraction avoidance). Freely removable.
class TaskSelfLockPatch(BaseModel):
    self_lock_flags: Dict[str, bool]


class TaskUnlockVerify(BaseModel):
    code: str


# Faz 9 CP4.33 — Reusable lock policy templates. Admin/manager creates a named
# preset (e.g. "Yeni İşe Alım", "Odaklanma"), then one-click applies it when
# opening the user policy modal. `owner_scope` = "global" | "personal".
class LockPolicyTemplate(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    name: str
    description: Optional[str] = None
    lock_flags: Dict[str, bool] = Field(default_factory=dict)
    requires_otp: bool = True
    created_by: str
    created_by_username: Optional[str] = None
    owner_scope: str = "global"  # "global" = tüm admin/manager görebilir
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class LockPolicyTemplateCreate(BaseModel):
    name: str
    description: Optional[str] = None
    lock_flags: Dict[str, bool] = Field(default_factory=dict)
    requires_otp: bool = True


class LockPolicyTemplateUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    lock_flags: Optional[Dict[str, bool]] = None
    requires_otp: Optional[bool] = None


# Arşiv — İptal/Silme neden notu (opsiyonel gövde) ve global arşiv ayarları.
class TaskReasonBody(BaseModel):
    reason: Optional[str] = None


class TaskSettingsUpdate(BaseModel):
    delete_reason_policy: Optional[str] = None  # off | optional | required
    trash_autoclean_enabled: Optional[bool] = None
    trash_autoclean_days: Optional[int] = None


class ArchiveCapsUpdate(BaseModel):
    # Kişi bazlı arşiv yetkileri — admin verir/alır.
    perm_delete: Optional[bool] = None       # Kalıcı Sil (tek görev)
    empty_trash: Optional[bool] = None       # Çöp Kutusunu Boşalt (toplu)
    manage_policy: Optional[bool] = None     # Arşiv politikası + otomatik temizlik ayarı


# Görev Bağlama (Task Group/Chain) — birden fazla görevi tek blok halinde
# gruplar. name + show_progress opsiyonel; üyeler tasks.group_id ile bağlanır,
# grup içi sıra tasks.sort_order üzerinden korunur.
class TaskGroup(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None
    name: Optional[str] = None
    show_progress: bool = True
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())


class TaskGroupCreate(BaseModel):
    name: Optional[str] = None
    show_progress: bool = True
    task_ids: List[str] = Field(default_factory=list)


class TaskGroupUpdate(BaseModel):
    name: Optional[str] = None
    show_progress: Optional[bool] = None
    # Verildiğinde grubun üyelerini (ve sırasını) bu listeyle değiştirir.
    task_ids: Optional[List[str]] = None


class TaskCategory(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    company_id: str
    name: str
    color: Optional[str] = None
    # Hiyerarşi — üst iş kolu id'si. None ise en üst seviye (kök). Sınırsız derinlik.
    parent_id: Optional[str] = None
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    created_by: Optional[str] = None
    # Faz 9 CP4.23 — layered visibility model. Empty lists mean only the
    # owning company sees the category; adding company IDs / user IDs
    # here extends visibility. Union semantics: a user can see the
    # category if ANY of these apply.
    visible_to_company_ids: list[str] = Field(default_factory=list)
    visible_to_user_ids: list[str] = Field(default_factory=list)


class TaskCategoryCreate(BaseModel):
    name: str
    color: Optional[str] = None
    company_id: Optional[str] = None
    parent_id: Optional[str] = None


class TaskCategoryUpdate(BaseModel):
    name: Optional[str] = None
    color: Optional[str] = None
    # Hiyerarşi taşıma (re-parent) — None + alan gönderilmemişse dokunulmaz;
    # açıkça null gönderilirse en üst seviyeye taşınır. Frontend model_fields_set
    # ile ayırt eder.
    parent_id: Optional[str] = None
    # Faz 9 CP4.23 — allow the admin/manager to update visibility lists
    # independently. `None` means "don't touch this field"; an empty
    # list means "revoke all extra visibility".
    visible_to_company_ids: Optional[list[str]] = None
    visible_to_user_ids: Optional[list[str]] = None


__all__ = [
    # Constants
    "_ALLOWED_REMINDER_DAYS",
    "_LOCK_FLAG_KEYS",
    "_OTP_TTL_MINUTES",
    "_OTP_DIGITS",
    # Helpers
    "_validate_reminder_days",
    "_hash_otp",
    "_now_iso",
    "_log_lock_event",
    # Models
    "Subtask",
    "Task",
    "TaskAssignee",
    "TaskSharePerms",
    "TaskShare",
    "TaskCreate",
    "TaskUpdate",
    "ReorderTasksReq",
    "CategoryOrderReq",
    "TaskReassignRequest",
    "TaskCompanyTransferRequest",
    "TaskAttachment",
    "AttachmentInitReq",
    "AttachmentCompleteReq",
    "TaskShareEntry",
    "TaskShareRequest",
    "TaskMyCompletionRequest",
    "TaskLockPatch",
    "TaskSelfLockPatch",
    "TaskUnlockVerify",
    "LockPolicyTemplate",
    "LockPolicyTemplateCreate",
    "LockPolicyTemplateUpdate",
    "TaskReasonBody",
    "TaskSettingsUpdate",
    "ArchiveCapsUpdate",
    "TaskCategory",
    "TaskCategoryCreate",
    "TaskCategoryUpdate",
    "TaskGroup",
    "TaskGroupCreate",
    "TaskGroupUpdate",
]
