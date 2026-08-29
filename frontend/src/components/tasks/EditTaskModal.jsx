// Faz 9 CP5 — extracted from TasksPanel.jsx (originally lines 1228–1472).
// Behavior is BYTE-IDENTICAL.
import React, { useState } from "react";
import { createPortal } from "react-dom";
import { motion } from "framer-motion";
import { Edit3, X, CircleCheckBig } from "lucide-react";
import { toast } from "sonner";
import { REMINDER_DAY_CHOICES } from "../../lib/taskHelpers";
import { RecurringReminderFields } from "./RecurringReminderFields";
import { TaskAttachments } from "./TaskAttachments";
import { recurringValueFromTask, resolveRecurringReminder } from "../../lib/reminderUtils";
import { getCategoryPathLabel } from "../../lib/categoryTree";

export const EditTaskModal = ({ task, onClose, onSave, isTeamView, categories = [], teamMembers = [], currentUser = null }) => {
  const [title, setTitle] = useState(task.title);
  const [description, setDescription] = useState(task.description || "");
  const [dueDate, setDueDate] = useState(
    task.due_date ? new Date(task.due_date).toISOString().slice(0, 16) : ""
  );
  const [startDate, setStartDate] = useState(
    task.start_date ? new Date(task.start_date).toISOString().slice(0, 16) : ""
  );
  const [assigneeName, setAssigneeName] = useState(task.assignee_name || "");
  const [companyName, setCompanyName] = useState(task.company_name || "");
  // Faz 9 CP4.15 — task category picker inside the edit modal (was previously
  // only reachable via right-click context menu). Grouped by company via
  // <optgroup> when categories from multiple companies are visible.
  const [categoryId, setCategoryId] = useState(task.category_id || "");
  // Faz 8 CP5 — Yaklaşan uyarı ayarı (görev bazlı override).
  const [reminderDays, setReminderDays] = useState(
    task.reminder_disabled ? "__off__" : (task.reminder_days == null ? "" : String(task.reminder_days))
  );
  // Otomatik tamamlanma tarihi — sadece görev "done" durumundayken düzenlenebilir.
  const [completedAt, setCompletedAt] = useState(
    task.completed_at ? new Date(task.completed_at).toISOString().slice(0, 16) : ""
  );
  // Tekrarlı hatırlatıcı — düzenle modalından da ayarlanabilir ("her yerde").
  // `reminderDirty`: yalnızca kullanıcı bu bölümü değiştirirse patch'e eklenir,
  // böylece başlık gibi alanları düzenlerken tetiklenmiş hatırlatma yeniden
  // kurulmaz (regresyon güvenliği).
  const [reminder, setReminder] = useState(() => recurringValueFromTask(task));
  const [reminderDirty, setReminderDirty] = useState(false);

  // Group categories by company_id so the modal can render <optgroup>s.
  // Managers with cross-company grants see multiple groups; single-company
  // users see one flat list.
  const categoriesByCompany = React.useMemo(() => {
    const map = new Map();
    for (const c of categories) {
      const key = c.company_id || "__none__";
      if (!map.has(key)) map.set(key, { companyName: null, items: [] });
      map.get(key).items.push(c);
    }
    // Resolve company names via teamMembers (best-effort — cache miss falls
    // back to a generic label so the dropdown still renders correctly).
    for (const [cid, bucket] of map) {
      const member = teamMembers.find((m) => m.company_id === cid);
      bucket.companyName = member?.company_name || null;
    }
    return Array.from(map.entries());
  }, [categories, teamMembers]);

  // Unique company names for the ŞİRKET dropdown (task ownership label).
  const companyOptions = React.useMemo(() => {
    const set = new Set();
    for (const m of teamMembers) {
      if (m.company_name) set.add(m.company_name);
    }
    // Include the task's current company name too so it doesn't vanish
    // when the caller doesn't share a team member with that company.
    if (task.company_name) set.add(task.company_name);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "tr"));
  }, [teamMembers, task.company_name]);

  // GÖREV SAHİBİ dropdown — seçilen şirkete göre filtrelenen personel isimleri.
  // Şirket seçilmezse tüm görünür isimler listelenir. Mevcut görev sahibi
  // listede yoksa dahil edilir (kaybolmasın).
  const peopleOptions = React.useMemo(() => {
    const base = companyName
      ? teamMembers.filter((m) => m.company_name === companyName)
      : teamMembers;
    const names = new Set();
    for (const m of base) {
      if (m.username) names.add(m.username);
    }
    if (assigneeName) names.add(assigneeName);
    return Array.from(names).sort((a, b) => a.localeCompare(b, "tr"));
  }, [teamMembers, companyName, assigneeName]);

  // Şirket değişince, mevcut görev sahibi yeni şirkette yoksa temizle — böylece
  // kullanıcı yeni şirketin personelinden seçer (kişiye devir değil, etiket).
  const handleCompanyChange = (val) => {
    setCompanyName(val);
    if (val && assigneeName) {
      const stillValid = teamMembers.some(
        (m) => m.company_name === val && m.username === assigneeName
      );
      if (!stillValid) setAssigneeName("");
    }
  };

  const handleSave = async () => {
    if (!title.trim()) {
      toast.error("Başlık gerekli");
      return;
    }
    // Yumuşak doğrulama — başlangıç, bitişten sonra olamaz (ikisi de opsiyonel).
    if (startDate && dueDate && new Date(startDate) > new Date(dueDate)) {
      toast.error("Başlangıç tarihi bitiş tarihinden sonra olamaz");
      return;
    }
    const patch = {
      title: title.trim(),
      description: description.trim(),
      start_date: startDate ? new Date(startDate).toISOString() : null,
      due_date: dueDate ? new Date(dueDate).toISOString() : null,
      assignee_name: assigneeName.trim() || null,
      company_name: companyName.trim() || null,
      // Faz 9 CP4.15 — allow clearing the category by setting an empty string;
      // backend `$unset` handles the empty-string case correctly.
      category_id: categoryId || "",
    };
    // Faz 8 CP5 — apply reminder override choice.
    if (reminderDays === "__off__") {
      patch.reminder_disabled = true;
      patch.reminder_days = 0;
    } else if (reminderDays === "") {
      patch.reminder_disabled = false;
      patch.reminder_days = 0;
    } else {
      patch.reminder_disabled = false;
      patch.reminder_days = parseInt(reminderDays, 10);
    }
    // Otomatik tamamlanma tarihi — yalnızca "done" görevlerde gönderilir.
    if (task.status === "done") {
      patch.completed_at = completedAt ? new Date(completedAt).toISOString() : null;
    }
    // Tekrarlı hatırlatıcı — yalnızca bölüm değiştirildiyse patch'e ekle.
    if (reminderDirty) {
      const rr = resolveRecurringReminder(reminder);
      if (rr.error) {
        toast.error(rr.error);
        return;
      }
      patch.reminder_at = rr.reminder_at;
      patch.reminder_fired = false;
      patch.reminder_interval_min = rr.reminder_interval_min;
      patch.reminder_repeat_left = rr.reminder_repeat_left;
      patch.reminder_repeat_total = rr.reminder_repeat_total;
    }
    await onSave(patch);
    onClose();
  };

  return createPortal(
    <>
      <div
        className="fixed inset-0 z-[110] bg-sertex-bg/70 backdrop-blur-sm"
        onClick={onClose}
        data-testid="edit-modal-backdrop"
      />
      <div className="fixed inset-0 z-[120] flex items-center justify-center pointer-events-none px-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="pointer-events-auto w-full max-w-[460px] max-h-[88vh] overflow-y-auto glass-panel corner-bracket p-4 space-y-3"
          data-testid="edit-task-modal"
        >
          <div className="flex items-center justify-between border-b border-sertex-cyan/20 pb-2">
            <div className="display-text text-sertex-cyan neon-glow tracking-[0.2em] flex items-center gap-2">
              <Edit3 className="h-4 w-4" /> GÖREVİ DÜZENLE
            </div>
            <button
              onClick={onClose}
              className="p-1 hover:bg-sertex-cyan/10 rounded text-sertex-textMuted hover:text-sertex-cyan"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">BAŞLIK</div>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus
              data-testid="edit-title"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
            />
          </div>
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">AÇIKLAMA</div>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              data-testid="edit-description"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none resize-none"
            />
          </div>
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">BAŞLANGIÇ TARİHİ (opsiyonel)</div>
            <input
              type="datetime-local"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              data-testid="edit-startdate"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
            {startDate && (
              <button
                onClick={() => setStartDate("")}
                className="hud-text text-sertex-textMuted hover:text-sertex-cyan mt-1"
              >
                × Tarihi temizle
              </button>
            )}
          </div>
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">SON TARİH (opsiyonel)</div>
            <input
              type="datetime-local"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              data-testid="edit-duedate"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
            {dueDate && (
              <button
                onClick={() => setDueDate("")}
                className="hud-text text-sertex-textMuted hover:text-sertex-cyan mt-1"
              >
                × Tarihi temizle
              </button>
            )}
          </div>
          {/* Otomatik tamamlanma tarihi — yalnızca görev tamamlandığında görünür.
              Yetkili kullanıcı tamamlanma zamanını geriye dönük düzeltebilir. */}
          {task.status === "done" && (
            <div>
              <div className="hud-text text-sertex-textMuted mb-1 flex items-center gap-1">
                <CircleCheckBig className="h-3 w-3" /> TAMAMLANMA TARİHİ
              </div>
              <input
                type="datetime-local"
                value={completedAt}
                onChange={(e) => setCompletedAt(e.target.value)}
                data-testid="edit-completed-at"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              />
              {completedAt && (
                <button
                  onClick={() => setCompletedAt("")}
                  className="hud-text text-sertex-textMuted hover:text-sertex-cyan mt-1"
                  data-testid="edit-completed-at-clear"
                >
                  × Tamamlanma tarihini temizle
                </button>
              )}
            </div>
          )}
          {/* Faz 8 CP5 — Yaklaşan uyarı ayarı */}
          <div>
            <div className="hud-text text-sertex-textMuted mb-1">⏱ YAKLAŞAN UYARISI</div>
            <select
              value={reminderDays}
              onChange={(e) => setReminderDays(e.target.value)}
              data-testid="edit-reminder-days"
              className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            >
              <option value="">Varsayılan (hiyerarşi)</option>
              {REMINDER_DAY_CHOICES.map((d) => (
                <option key={d} value={d}>{d} gün önce</option>
              ))}
              <option value="__off__">🚫 Bu görev için kapalı</option>
            </select>
          </div>
          {/* Tekrarlı hatırlatıcı (ilk zaman + kaç defa + aralık). */}
          <RecurringReminderFields
            value={reminder}
            onChange={(v) => {
              setReminder(v);
              setReminderDirty(true);
            }}
            testPrefix="edit-reminder"
          />
          {/* Faz 9 CP4.15 — İş Kolu picker inside edit modal. Grouped by
              company via <optgroup> so cross-company managers can see whose
              category is whose. Hidden entirely when no categories exist. */}
          {categories.length > 0 && (
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">🏷️ İŞ KOLU</div>
              <select
                value={categoryId}
                onChange={(e) => setCategoryId(e.target.value)}
                data-testid="edit-category"
                className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
              >
                <option value="">— İş kolu yok —</option>
                {categoriesByCompany.length > 1
                  ? categoriesByCompany.map(([cid, bucket]) => (
                      <optgroup key={cid} label={bucket.companyName || "Şirket"}>
                        {bucket.items.map((c) => (
                          <option key={c.id} value={c.id}>{getCategoryPathLabel(c.id, categories)}</option>
                        ))}
                      </optgroup>
                    ))
                  : categories.map((c) => (
                      <option key={c.id} value={c.id}>{getCategoryPathLabel(c.id, categories)}</option>
                    ))}
              </select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2" style={{ display: isTeamView ? undefined : "none" }}>
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">GÖREV SAHİBİ</div>
              {/* Şirkete bağlı personel açılır listesi. Görünür üye varsa
                  dropdown; yoksa (kişisel çalışma alanı) free-text — bozmadan. */}
              {teamMembers.length > 0 ? (
                <select
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                  data-testid="edit-assignee"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  <option value="">— Görev sahibi yok —</option>
                  {peopleOptions.map((n) => (
                    <option key={n} value={n}>{n}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={assigneeName}
                  onChange={(e) => setAssigneeName(e.target.value)}
                  placeholder="Örn: Ahmet"
                  data-testid="edit-assignee"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                />
              )}
            </div>
            <div>
              <div className="hud-text text-sertex-textMuted mb-1">ŞİRKET</div>
              {/* Faz 9 CP4.15 — real dropdown when we know the visible
                  company set (avoids typos when the caller sees multiple
                  companies). Falls back to a free-text input if nothing
                  is available (e.g. personal workspace). */}
              {companyOptions.length > 0 ? (
                <select
                  value={companyName}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  data-testid="edit-company"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
                >
                  <option value="">— Şirket yok —</option>
                  {companyOptions.map((c) => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              ) : (
                <input
                  value={companyName}
                  onChange={(e) => handleCompanyChange(e.target.value)}
                  placeholder="Örn: Acme Ltd."
                  data-testid="edit-company"
                  className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                />
              )}
            </div>
          </div>
          {/* 📎 Görev dosyaları — Düzenle penceresinden de yükle/indir/sil */}
          <div className="border-t border-sertex-cyan/15 pt-1">
            <TaskAttachments
              taskId={task.id}
              currentUserId={currentUser?.id}
              canManage={isTeamView}
            />
          </div>
          <div className="flex gap-2 pt-2 border-t border-sertex-cyan/15">
            <button
              onClick={onClose}
              className="flex-1 py-2 border border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 rounded-md hud-text transition-colors"
            >
              İPTAL
            </button>
            <button
              onClick={handleSave}
              data-testid="edit-save"
              className="flex-1 py-2 bg-sertex-cyan/20 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text transition-colors"
            >
              KAYDET
            </button>
          </div>
        </motion.div>
      </div>
    </>,
    document.body
  );
};

export default EditTaskModal;
