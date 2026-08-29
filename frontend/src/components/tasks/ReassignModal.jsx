// Faz 9 CP5 — extracted from TasksPanel.jsx (originally lines 1128–1224).
// Görevi devret: iki mod.
//   • KİŞİYE DEVRET (eski davranış, korunur): görünür ekip üyesi seç → onSave(user_id).
//     Kişiler şirkete göre gruplanır (A→B devrederken B şirketindeki kişiyi
//     kolayca bul).
//   • ŞİRKETE DEVRET (yeni): hedef şirket seç → onTransferCompany(company_id).
//     Görev sahipsiz + kolsuz olarak o şirketin "Yarım Kalan İşler" havuzuna düşer.
import React, { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { UserPlus, X, User, Building2 } from "lucide-react";
import { toast } from "sonner";
import { teamApi, tasksApi } from "../../lib/api";

export const ReassignModal = ({ task, onClose, onSave, onTransferCompany }) => {
  const [mode, setMode] = useState("user"); // "user" | "company"
  const [members, setMembers] = useState(null); // null=loading, [] = none
  const [companies, setCompanies] = useState(null); // null=loading, [] = none
  const [saving, setSaving] = useState(false);
  const [pickedCompany, setPickedCompany] = useState("");

  useEffect(() => {
    let alive = true;
    teamApi.members()
      .then((r) => { if (alive) setMembers(r || []); })
      .catch(() => { if (alive) setMembers([]); });
    return () => { alive = false; };
  }, []);

  // Şirket listesi yalnızca "company" moduna geçilince çekilir (lazy).
  useEffect(() => {
    if (mode !== "company" || companies !== null) return;
    let alive = true;
    tasksApi.transferCompanies()
      .then((r) => { if (alive) setCompanies(r || []); })
      .catch(() => { if (alive) setCompanies([]); });
    return () => { alive = false; };
  }, [mode, companies]);

  // Kişileri şirket adına göre grupla (grupsuzlar en sona).
  const groupedMembers = useMemo(() => {
    if (!members) return [];
    const map = new Map();
    for (const m of members) {
      const key = m.company_name || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(m);
    }
    const entries = [...map.entries()];
    entries.sort((a, b) => {
      if (a[0] === "__none__") return 1;
      if (b[0] === "__none__") return -1;
      return a[0].localeCompare(b[0], "tr");
    });
    return entries;
  }, [members]);

  const pick = async (m) => {
    if (saving) return;
    setSaving(true);
    try {
      await onSave(m.id);
      toast.success(`Görev ${m.username} kullanıcısına devredildi`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Devredemedi");
    } finally {
      setSaving(false);
    }
  };

  const transferCompany = async () => {
    if (saving || !pickedCompany) return;
    setSaving(true);
    try {
      const c = (companies || []).find((x) => x.id === pickedCompany);
      await onTransferCompany(pickedCompany);
      toast.success(`Görev ${c?.name || "şirkete"} devredildi — "Yarım Kalan İşler" havuzunda`);
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Şirkete devredilemedi");
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    <div
      className="fixed inset-0 z-[10000] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={onClose}
      data-testid="reassign-modal"
    >
      <div
        className="bg-sertex-bg border border-purple-400/40 rounded-lg shadow-lg shadow-purple-500/20 w-[420px] max-w-[90vw] max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-purple-400/25">
          <div className="hud-text text-purple-300 flex items-center gap-1">
            <UserPlus className="h-3 w-3" /> GÖREVİ DEVRET
          </div>
          <button
            onClick={onClose}
            data-testid="reassign-close"
            className="p-1 border border-sertex-cyan/25 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
          >
            <X className="h-3 w-3" />
          </button>
        </div>

        {/* Mod seçici — Kişiye Devret / Şirkete Devret */}
        <div className="flex gap-1 px-3 pt-3">
          <button
            onClick={() => setMode("user")}
            data-testid="reassign-mode-user"
            className={`flex-1 py-1.5 rounded-md hud-text flex items-center justify-center gap-1 border transition-colors ${
              mode === "user"
                ? "border-purple-400 text-purple-200 bg-purple-500/15"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-purple-200"
            }`}
          >
            <User className="h-3 w-3" /> KİŞİYE DEVRET
          </button>
          <button
            onClick={() => setMode("company")}
            data-testid="reassign-mode-company"
            className={`flex-1 py-1.5 rounded-md hud-text flex items-center justify-center gap-1 border transition-colors ${
              mode === "company"
                ? "border-cyan-400 text-sertex-cyan bg-sertex-cyan/10"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan"
            }`}
          >
            <Building2 className="h-3 w-3" /> ŞİRKETE DEVRET
          </button>
        </div>

        <div className="px-4 py-2 border-b border-purple-400/15 text-xs text-sertex-textMuted font-mono truncate">
          {task.title}
        </div>

        {/* KİŞİYE DEVRET */}
        {mode === "user" && (
          <div className="flex-1 overflow-y-auto p-2" data-testid="reassign-user-body">
            {members === null && (
              <div className="text-center py-6 text-sertex-textMuted hud-text">Yükleniyor...</div>
            )}
            {members !== null && members.length === 0 && (
              <div
                className="text-center py-6 text-sertex-textMuted hud-text"
                data-testid="reassign-empty"
              >
                Devredebileceğin kimse yok.
                <br />
                <span className="text-[10px] text-sertex-textMuted/70">
                  Yönetici sana Ayarlar → Yetkiler'den atama yapmalı.
                </span>
              </div>
            )}
            {groupedMembers.map(([companyName, list]) => (
              <div key={companyName} className="mb-2">
                <div className="hud-text text-purple-300/70 text-[10px] px-2 py-1 flex items-center gap-1 border-b border-purple-400/10">
                  <Building2 className="h-3 w-3" />
                  {companyName === "__none__" ? "ŞİRKETSİZ" : companyName}
                </div>
                {list.map((m) => (
                  <button
                    key={m.id}
                    onClick={() => pick(m)}
                    disabled={saving}
                    data-testid={`reassign-pick-${m.username}`}
                    className="w-full text-left flex items-center gap-2 px-3 py-2 rounded-md hover:bg-purple-500/10 border border-transparent hover:border-purple-400/30 transition-colors disabled:opacity-40"
                  >
                    <User className="h-3.5 w-3.5 text-purple-300 shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-mono text-sertex-text truncate">
                        {m.username}
                        {m.role === "manager" && (
                          <span className="hud-text text-purple-300/70 ml-2">MÜDÜR</span>
                        )}
                      </div>
                      {m.company_name && (
                        <div className="hud-text text-sertex-textMuted/70 truncate">
                          {m.company_name}
                        </div>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ŞİRKETE DEVRET */}
        {mode === "company" && (
          <div className="flex-1 overflow-y-auto p-3 space-y-3" data-testid="reassign-company-body">
            <div className="text-[11px] font-mono text-sertex-textMuted normal-case leading-relaxed bg-sertex-cyan/5 border border-sertex-cyan/20 rounded-md p-2">
              Görev seçtiğin şirkete <span className="text-sertex-cyan">sahipsiz</span> ve
              {" "}<span className="text-sertex-cyan">iş kolusuz (kolsuz)</span> olarak
              düşer. O şirketin "Yarım Kalan İşler" havuzundan biri sahiplenir.
            </div>
            {companies === null && (
              <div className="text-center py-6 text-sertex-textMuted hud-text">Yükleniyor...</div>
            )}
            {companies !== null && companies.length === 0 && (
              <div
                className="text-center py-6 text-sertex-textMuted hud-text"
                data-testid="reassign-company-empty"
              >
                Devredebileceğin şirket yok.
              </div>
            )}
            {companies !== null && companies.length > 0 && (
              <>
                <select
                  value={pickedCompany}
                  onChange={(e) => setPickedCompany(e.target.value)}
                  data-testid="reassign-company-select"
                  className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded-md px-2 py-2 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  <option value="">Hedef şirketi seç…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
                <button
                  onClick={transferCompany}
                  disabled={saving || !pickedCompany}
                  data-testid="reassign-company-submit"
                  className="w-full py-2 rounded-md hud-text flex items-center justify-center gap-1 border border-cyan-400 text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg transition-colors disabled:opacity-40 disabled:hover:bg-transparent disabled:hover:text-sertex-cyan"
                >
                  <Building2 className="h-3.5 w-3.5" /> ŞİRKETE DEVRET
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default ReassignModal;
