import React from "react";
import {
  ArrowLeftRight,
  Bookmark,
  Eye,
  EyeOff,
  Pencil,
  RotateCcw,
  Save,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { t } from "../../lib/i18n";
import { useAuth } from "../../lib/auth";
import NotificationBell from "../NotificationBell";
import { NotificationPermBadge } from "./NotificationPermBadge";

const DOCK_LABEL = { right: "SAĞ", left: "SOL", top: "ÜST", bottom: "ALT" };

/**
 * NEURAL LINK header row (title + live stats + action buttons) plus the
 * Layout Presets row underneath. Stats are clickable — clicking a counter
 * switches the sidebar's active tab (e.g. GÖREVLER → tasks tab).
 */
const NeuralLinkHeader = ({
  lang,
  stats,
  dock,
  allHidden,
  presets,
  activePreset,
  isAdmin = false,
  onResetAllPanels,
  onToggleAllPanels,
  onCycleDock,
  onSavePreset,
  onLoadPreset,
  onDeletePreset,
  onStatClick,
  onEditSystemQuota,
}) => {
  const statClick = (key) => (e) => {
    e.stopPropagation();
    onStatClick?.(key);
  };
  const { dualMode, workspaceMode, setWorkspaceMode } = useAuth();
  const [switchingMode, setSwitchingMode] = React.useState(false);
  const toggleActiveMode = async () => {
    if (switchingMode) return;
    setSwitchingMode(true);
    const next = workspaceMode === "team" ? "personal" : "team";
    try {
      await setWorkspaceMode(next);
      toast.success(next === "team" ? "Ekip moduna geçildi" : "Kişisel moda geçildi");
    } catch (e) {
      toast.error("Mod değiştirilemedi");
    } finally {
      setSwitchingMode(false);
    }
  };
  return (
    <>
      <div className="p-4 border-b border-sertex-cyan/20 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="display-text text-sertex-cyan neon-glow text-lg mb-1 tracking-[0.2em]">
            NEURAL LINK
          </div>
          {dualMode && (
            <button
              type="button"
              onClick={toggleActiveMode}
              disabled={switchingMode}
              data-testid="quick-mode-switch"
              title="Kişisel ⇄ Ekip modunu değiştir"
              className={`mb-1.5 inline-flex items-center gap-1 px-2 py-0.5 rounded-full border hud-text transition-colors disabled:opacity-50 ${
                workspaceMode === "team"
                  ? "border-purple-400/50 text-purple-300 bg-purple-500/10 hover:bg-purple-500/20"
                  : "border-sertex-cyan/50 text-sertex-cyan bg-sertex-cyan/10 hover:bg-sertex-cyan/20"
              }`}
            >
              <ArrowLeftRight className="h-3 w-3" />
              {workspaceMode === "team" ? "EKİP" : "KİŞİSEL"}
            </button>
          )}
          {stats ? (
            <div
              className="hud-text text-sertex-textMuted flex flex-wrap gap-x-2 gap-y-0.5"
              data-testid="neural-link-stats"
              title={
                stats.is_admin_scope
                  ? "Depolama boyutu tüm sistem (yönetici görünümü)"
                  : "Depolama boyutu sadece sizin verileriniz"
              }
            >
              <button
                type="button"
                onClick={statClick("history")}
                title="Geçmiş sekmesine geç"
                className="hover:text-sertex-cyan focus:text-sertex-cyan outline-none transition-colors cursor-pointer"
                data-testid="stat-conversations"
              >
                GEÇMİŞ: <span className="text-sertex-cyan">{stats.conversations}</span>
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={statClick("tasks")}
                title="Görevler sekmesine geç"
                className="hover:text-sertex-cyan focus:text-sertex-cyan outline-none transition-colors cursor-pointer"
                data-testid="stat-tasks"
              >
                GÖREVLER: <span className="text-sertex-cyan">{stats.tasks_active}/{stats.tasks_total}</span>
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={statClick("memory")}
                title="Hafıza sekmesine geç"
                className="hover:text-sertex-cyan focus:text-sertex-cyan outline-none transition-colors cursor-pointer"
                data-testid="stat-memories"
              >
                HAFIZA: <span className="text-sertex-cyan">{stats.memories}</span>
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={statClick("files")}
                title="Dosyalar sekmesine geç"
                className="hover:text-sertex-cyan focus:text-sertex-cyan outline-none transition-colors cursor-pointer"
                data-testid="stat-files"
              >
                DOSYALAR: <span className="text-sertex-cyan">{stats.files}</span>
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={statClick("notes")}
                title="Notlar sekmesine geç"
                className="hover:text-sertex-cyan focus:text-sertex-cyan outline-none transition-colors cursor-pointer"
                data-testid="stat-notes"
              >
                NOTLAR: <span className="text-sertex-cyan">{stats.notes}</span>
              </button>
              <span>·</span>
              <button
                type="button"
                onClick={statClick("email")}
                title="E-posta sekmesine geç"
                className="hover:text-sertex-cyan focus:text-sertex-cyan outline-none transition-colors cursor-pointer"
                data-testid="stat-email"
              >
                E-POSTA: <span className="text-sertex-cyan">{stats.email_accounts}</span>
              </button>
              <span>·</span>
              <span data-testid="stat-db-size">
                <span className="text-sertex-cyan">{Number(stats.db_mb || 0).toFixed(2)} MB</span>
                {stats.is_admin_scope && (
                  <span className="ml-1 text-[9px] text-amber-300/80">(sistem)</span>
                )}
              </span>
            </div>
          ) : (
            <div className="hud-text text-sertex-textMuted">
              {t(lang, "history")} · Görevler · Hafıza · Dosyalar · {t(lang, "notes")}
            </div>
          )}
          {/* --- Storage Quota Progress Bar (users AND admin) ----------
             * User: quota comes from their active license (immutable).
             * Admin: quota comes from db.system_settings.global and is
             * editable via the pencil icon → prompts for GB and PUTs to
             * /api/admin/system-quota. Bar reshapes on next poll. */}
          {stats && stats.quota_mb ? (() => {
            const pct = Math.max(0, Math.min(100, Number(stats.quota_percent || 0)));
            const isDanger = pct >= 90;
            const isWarn = !isDanger && pct >= 75;
            const barColor = isDanger
              ? "bg-sertex-danger"
              : isWarn
              ? "bg-amber-400"
              : "bg-sertex-cyan";
            const textColor = isDanger
              ? "text-sertex-danger"
              : isWarn
              ? "text-amber-300"
              : "text-sertex-cyan";
            const label = stats.license_label || (stats.is_admin_scope ? "Sistem" : "Ücretsiz");
            // Display in GB when quota is >= 1 GB to keep the label short,
            // otherwise stay in MB. Both scopes use the same rule so admin's
            // "10240 MB" reads as "10 GB", which matches the input the admin
            // would type.
            const useGb = stats.quota_mb >= 1024;
            const denom = useGb ? (stats.quota_mb / 1024) : stats.quota_mb;
            const numer = useGb ? (stats.db_mb / 1024) : stats.db_mb;
            const unit = useGb ? "GB" : "MB";
            const denomStr = Number.isInteger(denom) ? String(denom) : denom.toFixed(2);
            return (
              <div
                className="mt-1.5"
                data-testid="storage-quota"
                title={
                  stats.is_admin_scope
                    ? `Sistem kapasitesi: ${stats.db_mb.toFixed(2)} MB / ${stats.quota_mb} MB kullanıldı — kalemi tıklayarak elle ayarla`
                    : `Lisans planı: ${label} — ${stats.db_mb.toFixed(2)} MB / ${stats.quota_mb} MB kullanıldı`
                }
              >
                <div className="flex items-center justify-between hud-text mb-0.5 gap-2">
                  <span className="text-sertex-textMuted truncate">
                    DEPO · <span className="text-sertex-textSecondary">{label}</span>
                  </span>
                  <span className="flex items-center gap-1 shrink-0">
                    <span className={textColor} data-testid="storage-quota-pct">
                      {numer.toFixed(2)}/{denomStr} {unit} · {pct.toFixed(1)}%
                    </span>
                    {stats.is_admin_scope && onEditSystemQuota && (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onEditSystemQuota(); }}
                        title="Sistem kapasitesini elle ayarla"
                        data-testid="storage-quota-edit"
                        className="p-0.5 border border-sertex-cyan/30 rounded text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
                      >
                        <Pencil className="h-2.5 w-2.5" />
                      </button>
                    )}
                  </span>
                </div>
                <div className="h-1.5 rounded-sm bg-sertex-cyan/10 overflow-hidden border border-sertex-cyan/20">
                  <div
                    data-testid="storage-quota-bar"
                    className={`h-full ${barColor} transition-all duration-500`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {isDanger && (
                  <button
                    type="button"
                    onClick={() => {
                      // Faz 9 CP4.7 — clicking the "kotanız doldu" banner
                      // routes the user by role: admin scope opens the same
                      // system-quota editor as the header pencil icon, and
                      // everyone else jumps to the "Lisansım" tab.
                      if (stats.is_admin_scope && onEditSystemQuota) {
                        onEditSystemQuota();
                      } else {
                        window.dispatchEvent(new CustomEvent("sertex:open-settings-tab", {
                          detail: { tab: "mylicense" }
                        }));
                      }
                    }}
                    data-testid="storage-quota-upgrade"
                    title="Lisans/kota yönetim sekmesine git"
                    className="mt-1 w-full text-left hud-text text-sertex-danger hover:text-sertex-danger/80 hover:underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    ⚠ Depolama kotanız doldu — {stats.is_admin_scope ? "kapasiteyi artırın" : "planınızı yükseltin"} →
                  </button>
                )}
                {isWarn && !isDanger && (
                  <button
                    type="button"
                    onClick={() => {
                      if (stats.is_admin_scope && onEditSystemQuota) {
                        onEditSystemQuota();
                      } else {
                        window.dispatchEvent(new CustomEvent("sertex:open-settings-tab", {
                          detail: { tab: "mylicense" }
                        }));
                      }
                    }}
                    data-testid="storage-quota-warn"
                    title="Lisans/kota yönetim sekmesine git"
                    className="mt-1 w-full text-left hud-text text-amber-300/80 hover:text-amber-300 hover:underline underline-offset-2 cursor-pointer transition-colors"
                  >
                    Depolamanızın %{pct.toFixed(0)}'i doldu →
                  </button>
                )}
              </div>
            );
          })() : null}
          {/* Bildirim izni kısayolu — izin verilmemişse görünür, tek dokunuşla açar. */}
          <NotificationPermBadge />
        </div>
        <div className="shrink-0 flex items-center gap-1 flex-wrap justify-end">
          <NotificationBell />
          <button
            onClick={onResetAllPanels}
            data-testid="sidebar-reset-panels"
            title="Tüm HUD panellerini fabrika ayarına döndür"
            className="flex items-center gap-1 px-2 py-1 border border-sertex-cyan/30 rounded text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors"
          >
            <RotateCcw className="h-3 w-3" />
            SIFIRLA
          </button>
          <button
            onClick={onToggleAllPanels}
            data-testid="sidebar-toggle-all-panels"
            title={allHidden ? "Tüm HUD panellerini göster" : "Tüm HUD panellerini gizle (odak modu)"}
            className="flex items-center gap-1 px-2 py-1 border border-sertex-cyan/30 rounded text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors"
          >
            {allHidden ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            {allHidden ? "AÇ" : "GİZLE"}
          </button>
          <button
            onClick={onCycleDock}
            data-testid="sidebar-dock-cycle"
            title={`Konum: ${DOCK_LABEL[dock]} — değiştirmek için tıkla`}
            className="flex items-center gap-1 px-2 py-1 border border-sertex-cyan/30 rounded text-sertex-cyan hover:bg-sertex-cyan/10 hud-text transition-colors"
          >
            <ArrowLeftRight className="h-3 w-3" />
            {DOCK_LABEL[dock]}
          </button>
        </div>
      </div>

      {/* Layout Presets — kaydet, yükle, sil */}
      <div className="px-4 pb-2 pt-2 border-b border-sertex-cyan/20 flex items-center gap-1.5 flex-wrap">
        <Bookmark className="h-3 w-3 text-sertex-cyan/70" />
        <span className="hud-text text-sertex-textMuted mr-1">DÜZEN:</span>
        <select
          value={activePreset}
          onChange={(e) => onLoadPreset(e.target.value)}
          data-testid="sidebar-preset-select"
          className="flex-1 min-w-[100px] bg-sertex-surface border border-sertex-cyan/30 rounded px-1.5 py-0.5 text-xs font-mono text-sertex-text hover:border-sertex-cyan/60 focus:border-sertex-cyan outline-none cursor-pointer"
        >
          <option value="">— Seç —</option>
          {Object.keys(presets).sort().map((n) => (
            <option key={n} value={n}>{n}</option>
          ))}
        </select>
        <button
          onClick={onSavePreset}
          data-testid="sidebar-preset-save"
          title="Şu anki düzeni yeni isimle kaydet"
          className="p-1 border border-sertex-cyan/30 rounded text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
        >
          <Save className="h-3 w-3" />
        </button>
        <button
          onClick={onDeletePreset}
          disabled={!activePreset || !presets[activePreset]}
          data-testid="sidebar-preset-delete"
          title="Seçili düzeni sil"
          className="p-1 border border-sertex-cyan/30 rounded text-sertex-cyan hover:bg-sertex-danger/10 hover:text-sertex-danger disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-sertex-cyan disabled:cursor-not-allowed transition-colors"
        >
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
    </>
  );
};

export default NeuralLinkHeader;
