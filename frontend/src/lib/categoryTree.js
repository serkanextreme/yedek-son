// İş kolu (kategori) hiyerarşisi yardımcıları — parent_id tabanlı ağaç.
// Sınırsız derinlik; kök düğümlerde parent_id yok (null/undefined).

// Bir kategorinin kendisi + tüm alt kolları (id Set'i).
export function getDescendantIds(catId, categories) {
  const childrenBy = {};
  for (const c of categories) {
    const p = c.parent_id || null;
    (childrenBy[p] = childrenBy[p] || []).push(c.id);
  }
  const out = new Set();
  const stack = [catId];
  while (stack.length) {
    const id = stack.pop();
    if (out.has(id)) continue;
    out.add(id);
    for (const ch of childrenBy[id] || []) stack.push(ch);
  }
  return out;
}

// Kök → düğüm yolu (kategori nesneleri dizisi).
export function getCategoryPath(catId, categories) {
  const byId = {};
  for (const c of categories) byId[c.id] = c;
  const path = [];
  let cur = byId[catId];
  const guard = new Set();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    path.unshift(cur);
    cur = cur.parent_id ? byId[cur.parent_id] : null;
  }
  return path;
}

// "Şirket İşi › İmalat › Üretim" breadcrumb etiketi.
export function getCategoryPathLabel(catId, categories, sep = " › ") {
  return getCategoryPath(catId, categories).map((c) => c.name).join(sep);
}

// Düğümün derinliği (kök = 0).
export function getCategoryDepth(catId, categories) {
  return Math.max(0, getCategoryPath(catId, categories).length - 1);
}

// DFS sıralı düz liste: her düğüme __depth eklenir. Aynı seviyede ada göre (tr).
export function flattenTree(categories, parentId = null, depth = 0, out = []) {
  const children = categories
    .filter((c) => (c.parent_id || null) === parentId)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"));
  for (const c of children) {
    out.push({ ...c, __depth: depth });
    flattenTree(categories, c.id, depth + 1, out);
  }
  return out;
}

// İş kolu mini-rapor toplaması (rollup). `direct` = { catId: {total, done} }
// doğrudan sayılar; her kol için kendisi + tüm alt kollarını toplar.
// Dönüş: { catId: {total, done, pct} }.
export function rollupCategoryStats(direct, categories) {
  const out = {};
  if (!direct) return out;
  for (const c of categories) {
    let total = 0;
    let done = 0;
    for (const id of getDescendantIds(c.id, categories)) {
      const d = direct[id];
      if (d) {
        total += d.total || 0;
        done += d.done || 0;
      }
    }
    out[c.id] = { total, done, pct: total ? Math.round((done / total) * 100) : 0 };
  }
  return out;
}

// Ağaç: [{ ...cat, children: [...] }]
export function buildForest(categories, parentId = null) {
  return categories
    .filter((c) => (c.parent_id || null) === parentId)
    .sort((a, b) => (a.name || "").localeCompare(b.name || "", "tr"))
    .map((c) => ({ ...c, children: buildForest(categories, c.id) }));
}
