// Thin fetch wrapper around the shared FastAPI backend. Base URL comes ONLY
// from EXPO_PUBLIC_BACKEND_URL; every path is prefixed with /api so it routes
// through the ingress to the backend service.

import { Platform } from "react-native";

import { storage } from "@/src/utils/storage";
import { AUTH_TOKEN_KEY } from "@/src/auth/storage-keys";
import { captureError } from "@/src/lib/clientLogger";
import {
  AdminUser,
  ActiveAnnouncement,
  Announcement,
  AppNotification,
  BulkNudgeResult,
  Category,
  ClientLog,
  Company,
  CompanyLite,
  DigestSettings,
  HeatmapRow,
  LicenseDoc,
  LockAuditRow,
  LoginResponse,
  ManagerVisibility,
  OtpIssueResponse,
  OverdueSummary,
  SearchUser,
  Task,
  TaskAttachment,
  TaskCreatePayload,
  TaskGroup,
  TeamCategoryRow,
  TeamMember,
  TeamSummaryRow,
  User,
} from "./types";

const BASE = process.env.EXPO_PUBLIC_BACKEND_URL;

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = "ApiError";
  }
}

type RequestOptions = {
  method?: string;
  body?: unknown;
  auth?: boolean;
};

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = "GET", body, auth = true } = options;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (auth) {
    const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
    if (token) headers.Authorization = `Bearer ${token}`;
  }

  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method,
      headers,
      body: body != null ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, `Sunucuya ulaşılamadı. (Adres: ${BASE ?? "TANIMSIZ"})`);
  }

  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }

  if (!res.ok) {
    const detail =
      data && typeof data === "object" && "detail" in data
        ? String((data as { detail: unknown }).detail)
        : typeof data === "string" && data
          ? data
          : `HTTP ${res.status}`;
    // Frontend Hata Radarı — sunucu (5xx) hatalarını sessizce kaydet.
    if (res.status >= 500) {
      captureError(`API ${res.status}: ${method} ${path} — ${detail}`, {
        source: `api:${path}`,
      });
    }
    throw new ApiError(res.status, detail);
  }

  return data as T;
}

