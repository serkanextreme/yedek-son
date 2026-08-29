// Görev Paylaşımı — çok kişili atama seçici (ÖZELLİK A).
// Aranabilir + kaydırmalı liste (pencere içinde). Oluşturan kişi (Kendim) de
// listenin başında seçilebilir, böylece "kendim + personelim" birlikte atanır.
// Seçim mantığı (parent addTask'ta): 0 veya sadece kendim = kişisel görev;
// yalnız 1 başka kişi = tekil devir; 2+ (kendim dahil) = çok kişili görev.
import React, { useState, useMemo } from "react";
import { User, X, Check, ChevronDown, Search, Users } from "lucide-react";

export const MultiAssigneeSelect = ({ members = [], selfUser, selectedIds = [], onChange, companyFilter = "" }) => {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Options: self first (backend /team/members excludes self), then members.
  const options = useMemo(() => {
    const list = [];
    if (selfUser?.id) {
      list.push({ id: selfUser.id, username: selfUser.username || "Ben", isSelf: true });
    }
    for (const m of members) {
      if (m.id === selfUser?.id) continue;
      list.push({ id: m.id, username: m.username, company_name: m.company_name });
    }
    return list;
  }, [members, selfUser]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    // Arama aktifken TÜM kişilerde ara (şirket filtresini yok say) — böylece
    // şirketsiz veya farklı şirketteki kullanıcılar da arama ile bulunur.
    if (q) {
      return options.filter((o) => (o.username || "").toLowerCase().includes(q));
    }
    // Şirket seçiliyse (Düzenle'deki gibi) sadece o şirketin üyeleri + Kendim.
    const cf = (companyFilter || "").trim().toLocaleLowerCase("tr");
    if (cf) {
      return options.filter(
        (o) => o.isSelf || (o.company_name || "").toLocaleLowerCase("tr") === cf,
      );
    }
    return options;
  }, [options, query, companyFilter]);

  const selectedOptions = options.filter((o) => selectedIds.includes(o.id));

  const toggle = (id) =>
    onChange(selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id]);
  const remove = (id) => onChange(selectedIds.filter((x) => x !== id));

  return (
    <div data-testid="task-multi-assignee" className="space-y-1">
      {/* Trigger / summary */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="assignee-picker-toggle"
        className="w-full flex items-center justify-between gap-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text hover:border-sertex-cyan/50 transition-colors"
      >
        <span className="flex items-center gap-1.5 truncate">
          <Users className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
          {selectedOptions.length === 0
            ? "🧍 Kendime ata · kişi eklemek için tıkla"
            : `${selectedOptions.length} kişi seçili`}
        </span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {/* Selected chips (scrollable so many people don't overflow) */}
      {selectedOptions.length > 0 && (
        <div
          className="flex flex-wrap gap-1 max-h-20 overflow-y-auto p-1 rounded border border-sertex-cyan/15 bg-sertex-surface/30"
          data-testid="assignee-selected-chips"
        >
          {selectedOptions.map((o) => (
            <span
              key={o.id}
              data-testid={`assignee-chip-${o.id}`}
              className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-sertex-cyan/40 bg-sertex-cyan/10 text-sertex-cyan text-xs font-mono"
            >
              {o.isSelf ? "🧍" : "👤"} {o.isSelf ? "Kendim" : o.username}
              <button
                type="button"
                onClick={() => remove(o.id)}
                data-testid={`assignee-chip-remove-${o.id}`}
                className="hover:text-rose-300"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Dropdown window: search + scrollable option list */}
      {open && (
        <div
          className="rounded-md border border-sertex-cyan/30 bg-sertex-bg overflow-hidden"
          data-testid="assignee-picker-panel"
        >
          <div className="flex items-center gap-2 px-2 border-b border-sertex-cyan/15">
            <Search className="h-3.5 w-3.5 text-sertex-textMuted shrink-0" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Kişi ara..."
              data-testid="assignee-search"
              className="w-full bg-transparent py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted outline-none"
            />
          </div>
          <div className="max-h-48 overflow-y-auto" data-testid="assignee-option-list">
            {filtered.map((o) => {
              const on = selectedIds.includes(o.id);
              return (
                <button
                  type="button"
                  key={o.id}
                  onClick={() => toggle(o.id)}
                  data-testid={`assignee-option-${o.id}`}
                  className={`w-full text-left flex items-center gap-2 px-2.5 py-1.5 transition-colors ${
                    on ? "bg-sertex-cyan/10" : "hover:bg-sertex-cyan/5"
                  }`}
                >
                  <span
                    className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                      on ? "border-sertex-cyan bg-sertex-cyan/40" : "border-sertex-cyan/40"
                    }`}
                  >
                    {on && <Check className="h-2.5 w-2.5 text-white" />}
                  </span>
                  {o.isSelf ? (
                    <User className="h-3.5 w-3.5 text-sertex-cyan shrink-0" />
                  ) : (
                    <span className="text-xs shrink-0">👤</span>
                  )}
                  <span className="text-sm font-mono text-sertex-text truncate flex-1">
                    {o.isSelf ? "Kendim (ben de dahilim)" : o.username}
                  </span>
                  {!o.isSelf && o.company_name && (
                    <span className="hud-text text-sertex-textMuted/70 truncate">{o.company_name}</span>
                  )}
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-3 hud-text text-sertex-textMuted text-center">Sonuç yok</div>
            )}
          </div>
        </div>
      )}

      {selectedOptions.length >= 2 && (
        <div className="hud-text text-sertex-textMuted/70">
          Çok kişili görev · herkes tamamlayınca "bitti" sayılır
        </div>
      )}
    </div>
  );
};

export default MultiAssigneeSelect;
