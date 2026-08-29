// Personel Görevleri — kişi filtresi (tek seçim). Çipler yerine aranabilir +
// kaydırmalı açılır liste (pencere içinde), böylece çok personelde yer taşmaz.
import React, { useState, useMemo } from "react";
import { ChevronDown, Search, AlertTriangle, Check, Users } from "lucide-react";

export const PersonFilterSelect = ({ owners = [], value = "", onChange, totalCount = 0 }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  const selected = owners.find((o) => o.id === value) || null;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return owners;
    return owners.filter((o) => (o.name || "").toLowerCase().includes(q));
  }, [owners, query]);

  const pick = (id) => {
    onChange(id);
    setOpen(false);
    setQuery("");
  };

  return (
    <div data-testid="task-person-filter">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="person-filter-toggle"
        className="w-full flex items-center justify-between gap-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2.5 py-1.5 text-sm font-mono text-sertex-text hover:border-sertex-cyan/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Users className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
          {selected ? (
            <>
              👤 {selected.name}
              {selected.overdue > 0 && (
                <span className="inline-flex items-center gap-0.5 px-1 rounded-full bg-rose-500/25 text-rose-200 border border-rose-400/40 text-[10px] leading-none">
                  <AlertTriangle className="h-2.5 w-2.5" />
                  {selected.overdue}
                </span>
              )}
              <span className="opacity-60">({selected.count})</span>
            </>
          ) : value === "__none__" ? (
            <span className="text-sertex-textMuted">Seçim yok — görev gösterilmiyor</span>
          ) : (
            `Tümü (${totalCount})`
          )}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="mt-1 rounded-md border border-sertex-cyan/30 bg-sertex-bg overflow-hidden"
          data-testid="person-filter-panel"
        >
          <div className="flex items-center gap-2 px-2 border-b border-sertex-cyan/15">
            <Search className="h-3.5 w-3.5 text-sertex-textMuted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Personel ara..."
              data-testid="person-filter-search"
              className="w-full bg-transparent py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted outline-none"
            />
          </div>
          <div className="max-h-56 overflow-y-auto" data-testid="person-filter-list">
            <button
              type="button"
              onClick={() => pick(value === "" ? "__none__" : "")}
              data-testid="person-chip-all"
              className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors ${
                value === "" ? "bg-sertex-cyan/10 text-sertex-cyan" : "text-sertex-text hover:bg-sertex-cyan/5"
              }`}
            >
              <span className="h-4 w-4 rounded border border-sertex-cyan/40 flex items-center justify-center shrink-0">
                {value === "" && <Check className="h-2.5 w-2.5 text-sertex-cyan" />}
              </span>
              <span className="flex-1 text-sm font-mono">Tümü</span>
              <span className="opacity-60 text-xs">({totalCount})</span>
            </button>
            {filtered.map((o) => {
              const on = value === o.id;
              return (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => pick(o.id)}
                  data-testid={`person-chip-${o.id}`}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors ${
                    on ? "bg-sertex-cyan/10 text-sertex-cyan" : "text-sertex-text hover:bg-sertex-cyan/5"
                  }`}
                >
                  <span className="h-4 w-4 rounded border border-sertex-cyan/40 flex items-center justify-center shrink-0">
                    {on && <Check className="h-2.5 w-2.5 text-sertex-cyan" />}
                  </span>
                  <span className="text-xs shrink-0">👤</span>
                  <span className="flex-1 text-sm font-mono truncate">{o.name}</span>
                  {o.overdue > 0 && (
                    <span
                      data-testid={`person-overdue-${o.id}`}
                      className="inline-flex items-center gap-0.5 px-1 rounded-full bg-rose-500/25 text-rose-200 border border-rose-400/40 text-[10px] leading-none shrink-0"
                    >
                      <AlertTriangle className="h-2.5 w-2.5" />
                      {o.overdue}
                    </span>
                  )}
                  <span className="opacity-60 text-xs shrink-0">({o.count})</span>
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

export default PersonFilterSelect;
