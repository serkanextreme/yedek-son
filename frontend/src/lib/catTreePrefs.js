// Görev kartında iş kolu (kategori) ağacının hangi görevlerde AÇIK (expanded)
// olduğunu KİŞİYE ÖZEL ve KALICI tutar. Varsayılan: kapalı (kompakt, yer
// kaplamaz). Kullanıcı bir kez açarsa/kaparsa localStorage'da user_id bazında
// saklanır → tekrar açtığında ayarı korunur, her seferinde ayar yapmaz.
const KEY = "sertex_cattree_expanded_v1";

function readAll() {
  try {
    return JSON.parse(localStorage.getItem(KEY) || "{}") || {};
  } catch (e) {
    console.warn("[catTreePrefs] okuma hatası:", e);
    return {};
  }
}

export function getCatTreeExpandedSet(userId) {
  if (!userId) return new Set();
  const list = readAll()[userId];
  return new Set(Array.isArray(list) ? list : []);
}

export function isCatTreeExpanded(userId, taskId) {
  if (!userId || !taskId) return false;
  const list = readAll()[userId];
  return Array.isArray(list) && list.includes(taskId);
}

export function setCatTreeExpanded(userId, taskId, expanded) {
  if (!userId || !taskId) return;
  const all = readAll();
  const set = new Set(Array.isArray(all[userId]) ? all[userId] : []);
  if (expanded) set.add(taskId);
  else set.delete(taskId);
  all[userId] = Array.from(set);
  try {
    localStorage.setItem(KEY, JSON.stringify(all));
  } catch (e) {
    console.warn("[catTreePrefs] yazma hatası:", e);
  }
}
