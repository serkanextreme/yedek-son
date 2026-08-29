// Build a hierarchical category tree with tasks attached, plus roll-up
// (self + descendants) done/total counts — mirrors the web categoryTree.js.

import { Category, Task } from "@/src/api/types";

export type CatNode = {
  category: Category;
  tasks: Task[];
  children: CatNode[];
  rollup: { total: number; done: number };
};

export type TaskTree = {
  roots: CatNode[];
  uncategorized: Task[];
};

export function buildTaskTree(
  categories: Category[],
  tasks: Task[],
): TaskTree {
  const catById = new Map<string, Category>();
  categories.forEach((c) => catById.set(c.id, c));

  const tasksByCat = new Map<string, Task[]>();
  const uncategorized: Task[] = [];
  for (const t of tasks) {
    const cid = t.category_id;
    if (cid && catById.has(cid)) {
      const list = tasksByCat.get(cid) ?? [];
      list.push(t);
      tasksByCat.set(cid, list);
    } else {
      uncategorized.push(t);
    }
  }

  const childrenOf = new Map<string | null, Category[]>();
  for (const c of categories) {
    const parent = c.parent_id && catById.has(c.parent_id) ? c.parent_id : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(c);
    childrenOf.set(parent, list);
  }

  const build = (cat: Category): CatNode => {
    const ownTasks = tasksByCat.get(cat.id) ?? [];
    const children = (childrenOf.get(cat.id) ?? [])
      .sort((a, b) => a.name.localeCompare(b.name, "tr"))
      .map(build);

    let total = ownTasks.length;
    let done = ownTasks.filter((t) => t.status === "done").length;
    for (const ch of children) {
      total += ch.rollup.total;
      done += ch.rollup.done;
    }
    return { category: cat, tasks: ownTasks, children, rollup: { total, done } };
  };

  const roots = (childrenOf.get(null) ?? [])
    .sort((a, b) => a.name.localeCompare(b.name, "tr"))
    .map(build);

  return { roots, uncategorized };
}

// All category ids in the tree — used by the "expand/collapse all" toggle.
export function allCategoryIds(nodes: CatNode[]): string[] {
  const ids: string[] = [];
  const walk = (list: CatNode[]) => {
    for (const n of list) {
      ids.push(n.category.id);
      walk(n.children);
    }
  };
  walk(nodes);
  return ids;
}

// "Boş kol gizle" — hiç görevi olmayan (rollup.total === 0) düğümleri, alt
// ağaçlarıyla birlikte ayıklar.
export function pruneEmpty(nodes: CatNode[]): CatNode[] {
  return nodes
    .filter((n) => n.rollup.total > 0)
    .map((n) => ({ ...n, children: pruneEmpty(n.children) }));
}

// Flatten categories into a depth-indented list for a single-select picker.
export type FlatCat = { id: string; label: string; depth: number };

export function flattenCategories(categories: Category[]): FlatCat[] {
  const catById = new Map<string, Category>();
  categories.forEach((c) => catById.set(c.id, c));

  const childrenOf = new Map<string | null, Category[]>();
  for (const c of categories) {
    const parent = c.parent_id && catById.has(c.parent_id) ? c.parent_id : null;
    const list = childrenOf.get(parent) ?? [];
    list.push(c);
    childrenOf.set(parent, list);
  }

  const out: FlatCat[] = [];
  const walk = (parent: string | null, depth: number) => {
    const list = (childrenOf.get(parent) ?? []).sort((a, b) =>
      a.name.localeCompare(b.name, "tr"),
    );
    for (const c of list) {
      out.push({ id: c.id, label: c.name, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}
