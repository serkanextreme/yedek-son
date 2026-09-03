import axios from "axios";

// Fallback to same-origin if REACT_APP_BACKEND_URL is missing at build time
// (avoids "undefined/api/..." requests that never resolve and cause silent white screens)
const rawBackend = process.env.REACT_APP_BACKEND_URL;
const BACKEND_URL =
  rawBackend && rawBackend !== "undefined" && rawBackend !== "null"
    ? rawBackend.replace(/\/+$/, "")
    : (typeof window !== "undefined" ? window.location.origin : "");
export const API = `${BACKEND_URL}/api`;

export const api = axios.create({ baseURL: API });

// Global 401/402 interceptor for license & session enforcement.
// Dispatches a window event that SertexMain listens to.
api.interceptors.response.use(
  (r) => r,
  (err) => {
    const detail = err.response?.data?.detail || "";
    const status = err.response?.status;
    // P2 — Merkezî hata loglama: hiçbir API hatası tamamen sessiz kalmasın.
    // Beklenen/işlenen sinyalleri (SESSION_KICKED, NO_LICENSE) ve olağan 401
    // (oturum yokken /auth/me) console gürültüsünü önlemek için atla.
    const _handledSignal =
      (status === 402 && typeof detail === "string" && detail.startsWith("NO_LICENSE")) ||
      (status === 401 && typeof detail === "string" && detail.startsWith("SESSION_KICKED"));
    if (!_handledSignal && status !== 401) {
      const _cfg = err.config || {};
      // eslint-disable-next-line no-console
      console.warn(
        `[API] ${(_cfg.method || "get").toUpperCase()} ${_cfg.url || ""} → ${status || "ağ hatası"}`,
        (typeof detail === "string" && detail) || err.message
      );
    }
    if (status === 401 && typeof detail === "string" && detail.startsWith("SESSION_KICKED")) {
      try {
        window.dispatchEvent(new CustomEvent("sertex:session-kicked", { detail }));
      } catch (e) { console.warn("[api.js] hata bastırıldı:", e); }
    } else if (status === 402 && typeof detail === "string" && detail.startsWith("NO_LICENSE")) {
      try {
        window.dispatchEvent(new CustomEvent("sertex:no-license", { detail }));
      } catch (e) { console.warn("[api.js] hata bastırıldı:", e); }
    }
    return Promise.reject(err);
  }
);

export const chatApi = {
  send: (message, conversation_id, language = "tr") =>
    api.post("/chat", { message, conversation_id, language }).then((r) => r.data),
  listConversations: () => api.get("/conversations").then((r) => r.data),
  getMessages: (cid) => api.get(`/conversations/${cid}/messages`).then((r) => r.data),
  deleteConversation: (cid) => api.delete(`/conversations/${cid}`).then((r) => r.data),
};

export const notesApi = {
  list: () => api.get("/notes").then((r) => r.data),
  create: (content) => api.post("/notes", { content }).then((r) => r.data),
  delete: (id) => api.delete(`/notes/${id}`).then((r) => r.data),
};

export const remindersApi = {
  list: () => api.get("/reminders").then((r) => r.data),
  create: (title, remind_at) =>
    api.post("/reminders", { title, remind_at }).then((r) => r.data),
  toggle: (id) => api.patch(`/reminders/${id}`).then((r) => r.data),
  delete: (id) => api.delete(`/reminders/${id}`).then((r) => r.data),
};

export const authApi = {
  impersonate: (uid) =>
    api.post(`/admin/users/${uid}/impersonate`).then((r) => r.data),
};