export const api = {
  login: (username: string, password: string) =>
    request<LoginResponse>("/auth/login", {
      method: "POST",
      body: { username, password },
      auth: false,
    }),
  me: () => request<User>("/auth/me"),
  tasks: (scope: string = "mine", view: string | null = null) =>
    request<Task[]>(`/tasks?scope=${scope}${view ? `&view=${view}` : ""}`),
  archiveCounts: (scope: string = "mine") =>
    request<{ done: number; cancelled: number; deleted: number }>(`/tasks/archive-counts?scope=${scope}`),
  // Arşiv v2 — global ayarlar + geçerli kullanıcının yetkileri.
  getTaskSettings: () =>
    request<{ delete_reason_policy: string; trash_autoclean_enabled: boolean; trash_autoclean_days: number; caps: { perm_delete: boolean; empty_trash: boolean; manage_policy: boolean } }>(`/tasks/settings`),
  searchArchive: (q: string, scope: string = "mine") =>
    request<Task[]>(`/tasks/search?q=${encodeURIComponent(q)}&scope=${scope}`),
  categories: (scope: string = "manage") =>
    request<Category[]>(`/task-categories?scope=${scope}`),
  updateTask: (id: string, patch: Record<string, unknown>) =>
    request<Task>(`/tasks/${id}`, { method: "PATCH", body: patch }),
  createTask: (body: TaskCreatePayload) =>
    request<Task>("/tasks", { method: "POST", body }),
  // Görev Kopyalama (Kopyala → Yapıştır) — kaynağı çoğaltır, kopya bana atanır.
  duplicateTask: (
    id: string,
    opts: { include_subtasks?: boolean; include_attachments?: boolean; category_id?: string | null } = {},
  ) =>
    request<Task>(`/tasks/${id}/duplicate`, {
      method: "POST",
      body: {
        include_subtasks: opts.include_subtasks ?? true,
        include_attachments: opts.include_attachments ?? true,
        category_id: opts.category_id ?? null,
      },
    }),
  deleteTask: (id: string, reason?: string) =>
    request<{ deleted: number }>(`/tasks/${id}${reason ? `?reason=${encodeURIComponent(reason)}` : ""}`, { method: "DELETE" }),
  searchUsers: (q: string) =>
    request<SearchUser[]>(`/users/search?q=${encodeURIComponent(q)}&limit=20`),
  teamSummary: () => request<TeamSummaryRow[]>("/team/summary"),
  teamMembers: () => request<TeamMember[]>("/team/members"),
  teamCategorySummary: () => request<TeamCategoryRow[]>("/team/category-summary"),
  teamOverdueSummary: () => request<OverdueSummary>("/team/overdue-summary"),
  teamHeatmap: (days = 60) => request<HeatmapRow[]>(`/team/heatmap?days=${days}`),
  teamBulkNudge: (task_ids: string[]) =>
    request<BulkNudgeResult>("/team/bulk-nudge", { method: "POST", body: { task_ids } }),

  // ── Dalga 3 — Ayarlar & Admin ──
  digestSettings: () => request<DigestSettings>("/notifications/digest-settings"),
  saveDigestSettings: (body: DigestSettings) =>
    request<{ saved: boolean }>("/notifications/digest-settings", { method: "PUT", body }),

  adminUsers: () => request<AdminUser[]>("/admin/users"),
  adminCompanies: () => request<{ companies: string[] }>("/admin/companies"),
  createUser: (body: {
    username: string;
    password?: string;
    role: string;
    company_id?: string | null;
    company_name?: string | null;
  }) => request<AdminUser>("/admin/users", { method: "POST", body }),
  updateUser: (
    uid: string,
    body: { role?: string; new_password?: string; company_id?: string | null },
  ) => request<AdminUser>(`/admin/users/${uid}`, { method: "PATCH", body }),
  deleteUser: (uid: string) => request<{ deleted: boolean }>(`/admin/users/${uid}`, { method: "DELETE" }),

  // ── Süper Yönetici / Kurucu — rol yönetimi ──
  superAdmins: () =>
    request<{ super_admins: import("./types").SuperAdmin[] }>("/admin/super-admins"),
  setAdminCaps: (uid: string, caps: Partial<import("./types").AdminCaps>) =>
    request<{ id: string; admin_caps: import("./types").AdminCaps }>(
      `/admin/users/${uid}/admin-caps`,
      { method: "PATCH", body: caps },
    ),
  grantSuperAdmin: (uid: string, hours: number) =>
    request<import("./types").SuperAdmin>(`/admin/users/${uid}/super-admin`, {
      method: "POST",
      body: { hours },
    }),
  revokeSuperAdmin: (uid: string) =>
    request<{ ok: boolean; role: string }>(`/admin/users/${uid}/super-admin`, {
      method: "DELETE",
    }),

  announcements: () => request<Announcement[]>("/announcements"),
  createAnnouncement: (body: {
    title: string;
    message: string;
    severity: string;
    target_type: string;
    require_ack: boolean;
  }) => request<Announcement>("/announcements", { method: "POST", body }),
  updateAnnouncement: (aid: string, body: Partial<Announcement>) =>
    request<Announcement>(`/announcements/${aid}`, { method: "PATCH", body }),
  deleteAnnouncement: (aid: string) =>
    request<{ deleted: boolean }>(`/announcements/${aid}`, { method: "DELETE" }),

  // Duyuru Rozeti — bana yönelik aktif duyurular + onaylama.
  activeAnnouncements: () => request<ActiveAnnouncement[]>("/announcements/active"),
  ackAnnouncement: (aid: string) =>
    request<{ ok: boolean; already: boolean }>(`/announcements/${aid}/ack`, { method: "POST" }),

  listCompanies: () => request<Company[]>("/companies"),
  createCompany: (name: string) => request<Company>("/companies", { method: "POST", body: { name } }),
  updateCompany: (cid: string, name: string) =>
    request<Company>(`/companies/${cid}`, { method: "PATCH", body: { name } }),
  deleteCompany: (cid: string) =>
    request<{ deleted: boolean }>(`/companies/${cid}`, { method: "DELETE" }),

  licenses: () => request<{ licenses: LicenseDoc[] }>("/admin/licenses"),
  licenseTypes: () => request<{ types: string[] }>("/admin/licenses/types"),
  generateLicenses: (type: string, count: number, notes?: string) =>
    request<{ created: number; licenses: LicenseDoc[] }>("/admin/licenses/generate", {
      method: "POST",
      body: { type, count, notes: notes || "" },
    }),
  deleteLicense: (id: string) =>
    request<{ deleted: boolean }>(`/admin/licenses/${id}`, { method: "DELETE" }),

  managerVisibility: () => request<ManagerVisibility[]>("/manager-visibility"),
  createManagerVisibility: (manager_user_id: string, employee_user_id: string) =>
    request<ManagerVisibility>("/manager-visibility", {
      method: "POST",
      body: { manager_user_id, employee_user_id },
    }),
  deleteManagerVisibility: (mvid: string) =>
    request<{ deleted: boolean }>(`/manager-visibility/${mvid}`, { method: "DELETE" }),
  notifications: (limit: number = 50) =>
    request<AppNotification[]>(`/notifications?limit=${limit}`),
  unreadCount: () => request<{ unread: number }>("/notifications/unread-count"),
  markNotificationRead: (id: string) =>
    request<{ read: boolean }>(`/notifications/${id}/read`, { method: "POST" }),
  markAllNotificationsRead: () =>
    request<{ updated: number }>("/notifications/read-all", { method: "POST" }),
  deleteNotification: (id: string) =>
    request<{ deleted: number }>(`/notifications/${id}`, { method: "DELETE" }),
  getTask: (id: string) => request<Task>(`/tasks/${id}`),
  reassignTask: (id: string, new_owner_user_id: string) =>
    request<Task>(`/tasks/${id}/reassign`, {
      method: "POST",
      body: { new_owner_user_id },
    }),
  // Arşiv grupları — İptal Et / Geri Yükle / Kalıcı Sil (çöp kutusu).
  cancelTask: (id: string, reason?: string) =>
    request<Task>(`/tasks/${id}/cancel`, { method: "POST", body: reason ? { reason } : {} }),
  uncancelTask: (id: string) => request<Task>(`/tasks/${id}/uncancel`, { method: "POST" }),
  restoreTask: (id: string) => request<Task>(`/tasks/${id}/restore`, { method: "POST" }),
  permanentDeleteTask: (id: string) =>
    request<{ deleted: number }>(`/tasks/${id}/permanent`, { method: "DELETE" }),
  emptyTrash: (scope: string = "mine") =>
    request<{ deleted: number }>(`/tasks/trash/empty?scope=${scope}`, { method: "POST" }),

  setShares: (
    tid: string,
    shares: {
      user_id: string;
      perms: {
        view?: boolean;
        edit?: boolean;
        complete?: boolean;
        delete?: boolean;
        assign?: boolean;
      };
    }[],
    notify = false,
  ) =>
    request<Task>(`/tasks/${tid}/shares`, {
      method: "PUT",
      body: { shares, notify },
    }),

  listAttachments: (tid: string) =>
    request<TaskAttachment[]>(`/tasks/${tid}/attachments`),
  deleteAttachment: (tid: string, attId: string) =>
    request<{ deleted: number }>(`/tasks/${tid}/attachments/${attId}`, {
      method: "DELETE",
    }),
  myCompletion: (id: string, completed: boolean) =>
    request<Task>(`/tasks/${id}/my-completion`, { method: "POST", body: { completed } }),
  companies: () => request<CompanyLite[]>("/task-transfer-companies"),
  createCategory: (body: {
    name: string;
    color?: string | null;
    company_id?: string | null;
    parent_id?: string | null;
  }) => request<Category>("/task-categories", { method: "POST", body }),
  updateCategory: (id: string, patch: Record<string, unknown>) =>
    request<Category>(`/task-categories/${id}`, { method: "PATCH", body: patch }),
  deleteCategory: (id: string) =>
    request<{ deleted: boolean; count: number }>(`/task-categories/${id}`, { method: "DELETE" }),

  // Wave 3 — Görev Bağlama (task groups)
  taskGroups: () => request<TaskGroup[]>("/task-groups"),
  createGroup: (body: { name?: string | null; show_progress: boolean; task_ids: string[] }) =>
    request<TaskGroup>("/task-groups", { method: "POST", body }),
  updateGroup: (
    gid: string,
    body: { name?: string | null; show_progress?: boolean; task_ids?: string[] },
  ) => request<TaskGroup>(`/task-groups/${gid}`, { method: "PATCH", body }),
  deleteGroup: (gid: string) =>
    request<{ deleted: number }>(`/task-groups/${gid}`, { method: "DELETE" }),
  removeGroupMember: (gid: string, tid: string) =>
    request<{ removed: number; group_dissolved: boolean }>(
      `/task-groups/${gid}/members/${tid}`,
      { method: "DELETE" },
    ),

  // Wave 4 — Görev Kilidi + tek kullanımlık OTP
  setLocks: (tid: string, lock_flags: Record<string, boolean>, requires_otp?: boolean) =>
    request<Task>(`/tasks/${tid}/locks`, {
      method: "PATCH",
      body: requires_otp === undefined ? { lock_flags } : { lock_flags, requires_otp },
    }),
  setSelfLocks: (tid: string, self_lock_flags: Record<string, boolean>) =>
    request<Task>(`/tasks/${tid}/self-locks`, { method: "PATCH", body: { self_lock_flags } }),
  unlockSimple: (tid: string) =>
    request<Task>(`/tasks/${tid}/unlock-simple`, { method: "POST" }),
  issueUnlockOtp: (tid: string) =>
    request<OtpIssueResponse>(`/tasks/${tid}/unlock-otp`, { method: "POST" }),
  verifyUnlockOtp: (tid: string, code: string) =>
    request<Task>(`/tasks/${tid}/unlock-verify`, { method: "POST", body: { code } }),
  lockAudit: (tid: string) =>
    request<{ task_id: string; count: number; rows: LockAuditRow[] }>(
      `/tasks/${tid}/lock-audit`,
    ),

  // Frontend Hata Radarı — istemci hata kayıtları (yalnızca süper yönetici).
  clientLogs: (limit = 100) =>
    request<{ logs: ClientLog[]; total: number; last_24h: number }>(
      `/admin/client-logs?limit=${limit}`,
    ),
  clearClientLogs: () =>
    request<{ deleted: number }>("/admin/client-logs", { method: "DELETE" }),
};

