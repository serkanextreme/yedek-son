// Shared API contract types — mirror the FastAPI backend models
// (routers/tasks_models.py, auth.py). Kept intentionally partial: only the
// fields the mobile V1 (login + tasks list) actually reads.

export type AdminCaps = {
  extra_company_ids?: string[];
  can_create_company?: boolean;
  can_view_company_tasks?: boolean;
};

export type User = {
  id: string;
  username: string;
  role: string;
  workspace_mode: string;
  is_owner?: boolean;
  is_super_admin?: boolean;
  admin_caps?: AdminCaps;
  super_admin_until?: string | null;
  company_id?: string | null;
};

export type SuperAdmin = {
  id: string;
  username: string;
  is_owner: boolean;
  role: string;
  super_admin_until?: string | null;
  prev_role?: string | null;
};

export type LoginResponse = {
  token: string;
  token_type: string;
  user: User;
};

export type Subtask = {
  id: string;
  text: string;
  done: boolean;
  status?: string | null;
};

export type Task = {
  id: string;
  title: string;
  description: string;
  status: string;
  user_id?: string | null;
  start_date?: string | null;
  due_date?: string | null;
  completed_at?: string | null;
  category_id?: string | null;
  subtasks: Subtask[];
  assignee_name?: string | null;
  owner_username?: string | null;
  company_name?: string | null;
  assignees?: { user_id: string; name?: string | null; completed?: boolean }[];
  shared_with?: {
    user_id: string;
    name?: string | null;
    perms?: {
      view?: boolean;
      edit?: boolean;
      complete?: boolean;
      delete?: boolean;
      assign?: boolean;
    };
  }[];
  reminder_at?: string | null;
  reminder_days?: number | null;
  reminder_disabled?: boolean;
  reminder_repeat_total?: number | null;
  archived?: boolean;
  archived_at?: string | null;
  cancelled?: boolean;
  cancelled_at?: string | null;
  cancel_reason?: string | null;
  deleted?: boolean;
  deleted_at?: string | null;
  delete_reason?: string | null;
  sort_order?: number | null;
  created_at?: string | null;
  // Wave 3 — task linking / groups
  group_id?: string | null;
  // Wave 4 — task locks / OTP
  created_by?: string | null;
  lock_flags?: Record<string, boolean>;
  self_lock_flags?: Record<string, boolean>;
  lock_requires_otp?: boolean;
  locked_by?: string | null;
  unlock_expires_at?: string | null;
  unlock_uses_remaining?: number | null;
};

// Görev Bağlama (Task Group/Chain) — mirrors backend TaskGroup.
export type TaskGroup = {
  id: string;
  user_id?: string | null;
  name?: string | null;
  show_progress: boolean;
  created_at?: string | null;
  updated_at?: string | null;
};

// One-time unlock OTP issuance response (plaintext returned once to issuer).
export type OtpIssueResponse = {
  code: string;
  expires_at: string;
  ttl_minutes: number;
};

// KVKK-compliant lock audit row (no codes stored — only metadata).
export type LockAuditRow = {
  id: string;
  task_id: string;
  event_type: string;
  actor_username?: string | null;
  actor_role?: string | null;
  created_at?: string | null;
  payload?: Record<string, unknown> | null;
};

export type Category = {
  id: string;
  name: string;
  color?: string | null;
  parent_id?: string | null;
  company_id?: string;
};

export type CompanyLite = {
  id: string;
  name: string;
};

export type TaskAttachment = {
  id: string;
  task_id: string;
  original_filename: string;
  content_type?: string | null;
  size?: number | null;
  uploaded_by?: string | null;
  uploaded_by_name?: string | null;
  created_at?: string | null;
};

export type SearchUser = {
  id: string;
  username: string;
  company_name?: string | null;
  role?: string;
};

export type TaskCreatePayload = {
  title: string;
  description?: string;
  start_date?: string | null;
  due_date?: string | null;
  category_id?: string | null;
  assignee_user_ids?: string[];
};

export type TeamMember = {
  id: string;
  username: string;
  role: string;
  company_name?: string | null;
  company_id?: string | null;
};

export type TeamSummaryRow = {
  user_id: string;
  username: string;
  role: string;
  company_name?: string | null;
  total: number;
  done: number;
  pending: number;
  paused: number;
  overdue: number;
};

// Faz C — İş Kolu (kategori) performans satırı
export type TeamCategoryRow = {
  category_id: string | null;
  name: string;
  color?: string | null;
  total: number;
  done: number;
  pending: number;
  paused: number;
  overdue: number;
  due_soon: number;
};

export type OverdueTask = {
  id: string;
  title: string;
  due_date?: string | null;
  company_name?: string | null;
  category_id?: string | null;
};

export type OverduePerson = {
  user_id: string;
  username: string;
  company_name?: string | null;
  role: string;
  overdue_count: number;
  tasks: OverdueTask[];
};

export type OverdueSummary = {
  people: OverduePerson[];
  total_overdue: number;
  total_people: number;
};

export type HeatmapDay = { date: string; done: number };
export type HeatmapRow = {
  user_id: string;
  username: string;
  role: string;
  company_name?: string | null;
  days: HeatmapDay[];
};

export type BulkNudgeResult = { sent: number; skipped: number; recipients: number };

// ── Dalga 3 — Ayarlar & Admin panelleri ──
export type AdminUser = {
  id: string;
  username: string;
  role: string;
  is_owner?: boolean;
  admin_caps?: AdminCaps;
  super_admin_until?: string | null;
  company_id?: string | null;
  company_name?: string | null;
  quota_label?: string | null;
  usage_mb?: number;
  quota_mb?: number | null;
  quota_percent?: number | null;
  created_at?: string | null;
  temp_password?: string;
};

export type Company = {
  id: string;
  name: string;
  created_by?: string | null;
  created_at?: string | null;
};

export type Announcement = {
  id: string;
  title: string;
  message: string;
  severity: string;
  target_type: string;
  target_value?: string | null;
  require_ack: boolean;
  is_active?: boolean;
  created_at?: string | null;
  created_by_username?: string | null;
  expires_at?: string | null;
};

// GET /announcements/active — aktif + bana yönelik duyurular, `acked` ile zenginleştirilmiş.
export type ActiveAnnouncement = Announcement & { acked: boolean };

export type LicenseDoc = {
  id: string;
  key: string;
  type: string;
  status: string;
  assigned_to?: string | null;
  assigned_to_username?: string | null;
  expires_at?: string | null;
  notes?: string | null;
  created_at?: string | null;
};

export type ManagerVisibility = {
  id: string;
  manager_user_id: string;
  employee_user_id: string;
  created_at?: string | null;
};

export type DigestSettings = {
  digest_hour: number;
  digest_enabled: boolean;
  digest_detailed: boolean;
  digest_skip_weekend: boolean;
};

export type AppNotification = {
  id: string;
  type: string;
  task_id?: string | null;
  task_title?: string | null;
  owner_username?: string | null;
  is_for_manager?: boolean;
  days_until_due?: number | null;
  created_at: string;
  read_at?: string | null;
  payload?: Record<string, unknown> | null;
};

// Frontend Hata Radarı — istemci (web/mobil) hata kaydı.
export type ClientLog = {
  id: string;
  level: string;
  message: string;
  stack?: string | null;
  source?: string | null;
  lineno?: number | null;
  colno?: number | null;
  page_url?: string | null;
  user_agent?: string | null;
  user_id?: string | null;
  username?: string | null;
  ts_client?: string | null;
  created_at: string;
};