export const tasksApi = {
  list: (archived = false, scope = "mine", view = null) =>
    api.get("/tasks", { params: { archived, scope, ...(view ? { view } : {}) } }).then((r) => r.data),
  archiveCounts: (scope = "mine") =>
    api.get("/tasks/archive-counts", { params: { scope } }).then((r) => r.data),
  // Arşiv grupları — İptal Et / Geri Yükle / Çöp kutusu (soft-delete).
  cancel: (id, reason) => api.post(`/tasks/${id}/cancel`, reason ? { reason } : {}).then((r) => r.data),
  uncancel: (id) => api.post(`/tasks/${id}/uncancel`).then((r) => r.data),
  restore: (id) => api.post(`/tasks/${id}/restore`).then((r) => r.data),
  permanentDelete: (id) => api.delete(`/tasks/${id}/permanent`).then((r) => r.data),
  // Arşiv geneli arama (BİTMİŞ+İPTAL+SİLİNMİŞ) — genel aramada arşivi de kapsar.
  searchArchive: (q, scope = "mine") =>
    api.get("/tasks/search", { params: { q, scope } }).then((r) => r.data),
  // Global arşiv ayarları + geçerli kullanıcının yetkileri.
  getSettings: () => api.get("/tasks/settings").then((r) => r.data),
  putSettings: (patch) => api.put("/tasks/settings", patch).then((r) => r.data),
  emptyTrash: (scope = "mine") =>
    api.post("/tasks/trash/empty", null, { params: { scope } }).then((r) => r.data),
  get: (id) => api.get(`/tasks/${id}`).then((r) => r.data),
  create: (title, description = "", due_date = null, reminder_at = null, extras = {}) =>
    api.post("/tasks", {
      title,
      description,
      due_date,
      reminder_at,
      ...(extras.start_date != null ? { start_date: extras.start_date } : {}),
      ...(extras.assignee_name != null ? { assignee_name: extras.assignee_name } : {}),
      ...(extras.company_name != null ? { company_name: extras.company_name } : {}),
      ...(extras.assignee_user_id ? { assignee_user_id: extras.assignee_user_id } : {}),
      ...(extras.assignee_user_ids && extras.assignee_user_ids.length
        ? { assignee_user_ids: extras.assignee_user_ids } : {}),
      ...(extras.category_id ? { category_id: extras.category_id } : {}),
      // Faz 8 CP5 — due-soon reminder override on the new task.
      ...(extras.reminder_days != null ? { reminder_days: extras.reminder_days } : {}),
      ...(extras.reminder_disabled === true ? { reminder_disabled: true } : {}),
      // Tekrarlı hatırlatma — oluştururken de ayarlanabilir.
      ...(extras.reminder_interval_min != null ? { reminder_interval_min: extras.reminder_interval_min } : {}),
      ...(extras.reminder_repeat_total != null ? { reminder_repeat_total: extras.reminder_repeat_total } : {}),
      ...(extras.reminder_repeat_left != null ? { reminder_repeat_left: extras.reminder_repeat_left } : {}),
    }).then((r) => r.data),
  // Görev Kopyalama (Kopyala → Yapıştır) — kaynağı çoğaltır, kopya bana atanır.
  duplicate: (id, { include_subtasks = true, include_attachments = true, category_id = null } = {}) =>
    api.post(`/tasks/${id}/duplicate`, { include_subtasks, include_attachments, category_id }).then((r) => r.data),
  update: (id, patch) => api.patch(`/tasks/${id}`, patch).then((r) => r.data),
  setStatus: (id, status) =>
    api.patch(`/tasks/${id}`, { status }).then((r) => r.data),
  setReminder: (id, reminder_at, opts = {}) =>
    api
      .patch(`/tasks/${id}`, {
        reminder_at,
        reminder_fired: false,
        reminder_interval_min: opts.intervalMin ?? null,
        reminder_repeat_left: opts.repeatLeft ?? null,
        reminder_repeat_total: opts.repeatTotal ?? null,
      })
      .then((r) => r.data),
  markReminderFired: (id) =>
    api
      .patch(`/tasks/${id}`, {
        reminder_fired: true,
        reminder_interval_min: null,
        reminder_repeat_left: null,
        reminder_repeat_total: null,
      })
      .then((r) => r.data),
  // Tekrarlı hatırlatma — bir sonraki tekrarı planla (interval sonrası).
  rescheduleReminder: (id, reminder_at, repeatLeft) =>
    api
      .patch(`/tasks/${id}`, { reminder_at, reminder_fired: false, reminder_repeat_left: repeatLeft })
      .then((r) => r.data),
  setSubtasks: (id, subtasks) =>
    api.patch(`/tasks/${id}`, { subtasks }).then((r) => r.data),
  setArchived: (id, archived) =>
    api.patch(`/tasks/${id}`, { archived }).then((r) => r.data),
  snooze: (id, iso) =>
    api.patch(`/tasks/${id}`, { snoozed_until: iso }).then((r) => r.data),
  reorder: (ids) => api.post(`/tasks/reorder`, { ids }).then((r) => r.data),
  delete: (id, reason) => api.delete(`/tasks/${id}`, reason ? { params: { reason } } : undefined).then((r) => r.data),
  // Faz 8 CP3 — transfer ownership to a visible team member.
  reassign: (id, new_owner_user_id) =>
    api.post(`/tasks/${id}/reassign`, { new_owner_user_id }).then((r) => r.data),
  // Alt görevi tam bir göreve dönüştür (promote).
  promoteSubtask: (id, subId) =>
    api.post(`/tasks/${id}/subtasks/${subId}/promote`).then((r) => r.data),
  // Görevi geri ana görevin alt görevine dönüştür (promote'u geri al).
  demoteToSubtask: (id) =>
    api.post(`/tasks/${id}/demote-to-subtask`).then((r) => r.data),
  // Şirkete Devret — görevi bir şirkete aktar (sahipsiz + kolsuz orphan).
  transferToCompany: (id, company_id) =>
    api.post(`/tasks/${id}/transfer-company`, { company_id }).then((r) => r.data),
  // Devredilebilecek şirketler (admin: hepsi · müdür: kendi + aktif izinler).
  transferCompanies: () =>
    api.get("/task-transfer-companies").then((r) => r.data),
  // Görev Paylaşımı — set/replace the per-task share ACL (ÖZELLİK B).
  setShares: (id, shares, notify = true) =>
    api.put(`/tasks/${id}/shares`, { shares, notify }).then((r) => r.data),
  // Görev Paylaşımı — an assignee toggles their OWN completion (ÖZELLİK A).
  myCompletion: (id, completed) =>
    api.post(`/tasks/${id}/my-completion`, { completed }).then((r) => r.data),
  // Dürt / Hatırlat — manager pokes the task owner (bell + push).
  nudge: (id, message = "") =>
    api.post(`/tasks/${id}/nudge`, { message }).then((r) => r.data),
  // Görev Bağlama (Task Groups / Chains).
  listGroups: () => api.get("/task-groups").then((r) => r.data),
  createGroup: (payload) => api.post("/task-groups", payload).then((r) => r.data),
  updateGroup: (gid, payload) => api.patch(`/task-groups/${gid}`, payload).then((r) => r.data),
  deleteGroup: (gid) => api.delete(`/task-groups/${gid}`).then((r) => r.data),
  removeGroupMember: (gid, tid) =>
    api.delete(`/task-groups/${gid}/members/${tid}`).then((r) => r.data),
};