// Full absolute URL for an attachment download (for expo-image / expo-file-system).
export function attachmentDownloadUrl(tid: string, attId: string): string {
  return `${BASE}/api/tasks/${tid}/attachments/${attId}/download`;
}

// Authorization header for authed asset fetches (expo-image / downloadAsync).
export async function authHeader(): Promise<Record<string, string>> {
  const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Chunked attachment upload: init (JSON) -> chunk (multipart, whole file as
// one part) -> complete (JSON). Returns the created TaskAttachment.
export async function uploadAttachment(
  tid: string,
  file: { uri: string; name: string; type: string; size?: number },
): Promise<TaskAttachment> {
  const init = await request<{ upload_id: string }>(
    `/tasks/${tid}/attachments/init`,
    {
      method: "POST",
      body: {
        filename: file.name,
        content_type: file.type,
        total_size: file.size ?? 0,
      },
    },
  );
  const uploadId = init.upload_id;

  const token = await storage.secureGet<string>(AUTH_TOKEN_KEY, "");
  const form = new FormData();
  form.append("upload_id", uploadId);
  form.append("index", "0");
  if (Platform.OS === "web") {
    // react-native-web: append a real Blob (a plain {uri,name,type} object
    // would be stringified to "[object Object]" by the DOM FormData).
    const blobRes = await fetch(file.uri);
    const blob = await blobRes.blob();
    form.append("chunk", blob, file.name);
  } else {
    // React Native native FormData file part.
    form.append("chunk", {
      uri: file.uri,
      name: file.name,
      type: file.type,
    } as unknown as Blob);
  }

  let chunkRes: Response;
  try {
    chunkRes = await fetch(`${BASE}/api/tasks/${tid}/attachments/chunk`, {
      method: "POST",
      headers: token ? { Authorization: `Bearer ${token}` } : undefined,
      body: form,
    });
  } catch {
    throw new ApiError(0, "Yükleme sırasında sunucuya ulaşılamadı.");
  }
  if (!chunkRes.ok) {
    const t = await chunkRes.text();
    throw new ApiError(chunkRes.status, t || "Dosya yüklenemedi");
  }

  return request<TaskAttachment>(`/tasks/${tid}/attachments/complete`, {
    method: "POST",
    body: { upload_id: uploadId },
  });
}
