// Görevler panelini / iş kolunu sidebar dışına yüzen pencere olarak çıkarma
// için küçük store. Kalıcı (localStorage) + pub/sub. Aynı anda birden fazla
// iş kolu penceresi açılabilir; her kategori için tek pencere (dedupe).
const KEY = "sertex_detached_panels_v1";

let panels = load();
const subs = new Set();

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "[]");
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(panels));
  } catch (e) {
    console.warn("[detachedPanels] persist failed:", e);
  }
  subs.forEach((cb) => cb(panels));
}

export function getDetachedPanels() {
  return panels;
}

export function subscribeDetachedPanels(cb) {
  subs.add(cb);
  return () => subs.delete(cb);
}

// category=null → tüm panel; category=<id> → o iş kolu penceresi.
export function openDetachedPanel({ category = null, categoryName = null } = {}) {
  const key = category || null;
  const existing = panels.find((p) => (p.category || null) === key);
  if (existing) return existing.id;
  const id = `dp_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  panels = [...panels, { id, category: key, categoryName }];
  persist();
  return id;
}

export function closeDetachedPanel(id) {
  panels = panels.filter((p) => p.id !== id);
  persist();
}
