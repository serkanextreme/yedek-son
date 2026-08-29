// Alternatif arayüzler (Teknik/Aydınlık/Pano) için ortak küçük yardımcılar.
// Not: KolayInterface + ProfesyonelInterface kendi kopyalarını kullanır
// (çalışıyor, dokunulmadı) — burası yeni 3 arayüz içindir.

export const isActive = (t) => t.status !== "done" && !t.archived && !t.deleted;
export const isOverdue = (t) => isActive(t) && !!t.due_date && new Date(t.due_date).getTime() < Date.now();

export const bucketOf = (t) => {
  if (t.status === "done") return { label: "Tamamlandı", color: "#10b981" };
  if (t.status === "paused") return { label: "Beklemede", color: "#f59e0b" };
  if (isOverdue(t)) return { label: "Süresi Geçti", color: "#f43f5e" };
  const due = t.due_date ? new Date(t.due_date) : null;
  if (due && due.getTime() - Date.now() < 2 * 86400000) return { label: "Yaklaşıyor", color: "#f59e0b" };
  return { label: "Aktif", color: "accent" };
};

export const progressOf = (t) => {
  const subs = Array.isArray(t.subtasks) ? t.subtasks : [];
  if (subs.length) {
    const done = subs.filter((s) => s.done || s.status === "done").length;
    return Math.round((done / subs.length) * 100);
  }
  return t.status === "done" ? 100 : 0;
};

export const fmtDate = (iso) => {
  if (!iso) return null;
  try { return new Date(iso).toLocaleDateString("tr-TR", { day: "numeric", month: "short" }); } catch { return null; }
};

export const initials = (name) =>
  (name || "").trim().split(/\s+/).map((w) => w[0]).join("").slice(0, 2).toUpperCase() || "?";

export const matchesQuery = (t, q, catName) => {
  const query = (q || "").trim().toLocaleLowerCase("tr");
  if (!query) return true;
  return [t.title, t.description, t.assignee_name, t.company_name, catName ? catName(t.category_id) : null]
    .filter(Boolean).join(" ").toLocaleLowerCase("tr").includes(query);
};
