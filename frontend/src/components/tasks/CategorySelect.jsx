// İş Kolu (kategori) seçimi — koyu temalı, aranabilir, kaydırmalı combobox.
// PersonFilterSelect deseniyle aynı; add-task formundaki eski <select> yerine.
import React, { useState, useMemo } from "react";
import { ChevronDown, Search, Check, Tag } from "lucide-react";
import { flattenTree, getCategoryPathLabel } from "../../lib/categoryTree";

export const CategorySelect = ({ categories = [], value = "", onChange, testId = "task-category-select" }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = categories.find((c) => c.id === value) || null;

  // Hiyerarşik DFS sırası; her düğümde __depth (girinti için).
  const flat = useMemo(() => flattenTree(categories), [categories]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return flat;
    return flat.filter((c) => getCategoryPathLabel(c.id, categories).toLowerCase().includes(q));
  }, [flat, categories, query]);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div data-testid={`${testId}-wrap`}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid={testId}
        className="w-full flex items-center justify-between gap-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2.5 py-1.5 text-sm font-mono text-sertex-text hover:border-sertex-cyan/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Tag className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
          {selected ? (
            <span className="flex items-center gap-1.5 truncate">
              {selected.color && (
                <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: selected.color }} />
              )}
              {getCategoryPathLabel(selected.id, categories)}
            </span>
          ) : (
            <span className="text-sertex-textMuted">İş Kolu Seç (opsiyonel)</span>
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="mt-1 rounded-md border border-sertex-cyan/30 bg-sertex-bg overflow-hidden"
          data-testid={`${testId}-panel`}
        >
          <div className="flex items-center gap-2 px-2 border-b border-sertex-cyan/15">
            <Search className="h-3.5 w-3.5 text-sertex-textMuted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="İş kolu ara..."
              data-testid={`${testId}-search`}
              className="w-full bg-transparent py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto" data-testid={`${testId}-list`}>
            <button
              type="button"
              onClick={() => pick("")}
              data-testid={`${testId}-option-none`}
              className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors ${
                value === "" ? "bg-sertex-cyan/10 text-sertex-cyan" : "text-sertex-text hover:bg-sertex-cyan/5"
              }`}
            >
              <span className="h-4 w-4 rounded border border-sertex-cyan/40 flex items-center justify-center shrink-0">
                {value === "" && <Check className="h-2.5 w-2.5 text-sertex-cyan" />}
              </span>
              <span className="flex-1 text-sm font-mono text-sertex-textMuted">Kolsuz (opsiyonel)</span>
            </button>
            {filtered.map((c) => {
              const on = value === c.id;
              return (
                <button
                  type="button"
                  key={c.id}
                  onClick={() => pick(c.id)}
                  data-testid={`${testId}-option-${c.id}`}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors ${
                    on ? "bg-sertex-cyan/10 text-sertex-cyan" : "text-sertex-text hover:bg-sertex-cyan/5"
                  }`}
                >
                  <span className="h-4 w-4 rounded border border-sertex-cyan/40 flex items-center justify-center shrink-0">
                    {on && <Check className="h-2.5 w-2.5 text-sertex-cyan" />}
                  </span>
                  {c.color ? (
                    <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: c.color }} />
                  ) : (
                    <Tag className="h-3 w-3 text-sertex-textMuted shrink-0" />
                  )}
                  <span
                    className="flex-1 text-sm font-mono truncate"
                    style={{ paddingLeft: query.trim() ? 0 : (c.__depth || 0) * 14 }}
                  >
                    {query.trim() ? getCategoryPathLabel(c.id, categories) : c.name}
                  </span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-3 hud-text text-sertex-textMuted text-center">Sonuç yok</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default CategorySelect;
