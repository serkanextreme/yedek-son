import React, { useEffect, useState } from "react";
import { Trash2, ShieldQuestion, Clock, Save } from "lucide-react";
import { toast } from "sonner";
import { tasksApi } from "../lib/api";

// Arşiv Politikası + Otomatik Çöp Temizliği ayarları.
// Görünürlük: admin veya "Arşiv Politikası Düzenle" yetkisi (manage_policy).
const POLICY_OPTS = [
  { key: "optional", label: "Serbest", desc: "İsteyen neden girer, boş bırakılabilir (varsayılan)" },
  { key: "required", label: "Zorunlu", desc: "Neden girilmeden görev iptal/silme yapılamaz" },
  { key: "off", label: "Kapalı", desc: "İptal/silme sırasında neden hiç sorulmaz" },
];

const DAY_OPTS = [7, 15, 30, 60, 90];

const TaskPolicySettings = () => {
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [customDay, setCustomDay] = useState("");

  const load = () => tasksApi.getSettings().then(setSettings).catch(() => toast.error("Ayarlar yüklenemedi"));
  useEffect(() => { load(); }, []);

  if (!settings) {
    return <div className="text-center text-sertex-textMuted text-xs py-6 hud-text animate-pulse">YÜKLENİYOR...</div>;
  }

  const canManage = !!settings.caps?.manage_policy;

  const save = async (patch) => {
    setSaving(true);
    try {
      const next = await tasksApi.putSettings(patch);
      setSettings(next);
      toast.success("Ayar kaydedildi");
    } catch (e) {
      toast.error(e?.response?.status === 403 ? "Bu ayarı değiştirme yetkiniz yok" : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5" data-testid="archive-policy-tab">
      {!canManage && (
        <div className="text-[11px] font-mono text-amber-300/90 border border-amber-400/30 rounded px-2 py-1.5 bg-amber-500/5 normal-case">
          Bu ayarları yalnızca görüntüleyebilirsiniz. Değiştirmek için Arşiv Politikası Düzenle yetkisi gerekir (admin verir).
        </div>
      )}

      {/* Neden notu politikası */}
      <div>
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <ShieldQuestion className="h-3.5 w-3.5" /> İPTAL / SİLME NEDEN NOTU
        </div>
        <div className="space-y-1.5">
          {POLICY_OPTS.map((p) => {
            const active = settings.delete_reason_policy === p.key;
            return (
              <button
                key={p.key}
                disabled={!canManage || saving}
                onClick={() => save({ delete_reason_policy: p.key })}
                data-testid={`policy-${p.key}`}
                className={`w-full text-left p-2.5 rounded-md border transition-colors disabled:opacity-60 ${
                  active ? "border-sertex-cyan bg-sertex-cyan/10" : "border-sertex-cyan/25 hover:border-sertex-cyan/50"
                }`}
              >
                <div className="hud-text text-sertex-text flex items-center gap-2">
                  {p.label}
                  {active && <span className="ml-auto text-[10px] font-mono text-sertex-cyan">✓ AKTİF</span>}
                </div>
                <div className="text-[11px] font-mono text-sertex-textMuted normal-case mt-0.5">{p.desc}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Otomatik çöp temizliği */}
      <div className="pt-4 border-t border-sertex-cyan/15">
        <div className="hud-text text-rose-300 mb-2 flex items-center gap-1.5">
          <Trash2 className="h-3.5 w-3.5" /> OTOMATİK ÇÖP TEMİZLİĞİ
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case mb-2">
          Çöp kutusundaki (SİLİNMİŞ) görevler, belirlenen gün sonra otomatik ve kalıcı silinir. Kapalıyken hiçbir şey silinmez.
        </div>
        <div className="flex items-center justify-between glass-panel p-3 border-rose-400/20">
          <div className="hud-text text-sertex-text">OTOMATİK TEMİZLİK</div>
          <button
            disabled={!canManage || saving}
            onClick={() => save({ trash_autoclean_enabled: !settings.trash_autoclean_enabled })}
            data-testid="autoclean-toggle"
            className={`relative w-12 h-6 rounded-full transition-colors border disabled:opacity-60 ${
              settings.trash_autoclean_enabled ? "bg-rose-500/30 border-rose-400" : "bg-sertex-surface border-sertex-textMuted/40"
            }`}
          >
            <span className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
              settings.trash_autoclean_enabled ? "left-6 bg-rose-400 shadow-[0_0_8px_rgba(255,60,90,0.8)]" : "left-0.5 bg-sertex-textMuted"
            }`} />
          </button>
        </div>

        {settings.trash_autoclean_enabled && (
          <div className="mt-3 space-y-2" data-testid="autoclean-days">
            <div className="hud-text text-sertex-textMuted flex items-center gap-1.5">
              <Clock className="h-3 w-3" /> SAKLAMA SÜRESİ:{" "}
              <span className="text-rose-300">{settings.trash_autoclean_days} gün</span>
            </div>
            <div className="flex flex-wrap gap-1.5 items-center">
              {DAY_OPTS.map((d) => (
                <button
                  key={d}
                  disabled={!canManage || saving}
                  onClick={() => save({ trash_autoclean_days: d })}
                  data-testid={`autoclean-day-${d}`}
                  className={`px-2.5 py-1 rounded-md border hud-text transition-colors disabled:opacity-60 ${
                    settings.trash_autoclean_days === d
                      ? "border-rose-400 text-rose-300 bg-rose-400/15"
                      : "border-sertex-cyan/25 text-sertex-textMuted hover:text-rose-300 hover:border-rose-400/60"
                  }`}
                >
                  {d} gün
                </button>
              ))}
              <input
                type="number"
                min={1}
                max={3650}
                value={customDay}
                onChange={(e) => setCustomDay(e.target.value)}
                placeholder="Özel"
                data-testid="autoclean-day-custom"
                disabled={!canManage || saving}
                className="w-20 bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-rose-400 outline-none disabled:opacity-60"
              />
              <button
                disabled={!canManage || saving || !customDay}
                onClick={() => {
                  const d = parseInt(customDay, 10);
                  if (!d || d < 1 || d > 3650) { toast.error("1-3650 arası bir gün girin"); return; }
                  save({ trash_autoclean_days: d });
                  setCustomDay("");
                }}
                data-testid="autoclean-day-apply"
                className="px-2 py-1 rounded-md border border-rose-400/50 text-rose-300 hover:bg-rose-400/10 hud-text flex items-center gap-1 disabled:opacity-40"
              >
                <Save className="h-3 w-3" /> UYGULA
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TaskPolicySettings;