// Görev Paylaşımı — system-wide user search for the share picker (S3-a).
export const usersApi = {
  search: (q) => api.get("/users/search", { params: { q } }).then((r) => r.data),
};

export const weatherApi = {
  get: (city = "Istanbul", opts = {}) => {
    const params = { city };
    if (opts.lat != null) params.lat = opts.lat;
    if (opts.lon != null) params.lon = opts.lon;
    if (opts.tz) params.tz = opts.tz;
    return api.get("/weather", { params }).then((r) => r.data);
  },
  search: (q) => api.get("/weather/search", { params: { q } }).then((r) => r.data),
};

export const ttsApi = {
  synthesize: async (text, voice = "onyx") => {
    const res = await api.post(
      "/tts",
      { text, voice },
      { responseType: "blob" }
    );
    return URL.createObjectURL(res.data);
  },
};

export const memoryApi = {
  list: () => api.get("/memory").then((r) => r.data),
  create: (content, category = "other", importance = 3) =>
    api.post("/memory", { content, category, importance }).then((r) => r.data),
  update: (id, patch) => api.patch(`/memory/${id}`, patch).then((r) => r.data),
  delete: (id) => api.delete(`/memory/${id}`).then((r) => r.data),
  deleteAll: () => api.delete("/memory").then((r) => r.data),
};

