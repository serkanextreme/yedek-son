// Faz 9 CP8.5 — Custom dark-themed combobox for the "Şirket" input on the
// new-task form. Replaces the native <datalist> which rendered a white
// popup that clashed with Sertex's dark HUD theme. Preserves:
//   • Free-text typing (users can still type company names that are not in
//     the visible-team set).
//   • data-testid="task-company-input" on the actual <input>.
//   • Auto-fill flag (onManualEdit) so the parent can flip
//     `companyAutoFilled` to false when the user types by hand.
//   • Placeholder + styling exactly matching the surrounding form fields.
//
// Behavior:
//   • Focus / click on the input opens the dropdown.
//   • As the user types, options filter case-insensitively (Turkish locale).
//   • Click on an option fills the input, closes the dropdown, marks the
//     value as auto-filled (so a subsequent assignee change may overwrite it).
//   • Click outside the wrapper closes the dropdown.
//   • Escape closes the dropdown but keeps focus.
//   • ArrowDown / ArrowUp navigate options, Enter selects the highlighted one.
//   • If no options match the current input we show a "yeni şirket olarak
//     kaydedilecek" hint row so the user knows free-text still works.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Building2 } from "lucide-react";

export const CompanyCombobox = ({
  value,
  onChange,
  onManualEdit,
  options,
  placeholder = "Şirket (opsiyonel)",
  testId = "task-company-input",
}) => {
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  // Faz 9 CP8.5 fix — suppress the next onFocus-triggered open after a
  // programmatic focus() from commitOption(). Without this, clicking an
  // option would re-open the dropdown immediately because focus() re-fires
  // the input's onFocus handler.
  const suppressOpenOnFocus = useRef(false);

  // Unique + sorted options (parent already dedups but be defensive).
  const uniqueOptions = useMemo(() => {
    const set = new Set();
    for (const o of options || []) {
      if (o && typeof o === "string") set.add(o);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [options]);

  // Filter as user types. If the input is empty we show the full list.
  const filtered = useMemo(() => {
    const q = (value || "").trim().toLocaleLowerCase("tr");
    if (!q) return uniqueOptions;
    return uniqueOptions.filter((o) => o.toLocaleLowerCase("tr").includes(q));
  }, [uniqueOptions, value]);

  // Close on outside click.
  useEffect(() => {
    if (!open) return;
    const onDocClick = (e) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [open]);

  // Reset highlight when filter results change or the dropdown re-opens.
  useEffect(() => {
    setHighlight(filtered.length > 0 ? 0 : -1);
  }, [filtered, open]);

  const commitOption = (opt) => {
    onChange(opt);
    // Faz 9 CP8.5 — Explicitly picking a company from the dropdown is a
    // MANUAL selection (same semantics as typing). This prevents a later
    // assignee change from silently overwriting the user's choice. Matches
    // the legacy <datalist> behavior where any onChange marked the value
    // as manual.
    onManualEdit?.(true);
    setOpen(false);
    // Return focus to the input so keyboard flow keeps working, but
    // suppress the onFocus-triggered re-open (see suppressOpenOnFocus).
    suppressOpenOnFocus.current = true;
    inputRef.current?.focus();
  };

  const onKeyDown = (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setHighlight((h) => Math.min(h + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      if (open && highlight >= 0 && filtered[highlight]) {
        e.preventDefault();
        commitOption(filtered[highlight]);
      }
    } else if (e.key === "Escape") {
      if (open) {
        e.preventDefault();
        setOpen(false);
      }
    }
  };

  const hasExactMatch = uniqueOptions.some(
    (o) => o.toLocaleLowerCase("tr") === (value || "").trim().toLocaleLowerCase("tr"),
  );

  return (
    <div ref={wrapRef} className="relative" data-testid="task-company-combobox">
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            onManualEdit?.(true);
            if (!open) setOpen(true);
          }}
          onFocus={() => {
            if (suppressOpenOnFocus.current) {
              suppressOpenOnFocus.current = false;
              return;
            }
            setOpen(true);
          }}
          onClick={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          data-testid={testId}
          autoComplete="off"
          className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md pl-2 pr-7 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
        />
        <button
          type="button"
          tabIndex={-1}
          onClick={() => {
            setOpen((v) => !v);
            inputRef.current?.focus();
          }}
          className="absolute right-1.5 top-1/2 -translate-y-1/2 p-0.5 text-sertex-cyan/70 hover:text-sertex-cyan"
          data-testid="task-company-combobox-toggle"
          aria-label="Şirket listesini aç"
        >
          <ChevronDown
            className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      </div>
      {open && (
        <div
          className="absolute z-30 left-0 right-0 mt-1 max-h-56 overflow-auto rounded-md border border-sertex-cyan/40 bg-sertex-surface/95 backdrop-blur-sm shadow-lg shadow-sertex-cyan/10"
          data-testid="task-company-combobox-list"
          role="listbox"
        >
          {filtered.length === 0 ? (
            <div className="px-2 py-2 hud-text text-sertex-textMuted">
              {value?.trim()
                ? `“${value.trim()}” yeni şirket olarak kaydedilecek`
                : "Kayıtlı şirket yok"}
            </div>
          ) : (
            <>
              {filtered.map((opt, i) => (
                <button
                  type="button"
                  key={opt}
                  role="option"
                  aria-selected={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => commitOption(opt)}
                  data-testid={`task-company-option-${opt}`}
                  className={`w-full flex items-center gap-2 px-2 py-1.5 text-left text-sm font-mono transition-colors ${
                    i === highlight
                      ? "bg-sertex-cyan/15 text-sertex-cyan"
                      : "text-sertex-text hover:bg-sertex-cyan/10 hover:text-sertex-cyan"
                  }`}
                >
                  <Building2 className="h-3 w-3 opacity-70" />
                  <span className="truncate">{opt}</span>
                </button>
              ))}
              {/* Show a "free-text" hint at the bottom when what the user
                  typed isn't an exact match — reassures them that they can
                  still submit a brand-new company name. */}
              {value?.trim() && !hasExactMatch && (
                <div className="px-2 py-1.5 hud-text text-sertex-textMuted border-t border-sertex-cyan/15">
                  Enter → “{value.trim()}” yeni şirket olarak kaydedilecek
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default CompanyCombobox;
