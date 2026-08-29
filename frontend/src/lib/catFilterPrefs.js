// Sidebar iş kolu FİLTRE ağacında hangi düğümlerin (kategori id) AÇIK olduğunu
// KİŞİYE ÖZEL ve KALICI tutar. Varsayılan: kapalı (yalnızca ana kollar görünür).
// localStorage, user_id bazında.
const KEY = "sertex_catfilter_expanded_v1";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch (e) {
    console.warn("[catFilterPrefs] okuma hatası:", e);
    return {};
  }
}

export function getCatFilterExpandedSet(userId) {
  if (!userId) return new Set();
  const list = readAll()[userId];
  return new Set(Array.isArray(list) ? list : []);
}

export function setCatFilterExpanded(userId, catId, expanded) {
  if (!userId || !catId) return;
  const all = readAll();
  const set = new Set(Array.isArray(all[userId]) ? all[userId] : []);
  if (expanded) set.add(catId);
  else set.delete(catId);
  all[userId] = Array.from(set);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("[catFilterPrefs] yazma hatası:", e);
  }
}

// Toplu "hepsini aç/kapat" — kullanıcının açık düğüm listesini komple değiştirir.
export function saveCatFilterExpandedSet(userId, ids) {
  if (!userId) return;
  const all = readAll();
  all[userId] = Array.from(new Set(ids || []));
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("[catFilterPrefs] toplu yazma hatası:", e);
  }
}