export const filesApi = {
  list: () => api.get("/files").then((r) => r.data),
  get: (id) => api.get(`/files/${id}`).then((r) => r.data),
  upload: (file, onProgress) => {
    const fd = new FormData();
    fd.append("file", file);
    return api
      .post("/files", fd, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (evt) => {
          if (onProgress && evt.total) {
            onProgress(Math.round((evt.loaded * 100) / evt.total));
          }
        },
      })
      .then((r) => r.data);
  },
  summarize: (id) => api.post(`/files/${id}/summarize`).then((r) => r.data),
  ask: (id, question) =>
    api.post(`/files/${id}/ask`, { question }).then((r) => r.data),
  reindex: (id) => api.post(`/files/${id}/reindex`).then((r) => r.data),
  reindexAll: () => api.post(`/files/rag/reindex-all`).then((r) => r.data),
  ragStatus: () => api.get(`/files/rag/status`).then((r) => r.data),
  delete: (id) => api.delete(`/files/${id}`).then((r) => r.data),
  downloadUrl: (id) => `${API}/files/${id}/download`,
};

export const licenseApi = {
  me: () => api.get(`/license/me`).then((r) => r.data),
  redeem: (key) => api.post(`/license/redeem`, { key }).then((r) => r.data),
  logoutOthers: () => api.post(`/license/logout-others`).then((r) => r.data),
};

export const adminLicenseApi = {
  list: (params = {}) =>
    api.get(`/admin/licenses`, { params }).then((r) => r.data),
  stats: () => api.get(`/admin/licenses/stats`).then((r) => r.data),
  generate: (payload) =>
    api.post(`/admin/licenses/generate`, payload).then((r) => r.data),
  patch: (id, payload) =>
    api.patch(`/admin/licenses/${id}`, payload).then((r) => r.data),
  delete: (id) => api.delete(`/admin/licenses/${id}`).then((r) => r.data),
};

export const backupApi = {
  status: () => api.get(`/backup/status`).then((r) => r.data),
  list: () => api.get(`/backup/list`).then((r) => r.data),
  runNow: () => api.post(`/backup/run`).then((r) => r.data),
  prune: () => api.post(`/backup/prune`).then((r) => r.data),
  remove: (id) => api.delete(`/backup/${id}`).then((r) => r.data),
  downloadUrl: (id) => `${API}/backup/${id}/download`,
};

export const excelApi = {
  analyze: (id) => api.get(`/excel/${id}/analyze`).then((r) => r.data),
  formula: (id, task, sheet) =>
    api.post(`/excel/${id}/formula`, { task, sheet }).then((r) => r.data),
  query: (id, question) =>
    api.post(`/excel/${id}/query`, { question }).then((r) => r.data),
  pivot: (id, task, sheet) =>
    api.post(`/excel/${id}/pivot`, { task, sheet }).then((r) => r.data),
  charts: (id) => api.get(`/excel/${id}/charts`).then((r) => r.data),
  chartData: (id, params) =>
    api.post(`/excel/${id}/chart-data`, params).then((r) => r.data),
};

export const emailApi = {
  providers: () => api.get(`/email/providers`).then((r) => r.data),
  listAccounts: () => api.get(`/email/accounts`).then((r) => r.data),
  addAccount: (payload) => api.post(`/email/accounts`, payload).then((r) => r.data),
  deleteAccount: (id) => api.delete(`/email/accounts/${id}`).then((r) => r.data),
  testAccount: (id) => api.post(`/email/accounts/${id}/test`).then((r) => r.data),
  folders: (id) => api.get(`/email/accounts/${id}/folders`).then((r) => r.data),
  messages: (id, { folder = "INBOX", limit = 30, q = "", unread_only = false } = {}) =>
    api
      .get(`/email/accounts/${id}/messages`, {
        params: { folder, limit, q: q || undefined, unread_only },
      })
      .then((r) => r.data),
  message: (id, folder, uid) =>
    api
      .get(`/email/accounts/${id}/message`, { params: { folder, uid } })
      .then((r) => r.data),
  send: (id, payload) => api.post(`/email/accounts/${id}/send`, payload).then((r) => r.data),
  markSeen: (id, folder, uids, seen) =>
    api
      .post(`/email/accounts/${id}/mark-seen`, { folder, uids, seen })
      .then((r) => r.data),
  deleteMessages: (id, folder, uids) =>
    api
      .post(`/email/accounts/${id}/delete-messages`, { folder, uids })
      .then((r) => r.data),
};

export const sttApi = {
  whisper: async (audioBlob, language = "tr") => {
    const fd = new FormData();
    const ext = audioBlob.type.includes("webm")
      ? "webm"
      : audioBlob.type.includes("mp4") || audioBlob.type.includes("m4a")
      ? "m4a"
      : audioBlob.type.includes("wav")
      ? "wav"
      : audioBlob.type.includes("ogg")
      ? "ogg"
      : "webm";
    fd.append("audio", audioBlob, `audio.${ext}`);
    fd.append("language", language);
    const res = await api.post("/stt/whisper", fd, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return res.data.text || "";
  },
};

export const statsApi = {
  summary: () => api.get("/stats/summary").then((r) => r.data),
  getSystemQuota: () => api.get("/admin/system-quota").then((r) => r.data),
  setSystemQuota: (quota_mb) =>
    api.put("/admin/system-quota", { quota_mb }).then((r) => r.data),
  // Faz 9 CP4 — Production monitoring snapshot.
  adminHealth: () => api.get("/admin/health").then((r) => r.data),
};

// Faz 8 — Multi-tenant RBAC
export const companiesApi = {
  list: () => api.get("/companies").then((r) => r.data),
  create: (name) => api.post("/companies", { name }).then((r) => r.data),
  update: (cid, patch) => {
    // Accept either a plain string (legacy) or an object patch. String → name only.
    const body = typeof patch === "string" ? { name: patch } : patch;
    return api.patch(`/companies/${cid}`, body).then((r) => r.data);
  },
  delete: (cid) => api.delete(`/companies/${cid}`).then((r) => r.data),
  // Faz 8 CP6 — Multi-company membership.
  listMembers: (cid) => api.get(`/companies/${cid}/members`).then((r) => r.data),
  addMember: (cid, uid) => api.post(`/companies/${cid}/members/${uid}`).then((r) => r.data),
  removeMember: (cid, uid) => api.delete(`/companies/${cid}/members/${uid}`).then((r) => r.data),
};

// Faz 8 CP6 — Cross-company permission (request/approve/decline/revoke).
export const companyPermissionsApi = {
  list: (params = {}) => api.get("/company-permissions", { params }).then((r) => r.data),
  request: (viewer_company_id, target_company_id) =>
    api.post("/company-permissions", { viewer_company_id, target_company_id }).then((r) => r.data),
  respond: (cpid, approve) =>
    api.post(`/company-permissions/${cpid}/respond?approve=${approve ? "true" : "false"}`)
      .then((r) => r.data),
  revoke: (cpid) => api.post(`/company-permissions/${cpid}/revoke`).then((r) => r.data),
  delete: (cpid) => api.delete(`/company-permissions/${cpid}`).then((r) => r.data),
};

// Faz 8 CP6 — Orphan tasks pool ("Yarım Kalan İşler").
export const orphanTasksApi = {
  list: () => api.get("/orphan-tasks").then((r) => r.data),
  count: () => api.get("/orphan-tasks/count").then((r) => r.data),
};

// Faz 8 CP5 — Due-soon reminder configuration (user + company thresholds).
export const reminderConfigApi = {
  get: () => api.get("/settings/reminder-config").then((r) => r.data),
  setUserThreshold: (days) =>
    api.put("/settings/reminder-threshold", { days }).then((r) => r.data),
};

export const managerVisibilityApi = {
  list: (manager_user_id) =>
    api.get("/manager-visibility", { params: manager_user_id ? { manager_user_id } : {} })
      .then((r) => r.data),
  grant: (manager_user_id, employee_user_id) =>
    api.post("/manager-visibility", { manager_user_id, employee_user_id }).then((r) => r.data),
  revoke: (mvid) => api.delete(`/manager-visibility/${mvid}`).then((r) => r.data),
};

// Faz 8 CP3 — team roll-ups (visible to callers with visibility rows).
export const teamApi = {
  members: () => api.get("/team/members").then((r) => r.data),
  summary: () => api.get("/team/summary").then((r) => r.data),
  heatmap: (days = 60) => api.get(`/team/heatmap?days=${days}`).then((r) => r.data),
  // Faz 9 CP2 — İş kolu bazlı özet (Manager dashboard "İş Kolu Performansı" kart grid).
  categorySummary: () => api.get("/team/category-summary").then((r) => r.data),
  // Geciken Görev Özeti & Toplu Dürt (Admin/Müdür).
  overdueSummary: () => api.get("/team/overdue-summary").then((r) => r.data),
  bulkNudge: (task_ids) => api.post("/team/bulk-nudge", { task_ids }).then((r) => r.data),
};

// Frontend Error Radar — admin: tarayıcı hata kayıtlarını görüntüle / temizle.
export const clientLogsApi = {
  list: ({ limit = 100, status = "active", level = "" } = {}) => {
    const p = new URLSearchParams({ limit: String(limit) });
    if (status) p.set("status", status);
    if (level) p.set("level", level);
    return api.get(`/admin/client-logs?${p.toString()}`).then((r) => r.data);
  },
  clear: () => api.delete("/admin/client-logs").then((r) => r.data),
  resolve: (id, resolved = true) => api.post(`/admin/client-logs/${id}/resolve`, { resolved }).then((r) => r.data),
  resolveBulk: (message, resolved = true) => api.post(`/admin/client-logs/resolve-bulk`, { message, resolved }).then((r) => r.data),
  getNotifySettings: () => api.get("/admin/client-logs/notify-settings").then((r) => r.data),
  setNotifySettings: (body) => api.put("/admin/client-logs/notify-settings", body).then((r) => r.data),
};

// Team Faz 2 — in-app notifications (overdue task fan-out).
export const notificationsApi = {
  list: (unread_only = false, limit = 50) =>
    api.get("/notifications", { params: { unread_only, limit } }).then((r) => r.data),
  unreadCount: () => api.get("/notifications/unread-count").then((r) => r.data),
  markRead: (nid) => api.post(`/notifications/${nid}/read`).then((r) => r.data),
  markAllRead: () => api.post("/notifications/read-all").then((r) => r.data),
  remove: (nid) => api.delete(`/notifications/${nid}`).then((r) => r.data),
  removeSelected: (ids) =>
    api.post("/notifications/delete-selected", { ids }).then((r) => r.data),
  removeAll: () => api.delete("/notifications").then((r) => r.data),
  scanNow: () => api.post("/notifications/scan-now").then((r) => r.data),
  getDigestSettings: () => api.get("/notifications/digest-settings").then((r) => r.data),
  updateDigestSettings: (settings) =>
    api.put("/notifications/digest-settings", settings).then((r) => r.data),
};

// Faz 8 CP4 — İş Kolları (per-company task categories).
// Faz 9 CP4.23 — `scope` param: "manage" (admin/manager UI) or "my_tasks"
// (task panel; strictly visibility-filtered).
export const taskCategoriesApi = {
  list: (scope = "manage") =>
    api.get("/task-categories", { params: { scope } }).then((r) => r.data),
  create: (name, color = null, company_id = null, parent_id = null) =>
    api.post("/task-categories", { name, color, company_id, parent_id }).then((r) => r.data),
  update: (id, patch) => api.patch(`/task-categories/${id}`, patch).then((r) => r.data),
  delete: (id) => api.delete(`/task-categories/${id}`).then((r) => r.data),
  // İş kolu çip sırasını sunucuda tut (cihazlar arası senkron).
  stats: () => api.get("/task-categories/stats").then((r) => r.data),
  getOrder: () => api.get("/task-categories/order").then((r) => r.data),
  setOrder: (order) =>
    api.put("/task-categories/order", { order }).then((r) => r.data),
};

// Faz 9 CP4.27 — Task lock configuration + one-time unlock OTP.
export const taskLockApi = {
  /** Set (or clear) the lock_flags map on a task. `flags` = { lock_edit: true, ... } */
  setLocks: (task_id, flags, requiresOtp) => {
    const body = { lock_flags: flags || {} };
    if (requiresOtp !== undefined) body.requires_otp = !!requiresOtp;
    return api.patch(`/tasks/${task_id}/locks`, body).then((r) => r.data);
  },
  /** Faz 9 CP4.30 — assignee-side self-lock (freely removable, no OTP). */
  setSelfLocks: (task_id, flags) =>
    api.patch(`/tasks/${task_id}/self-locks`, { self_lock_flags: flags || {} }).then((r) => r.data),
  /** Creator/admin/manager generates a 6-digit unlock code (returned once). */
  issueOtp: (task_id) => api.post(`/tasks/${task_id}/unlock-otp`).then((r) => r.data),
  /** Assignee submits the code; on success opens a 10-min single-use unlock window. */
  verifyOtp: (task_id, code) =>
    api.post(`/tasks/${task_id}/unlock-verify`, { code }).then((r) => r.data),
  /** Faz 9 CP4.30 — OTP-less unlock (only when task.lock_requires_otp=false). */
  unlockSimple: (task_id) =>
    api.post(`/tasks/${task_id}/unlock-simple`).then((r) => r.data),
  /** Faz 9 CP4.28 — audit trail for a task's lock lifecycle. */
  audit: (task_id, limit = 100) =>
    api.get(`/tasks/${task_id}/lock-audit`, { params: { limit } }).then((r) => r.data),
};

// Faz 9 CP4.30 — User-level default lock policy (inherited by new tasks).
export const userLockApi = {
  get: (user_id) => api.get(`/users/${user_id}/lock-flags`).then((r) => r.data),
  set: (user_id, flags, requiresOtp) => {
    const body = { lock_flags: flags || {} };
    if (requiresOtp !== undefined) body.requires_otp = !!requiresOtp;
    return api.patch(`/users/${user_id}/lock-flags`, body).then((r) => r.data);
  },
  audit: (user_id, limit = 100) =>
    api.get(`/users/${user_id}/lock-audit`, { params: { limit } }).then((r) => r.data),
};

// Arşiv v2 — kişi bazlı arşiv yetkileri (admin verir/alır).
export const archiveCapsApi = {
  set: (user_id, caps) =>
    api.patch(`/users/${user_id}/archive-caps`, caps).then((r) => r.data),
};

// Faz 9 CP4.33 — Reusable lock policy templates (admin/manager scope).
export const lockPolicyTemplateApi = {
  list: () => api.get("/lock-policy-templates").then((r) => r.data),
  create: (payload) => api.post("/lock-policy-templates", payload).then((r) => r.data),
  update: (id, payload) => api.patch(`/lock-policy-templates/${id}`, payload).then((r) => r.data),
  remove: (id) => api.delete(`/lock-policy-templates/${id}`).then((r) => r.data),
};

// Faz 9 CP6 — Global Announcement System.
export const announcementsApi = {
  // Admin
  listAll: () => api.get("/announcements").then((r) => r.data),
  create: (payload) => api.post("/announcements", payload).then((r) => r.data),
  update: (id, patch) => api.patch(`/announcements/${id}`, patch).then((r) => r.data),
  softDelete: (id) => api.delete(`/announcements/${id}`).then((r) => r.data),
  purge: (id) => api.delete(`/announcements/${id}/purge`).then((r) => r.data),
  stats: (id) => api.get(`/announcements/${id}/stats`).then((r) => r.data),
  // User
  activeForMe: () => api.get("/announcements/active").then((r) => r.data),
  ack: (id) => api.post(`/announcements/${id}/ack`).then((r) => r.data),
};

// Görev Dosya Ekleri — chunked upload (büyük dosya) + object storage.
const ATTACH_CHUNK_SIZE = 4 * 1024 * 1024; // 4 MB / parça
export const taskAttachmentsApi = {
  list: (tid) => api.get(`/tasks/${tid}/attachments`).then((r) => r.data),
  remove: (tid, attId) =>
    api.delete(`/tasks/${tid}/attachments/${attId}`).then((r) => r.data),
  // İndirme — blob olarak çeker (auth header ile), çağıran indirmeyi tetikler.
  download: (tid, attId) =>
    api.get(`/tasks/${tid}/attachments/${attId}/download`, { responseType: "blob" }),
  // Parçalı yükleme: init → chunk* → complete. onProgress(0-100).
  upload: async (tid, file, onProgress) => {
    const initRes = await api.post(`/tasks/${tid}/attachments/init`, {
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      total_size: file.size,
    });
    const uploadId = initRes.data.upload_id;
    const total = file.size || 0;
    let sent = 0;
    let index = 0;
    for (let start = 0; start < total; start += ATTACH_CHUNK_SIZE) {
      const blob = file.slice(start, Math.min(start + ATTACH_CHUNK_SIZE, total));
      const fd = new FormData();
      fd.append("upload_id", uploadId);
      fd.append("index", String(index));
      fd.append("chunk", blob, file.name);
      await api.post(`/tasks/${tid}/attachments/chunk`, fd);
      sent += blob.size;
      index += 1;
      if (onProgress) onProgress(Math.min(99, Math.round((sent / total) * 100)));
    }
    const done = await api.post(`/tasks/${tid}/attachments/complete`, { upload_id: uploadId });
    if (onProgress) onProgress(100);
    return done.data;
  },
};

// Görev Şablonları (Task Templates) — sık görevleri şablonla, hızlı oluştur.
export const templatesApi = {
  list: () => api.get("/task-templates").then((r) => r.data),
  get: (id) => api.get(`/task-templates/${id}`).then((r) => r.data),
  create: (body) => api.post("/task-templates", body).then((r) => r.data),
  update: (id, patch) => api.patch(`/task-templates/${id}`, patch).then((r) => r.data),
  remove: (id) => api.delete(`/task-templates/${id}`).then((r) => r.data),
  // Şablondan başlat — gerçek görev oluşturur (bana atanır), Task döner.
  instantiate: (id, { category_id = null } = {}) =>
    api.post(`/task-templates/${id}/instantiate`, { category_id }).then((r) => r.data),
};

// Şablon dosya ekleri — taskAttachmentsApi ile AYNI şekil (TaskAttachments
// bileşeni `attachmentApi` prop'u ile bunu kullanır).
export const templateAttachmentsApi = {
  list: (id) => api.get(`/task-templates/${id}/attachments`).then((r) => r.data),
  remove: (id, attId) =>
    api.delete(`/task-templates/${id}/attachments/${attId}`).then((r) => r.data),
  download: (id, attId) =>
    api.get(`/task-templates/${id}/attachments/${attId}/download`, { responseType: "blob" }),
  upload: async (id, file, onProgress) => {
    const initRes = await api.post(`/task-templates/${id}/attachments/init`, {
      filename: file.name,
      content_type: file.type || "application/octet-stream",
      total_size: file.size,
    });
    const uploadId = initRes.data.upload_id;
    const total = file.size || 0;
    let sent = 0;
    let index = 0;
    for (let start = 0; start < total; start += ATTACH_CHUNK_SIZE) {
      const blob = file.slice(start, Math.min(start + ATTACH_CHUNK_SIZE, total));
      const fd = new FormData();
      fd.append("upload_id", uploadId);
      fd.append("index", String(index));
      fd.append("chunk", blob, file.name);
      await api.post(`/task-templates/${id}/attachments/chunk`, fd);
      sent += blob.size;
      index += 1;
      if (onProgress) onProgress(Math.min(99, Math.round((sent / total) * 100)));
    }
    const done = await api.post(`/task-templates/${id}/attachments/complete`, { upload_id: uploadId });
    if (onProgress) onProgress(100);
    return done.data;
  },
};



