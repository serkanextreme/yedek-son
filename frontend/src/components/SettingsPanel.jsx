import React, { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Palette, RotateCcw, LayoutTemplate, User, LogOut, Lock, KeyRound, Users, Bell, Play, Upload, Trash2, Volume2, Briefcase, Building2, Tag, Clock, Activity, Megaphone, MessageSquare, Archive, ShieldCheck, AlertTriangle, Gauge, Repeat } from "lucide-react";
import { useSettings, setColor, resetColors, DEFAULT_COLORS } from "../lib/settings";
import { useAuth } from "../lib/auth";
import { isAdminLike, isSuperAdmin, isManager, roleLabel } from "../lib/roles";
import { api, reminderConfigApi, companiesApi } from "../lib/api";
import { toast } from "sonner";
import UserManagement from "./UserManagement";
import LicenseManagement from "./LicenseManagement";
import MyLicense from "./MyLicense";
import CompaniesManagement from "./CompaniesManagement";
import ManagerVisibilityManagement from "./ManagerVisibilityManagement";
import TaskCategoriesManagement from "./TaskCategoriesManagement";
import MonitoringDashboard from "./MonitoringDashboard";
import ClientErrorRadar from "./ClientErrorRadar";
import PerformancePanel from "./PerformancePanel";
import AppearancePanel from "./AppearancePanel";
// Faz 9 CP6 — Global Announcement System.
import AnnouncementManager from "./AnnouncementManager";
import ChatPromptEditor from "./ChatPromptEditor";
import SuperAdminPanel from "./SuperAdminPanel";
import TaskPolicySettings from "./TaskPolicySettings";
import NotificationSettings from "./NotificationSettings";
import PushToggle from "./PushToggle";
import {
  PRESETS as ALARM_PRESETS,
  loadAlarmSettings,
  saveAlarmSettings,
  loadCustomAlarm,
  saveCustomAlarm,
  removeCustomAlarm,
  playPreset,
  playCustomFromDataUrl,
  stopAlarm,
  fileToDataUrl,
} from "../lib/alarmSounds";

const PRESETS = [
  { name: "Klasik", colors: { idle: "#0088FF", speaking: "#00FF88", error: "#FF3355" } },
  { name: "Iron Man", colors: { idle: "#FFB800", speaking: "#FF3300", error: "#8800FF" } },
  { name: "Cyberpunk", colors: { idle: "#FF00AA", speaking: "#00F0FF", error: "#FFFF00" } },
  { name: "Matrix", colors: { idle: "#00FF41", speaking: "#B4FF00", error: "#FF0055" } },
  { name: "Deniz", colors: { idle: "#00D9FF", speaking: "#00FFAA", error: "#FF2E63" } },
  { name: "Alev", colors: { idle: "#FF6600", speaking: "#FFCC00", error: "#FF0033" } },
  { name: "Ametist", colors: { idle: "#9D4EDD", speaking: "#C77DFF", error: "#FF006E" } },
  { name: "Karbon", colors: { idle: "#94A3B8", speaking: "#F1F5F9", error: "#EF4444" } },
];

const ColorRow = ({ label, colorKey, value, description }) => (
  <div className="flex items-center gap-3 py-2" data-testid={`color-row-${colorKey}`}>
    <div className="flex-1">
      <div className="hud-text text-sertex-text">{label}</div>
      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px] mt-0.5">
        {description}
      </div>
    </div>
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={value}
        onChange={(e) => setColor(colorKey, e.target.value)}
        data-testid={`color-input-${colorKey}`}
        className="w-10 h-10 rounded-md border border-sertex-cyan/40 bg-sertex-surface cursor-pointer"
        style={{ padding: 2 }}
      />
      <div
        className="w-6 h-6 rounded-sm border border-sertex-cyan/40"
        style={{
          background: value,
          boxShadow: `0 0 12px ${value}`,
        }}
      />
      <span className="hud-text text-sertex-textMuted w-16 text-right">{value.toUpperCase()}</span>
    </div>
  </div>
);

const SETTINGS_TABS = [
  { key: "custom", label: "Renkler", color: "cyan" },
  { key: "presets", label: "Temalar", color: "cyan" },
  { key: "alarm", label: "Alarm", icon: Bell, color: "cyan" },
  { key: "account", label: "Hesap", color: "cyan" },
  { key: "performance", label: "Performans", icon: Gauge, color: "emerald" },
  { key: "workspace", label: "Mod", icon: Briefcase, color: "cyan" },
  { key: "reminders", label: "Uyarılar", icon: Clock, color: "orange" },
  { key: "monitoring", label: "İstatistik", icon: Activity, color: "emerald", team: true, show: (u) => isSuperAdmin(u) },
  { key: "errorradar", label: "Hata Radarı", icon: AlertTriangle, color: "red", team: true, show: (u) => isSuperAdmin(u) },
  { key: "users", label: "Kullanıcılar", icon: Users, color: "yellow", team: true, show: (u) => isAdminLike(u) },
  { key: "licenses", label: "Lisanslar", icon: KeyRound, color: "yellow", team: true, show: (u) => isSuperAdmin(u) },
  { key: "companies", label: "Şirketler", icon: Building2, color: "yellow", team: true, show: (u) => isAdminLike(u) },
  { key: "visibility", label: "Yetkiler", icon: Briefcase, color: "purple", team: true, show: (u) => isAdminLike(u) },
  { key: "categories", label: "İş Kolları", icon: Tag, color: "cyan", team: true, show: (u) => isAdminLike(u) || isManager(u) },
  { key: "archive", label: "Arşiv", icon: Archive, color: "orange", show: (u, caps) => isAdminLike(u) || isManager(u) || !!caps?.manage_policy },
  { key: "announcements", label: "Duyurular", icon: Megaphone, color: "emerald", team: true, show: (u) => isAdminLike(u) },
  { key: "prompt", label: "Sertex Prompt", icon: MessageSquare, color: "purple", show: (u) => isSuperAdmin(u) },
  { key: "roles", label: "Süper Yönetici", icon: ShieldCheck, color: "purple", team: true, show: (u) => isSuperAdmin(u) },
  { key: "mylicense", label: "Lisansım", icon: KeyRound, color: "cyan", show: (u) => !isAdminLike(u) },
];

const TAB_ACTIVE_CLS = {
  cyan: "border-sertex-cyan text-sertex-cyan neon-glow bg-sertex-cyan/10",
  orange: "border-orange-400 text-orange-300 neon-glow bg-orange-500/10",
  emerald: "border-emerald-400 text-emerald-300 neon-glow bg-emerald-500/10",
  yellow: "border-yellow-400 text-yellow-300 neon-glow bg-yellow-500/10",
  purple: "border-purple-400 text-purple-300 neon-glow bg-purple-500/10",
  red: "border-rose-500 text-rose-300 neon-glow bg-rose-500/10",
};

const SettingsPanel = ({ open, onClose, initialTab }) => {
  const { colors } = useSettings();
  const { user, logout, workspaceMode, dualMode, isOwner, teamFeaturesVisible, setWorkspaceMode, setDualMode } = useAuth();
  const [savingMode, setSavingMode] = useState(false);
  const [tab, setTab] = useState("custom");
  // Faz 9 CP3 — external callers (license-expiring banner, deep-links) can
  // request a specific tab. Sync whenever the modal is (re)opened.
  useEffect(() => {
    if (open && initialTab) {
      setTab(initialTab);
    }
  }, [open, initialTab]);

  // Account tab state
  const [curPw, setCurPw] = useState("");
  const [newPw, setNewPw] = useState("");
  const [newPw2, setNewPw2] = useState("");
  const [newUsername, setNewUsername] = useState("");
  const [saving, setSaving] = useState(false);

  // Alarm tab state — refreshed from localStorage whenever the panel opens
  const [alarmSettings, setAlarmSettings] = useState(loadAlarmSettings);
  const [customAlarm, setCustomAlarm] = useState(loadCustomAlarm);
  const fileInputRef = useRef(null);

  // Faz 8 CP5 — Yaklaşan-uyarı config (user + company thresholds).
  const [reminderCfg, setReminderCfg] = useState(null);
  const [reminderSaving, setReminderSaving] = useState(false);
  // Arşiv v2 — geçerli kullanıcının arşiv yetkileri (tab görünürlüğü için).
  const [archiveCaps, setArchiveCaps] = useState(null);
  useEffect(() => {
    if (!open) return;
    reminderConfigApi.get().then(setReminderCfg).catch(() => setReminderCfg(null));
    api.get("/tasks/settings").then((r) => setArchiveCaps(r.data?.caps || null)).catch(() => setArchiveCaps(null));
  }, [open]);

  // Görünür sekmeler — rol + (ekip özellikleri kişisel modda gizli, sahip hariç).
  const isTabVisible = (t) =>
    (!t.show || t.show(user, archiveCaps)) && (!t.team || teamFeaturesVisible);

  // Aktif sekme gizlendiyse (ör. ekip → kişisel geçiş) güvenli sekmeye düş.
  useEffect(() => {
    const active = SETTINGS_TABS.find((t) => t.key === tab);
    if (active && !isTabVisible(active)) setTab("custom");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamFeaturesVisible, workspaceMode, tab, archiveCaps]);

  useEffect(() => {
    if (open) {
      setAlarmSettings(loadAlarmSettings());
      setCustomAlarm(loadCustomAlarm());
    }
    if (!open) stopAlarm();
  }, [open]);

  const updateAlarm = (patch) => {
    const next = saveAlarmSettings(patch);
    setAlarmSettings(next);
  };

  const handlePreview = () => {
    stopAlarm();
    if (alarmSettings.selected === "custom") {
      if (customAlarm?.dataUrl) {
        playCustomFromDataUrl(customAlarm.dataUrl, alarmSettings.volume);
      } else {
        toast.error("Önce özel bir ses dosyası yükleyin");
      }
    } else {
      playPreset(alarmSettings.selected || "two_tone", alarmSettings.volume);
    }
  };

  const handleUpload = async (file) => {
    if (!file) return;
    if (!file.type.startsWith("audio/")) {
      toast.error("Lütfen bir ses dosyası seçin (.mp3, .wav, .ogg…)");
      return;
    }
    // 2 MB limit — localStorage tends to fail around ~5 MB (base64 inflates 33%)
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Dosya boyutu en fazla 2 MB olabilir");
      return;
    }
    try {
      const dataUrl = await fileToDataUrl(file);
      saveCustomAlarm(file.name, dataUrl);
      setCustomAlarm({ name: file.name, dataUrl });
      updateAlarm({ selected: "custom" });
      toast.success(`"${file.name}" alarm sesi olarak kaydedildi`);
    } catch (e) {
      toast.error(e?.message || "Yükleme başarısız");
    }
  };

  const handleRemoveCustom = () => {
    removeCustomAlarm();
    setCustomAlarm(null);
    if (alarmSettings.selected === "custom") {
      updateAlarm({ selected: "two_tone" });
    }
    toast.success("Özel alarm sesi kaldırıldı");
  };

  const handleChangePassword = async () => {
    if (newPw.length < 6) {
      toast.error("Yeni şifre en az 6 karakter olmalı");
      return;
    }
    if (newPw !== newPw2) {
      toast.error("Yeni şifreler eşleşmiyor");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-password", {
        current_password: curPw,
        new_password: newPw,
      });
      toast.success("Şifre değiştirildi");
      setCurPw("");
      setNewPw("");
      setNewPw2("");
    } catch (e) {
      const d = e?.response?.data?.detail || "Değiştirilemedi";
      toast.error(typeof d === "string" ? d : "Hata");
    } finally {
      setSaving(false);
    }
  };

  const handleChangeUsername = async () => {
    if (newUsername.trim().length < 3) {
      toast.error("Kullanıcı adı en az 3 karakter olmalı");
      return;
    }
    if (!curPw) {
      toast.error("Mevcut şifrenizi girin");
      return;
    }
    setSaving(true);
    try {
      await api.post("/auth/change-username", {
        current_password: curPw,
        new_username: newUsername.trim(),
      });
      toast.success("Kullanıcı adı değiştirildi — tekrar giriş yapın");
      setTimeout(() => logout(), 1500);
    } catch (e) {
      const d = e?.response?.data?.detail || "Değiştirilemedi";
      toast.error(typeof d === "string" ? d : "Hata");
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
            className="fixed inset-0 z-40 bg-sertex-bg/70 backdrop-blur-sm"
            data-testid="settings-backdrop"
          />
          {/* Panel wrapper — flex-centered so framer-motion doesn't fight tailwind translate */}
          <div className="fixed inset-0 z-50 flex items-center justify-center pointer-events-none px-4">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              transition={{ type: "spring", stiffness: 320, damping: 26 }}
              className="pointer-events-auto w-full max-w-[720px] max-h-[85vh] glass-panel corner-bracket flex flex-col"
              data-testid="settings-panel"
            >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-sertex-cyan/20">
              <div className="flex items-center gap-2">
                <Palette className="h-4 w-4 text-sertex-cyan" />
                <span className="display-text text-sertex-cyan neon-glow tracking-[0.2em]">
                  AYARLAR
                </span>
              </div>
              <button
                onClick={onClose}
                data-testid="settings-close"
                className="p-1.5 hover:bg-sertex-cyan/10 rounded-md text-sertex-textMuted hover:text-sertex-cyan transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Sekmeler sola alt alta (dikey) + içerik — yatay kaydırma kaldırıldı. */}
            <div className="flex flex-1 min-h-0">
              <div
                className="flex flex-col w-[176px] shrink-0 border-r border-sertex-cyan/20 overflow-y-auto scrollbar-sertex py-1"
                data-testid="settings-tabs"
              >
                {SETTINGS_TABS.filter(isTabVisible).map((t) => {
                  const active = tab === t.key;
                  const Icon = t.icon;
                  return (
                    <button
                      key={t.key}
                      onClick={() => setTab(t.key)}
                      data-testid={`settings-tab-${t.key}`}
                      className={`w-full text-left px-3 py-2.5 hud-text transition-colors border-l-2 flex items-center gap-2 ${
                        active
                          ? TAB_ACTIVE_CLS[t.color] || TAB_ACTIVE_CLS.cyan
                          : "border-transparent text-sertex-textMuted hover:text-sertex-textSecondary hover:bg-sertex-cyan/5"
                      }`}
                    >
                      {Icon && <Icon className="h-3 w-3 shrink-0" />}
                      <span className="truncate">{t.label}</span>
                    </button>
                  );
                })}
              </div>

              {/* Content */}
              <div className="p-4 flex-1 overflow-y-auto scrollbar-sertex" data-testid="settings-content">
              {tab === "custom" && (
                <>
                  <div className="hud-text text-sertex-textMuted mb-2 normal-case tracking-normal text-[11px]">
                    Küre ve etrafındaki düğümler her durumda seçtiğiniz rengi alır. Panel renkleri sabit kalır.
                  </div>
                  <ColorRow
                    label="🔵 Beklemede"
                    colorKey="idle"
                    value={colors.idle}
                    description="Sertex hazır ve dinlemede iken küre rengi"
                  />
                  <ColorRow
                    label="🟢 Cevap Verirken"
                    colorKey="speaking"
                    value={colors.speaking}
                    description="Sertex konuşurken veya yanıt oluşturulurken"
                  />
                  <ColorRow
                    label="🔴 Sistem Hatası"
                    colorKey="error"
                    value={colors.error}
                    description="Bağlantı veya işlem hatası oluştuğunda"
                  />
                  <div className="mt-4 pt-3 border-t border-sertex-cyan/15 space-y-2">
                    <button
                      onClick={resetColors}
                      data-testid="settings-reset"
                      className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      Renkleri Varsayılana Döndür
                    </button>
                    <button
                      onClick={() => {
                        try {
                          localStorage.removeItem("sertex_windows_v1");
                          toast.success("Pencereler sıfırlandı — sayfayı yenileyin");
                          setTimeout(() => window.location.reload(), 1000);
                        } catch (e) { console.warn("[SettingsPanel.jsx] hata bastırıldı:", e); }
                      }}
                      data-testid="settings-reset-windows"
                      className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
                    >
                      <LayoutTemplate className="h-3.5 w-3.5" />
                      Pencere Konumlarını Sıfırla
                    </button>
                  </div>
                </>
              )}

              {tab === "presets" && (
                <>
                  <div className="hud-text text-sertex-textMuted mb-3 normal-case tracking-normal text-[11px]">
                    Hazır tema seçin — tüm renkler tek tıkla ayarlanır.
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    {PRESETS.map((p) => (
                      <button
                        key={p.name}
                        data-testid={`preset-${p.name.toLowerCase()}`}
                        onClick={() => {
                          setColor("idle", p.colors.idle);
                          setColor("speaking", p.colors.speaking);
                          setColor("error", p.colors.error);
                        }}
                        className="p-3 border border-sertex-cyan/20 hover:border-sertex-cyan/60 hover:bg-sertex-cyan/5 rounded-md transition-colors text-left group"
                      >
                        <div className="hud-text text-sertex-text mb-2">{p.name}</div>
                        <div className="flex gap-1.5">
                          {Object.values(p.colors).map((c, i) => (
                            <div
                              key={i}
                              className="flex-1 h-3 rounded-sm"
                              style={{ background: c, boxShadow: `0 0 8px ${c}` }}
                            />
                          ))}
                        </div>
                      </button>
                    ))}
                  </div>

                  {/* Görünüm: Arayüz düzeni + vurgu rengi + yazı boyutu */}
                  <div className="mt-5 pt-4 border-t border-sertex-cyan/15">
                    <AppearancePanel />
                  </div>
                </>
              )}

              {tab === "users" && isAdminLike(user) && <UserManagement onClose={onClose} />}
              {tab === "monitoring" && isSuperAdmin(user) && <MonitoringDashboard />}
              {tab === "errorradar" && isSuperAdmin(user) && <ClientErrorRadar />}
              {tab === "performance" && <PerformancePanel />}
              {tab === "licenses" && isSuperAdmin(user) && <LicenseManagement />}
              {tab === "companies" && isAdminLike(user) && <CompaniesManagement />}
              {tab === "visibility" && isAdminLike(user) && <ManagerVisibilityManagement />}
              {tab === "categories" && (isAdminLike(user) || isManager(user)) && <TaskCategoriesManagement />}
              {tab === "announcements" && isAdminLike(user) && <AnnouncementManager />}
              {tab === "prompt" && isSuperAdmin(user) && <ChatPromptEditor />}
              {tab === "roles" && isSuperAdmin(user) && <SuperAdminPanel />}
              {tab === "archive" && <TaskPolicySettings />}
              {tab === "mylicense" && !isAdminLike(user) && <MyLicense />}

              {tab === "workspace" && (
                <div className="space-y-4" data-testid="workspace-mode-tab">
                  <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[11px]">
                    Sertex nasıl kullanılsın? Kişisel mod ekip/B2B özelliklerini
                    gizler, ekran sade kalır. Ekip modu tüm B2B özelliklerini açar.
                    Çift Mod ile ikisini birlikte kullan — şirkette Ekip, dışarıda
                    Kişisel; sol paneldeki hızlı düğmeyle tek tıkla geç.
                    {isOwner && (
                      <div className="mt-2 text-yellow-300/90">
                        Not: Sahip olarak mod, senin görünümünde hiçbir şeyi gizlemez —
                        her zaman tüm özellikleri görürsün.
                      </div>
                    )}
                  </div>

                  {/* ÇİFT MOD toggle */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (savingMode) return;
                      setSavingMode(true);
                      try {
                        await setDualMode(!dualMode);
                        toast.success(dualMode ? "Çift Mod kapatıldı" : "Çift Mod açıldı — hızlı geçiş düğmesi aktif");
                      } catch (e) {
                        toast.error("Değiştirilemedi");
                      } finally {
                        setSavingMode(false);
                      }
                    }}
                    data-testid="workspace-dual-toggle"
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      dualMode ? "border-emerald-400 bg-emerald-400/10" : "border-sertex-cyan/25 hover:border-sertex-cyan/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Repeat className="h-4 w-4 text-emerald-300" />
                      <span className="hud-text text-emerald-300 neon-glow">ÇİFT MOD</span>
                      <span className={`ml-auto text-[10px] font-mono ${dualMode ? "text-emerald-300" : "text-sertex-textMuted"}`}>
                        {dualMode ? "✓ AÇIK" : "KAPALI"}
                      </span>
                    </div>
                    <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
                      Kişisel + Ekip modunu birlikte kullan. Açıkken sol paneldeki
                      başlıkta hızlı geçiş düğmesi çıkar; tek tıkla anında geçersin.
                    </div>
                  </button>

                  <div className="hud-text text-sertex-textMuted/70">
                    {dualMode ? "— ŞU AN AKTİF GÖRÜNÜM —" : "— GÖRÜNÜM MODU —"}
                  </div>

                  {/* PERSONAL card */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (workspaceMode === "personal" || savingMode) return;
                      setSavingMode(true);
                      try {
                        await setWorkspaceMode("personal");
                        toast.success("Kişisel moda geçildi");
                      } catch (e) {
                        toast.error("Değiştirilemedi");
                      } finally {
                        setSavingMode(false);
                      }
                    }}
                    data-testid="workspace-mode-personal"
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      workspaceMode === "personal"
                        ? "border-sertex-cyan bg-sertex-cyan/10"
                        : "border-sertex-cyan/25 hover:border-sertex-cyan/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <User className="h-4 w-4 text-sertex-cyan" />
                      <span className="hud-text text-sertex-cyan neon-glow">KİŞİSEL MOD</span>
                      {workspaceMode === "personal" && (
                        <span className="ml-auto text-[10px] font-mono text-sertex-cyan">✓ AKTİF</span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
                      Tek başına asistan olarak kullan. Görev sahibi, şirket, ekip
                      alanları — hepsi gizli. Minimum detay, maksimum sadelik.
                    </div>
                  </button>

                  {/* TEAM card */}
                  <button
                    type="button"
                    onClick={async () => {
                      if (workspaceMode === "team" || savingMode) return;
                      setSavingMode(true);
                      try {
                        await setWorkspaceMode("team");
                        toast.success("Ekip moduna geçildi");
                      } catch (e) {
                        toast.error("Değiştirilemedi");
                      } finally {
                        setSavingMode(false);
                      }
                    }}
                    data-testid="workspace-mode-team"
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      workspaceMode === "team"
                        ? "border-sertex-cyan bg-sertex-cyan/10"
                        : "border-sertex-cyan/25 hover:border-sertex-cyan/60"
                    }`}
                  >
                    <div className="flex items-center gap-2 mb-1">
                      <Users className="h-4 w-4 text-sertex-cyan" />
                      <span className="hud-text text-sertex-cyan neon-glow">EKİP MODU</span>
                      {workspaceMode === "team" && (
                        <span className="ml-auto text-[10px] font-mono text-sertex-cyan">✓ AKTİF</span>
                      )}
                    </div>
                    <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
                      Şirket, görev sahibi, ekip gibi B2B özelliklerini aç. Görev
                      kartlarında sahibi + şirket etiketleri, ileride ekip yönetimi.
                    </div>
                  </button>
                </div>
              )}

              {tab === "reminders" && (
                <div className="space-y-6">
                <ReminderSettingsTab
                  cfg={reminderCfg}
                  saving={reminderSaving}
                  onSaveUser={async (days) => {
                    setReminderSaving(true);
                    try {
                      await reminderConfigApi.setUserThreshold(days);
                      const next = await reminderConfigApi.get();
                      setReminderCfg(next);
                      toast.success(days == null ? "Kendi eşiğim varsayılana çekildi" : `Kendi eşiğim: ${days} gün`);
                    } catch (e) {
                      toast.error("Değiştirilemedi");
                    } finally {
                      setReminderSaving(false);
                    }
                  }}
                  onSaveCompany={async (days) => {
                    if (!user?.company_id) return;
                    setReminderSaving(true);
                    try {
                      await companiesApi.update(user.company_id, { due_soon_threshold: days == null ? 0 : days });
                      const next = await reminderConfigApi.get();
                      setReminderCfg(next);
                      toast.success(days == null ? "Şirket eşiği varsayılana çekildi" : `Şirket eşiği: ${days} gün`);
                    } catch (e) {
                      toast.error(e?.response?.data?.detail || "Değiştirilemedi");
                    } finally {
                      setReminderSaving(false);
                    }
                  }}
                  role={user?.role}
                  workspaceMode={reminderCfg?.workspace_mode || workspaceMode}
                  companyId={user?.company_id}
                />
                <NotificationSettings />
                <PushToggle />
                </div>
              )}

              {tab === "alarm" && (
                <div className="space-y-4" data-testid="alarm-tab-content">
                  <div className="hud-text text-sertex-textMuted mb-1 normal-case tracking-normal text-[11px]">
                    Süresi geçmiş görev uyarısı açıldığında çalacak sesi seç. Kendi ses dosyanı da yükleyebilirsin.
                  </div>

                  {/* Enable toggle */}
                  <div className="flex items-center justify-between glass-panel p-3 border-sertex-cyan/20">
                    <div>
                      <div className="hud-text text-sertex-text flex items-center gap-1.5">
                        <Bell className="h-3.5 w-3.5 text-sertex-cyan" /> ALARM SESİ
                      </div>
                      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px] mt-0.5">
                        Kapatırsan sadece görsel uyarı gösterilir
                      </div>
                    </div>
                    <button
                      onClick={() => updateAlarm({ enabled: !alarmSettings.enabled })}
                      data-testid="alarm-toggle-enabled"
                      className={`relative w-12 h-6 rounded-full transition-colors border ${
                        alarmSettings.enabled
                          ? "bg-sertex-cyan/30 border-sertex-cyan"
                          : "bg-sertex-surface border-sertex-textMuted/40"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full transition-all ${
                          alarmSettings.enabled
                            ? "left-6 bg-sertex-cyan shadow-[0_0_8px_rgba(0,240,255,0.8)]"
                            : "left-0.5 bg-sertex-textMuted"
                        }`}
                      />
                    </button>
                  </div>

                  {/* Preset list */}
                  <div>
                    <div className="hud-text text-sertex-cyan mb-2">HAZIR SESLER</div>
                    <div className="space-y-1.5">
                      {ALARM_PRESETS.map((p) => (
                        <label
                          key={p.key}
                          data-testid={`alarm-preset-${p.key}`}
                          className={`flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer transition-colors ${
                            alarmSettings.selected === p.key
                              ? "border-sertex-cyan bg-sertex-cyan/10"
                              : "border-sertex-cyan/20 hover:border-sertex-cyan/40 hover:bg-sertex-cyan/5"
                          }`}
                        >
                          <input
                            type="radio"
                            name="alarm-preset"
                            checked={alarmSettings.selected === p.key}
                            onChange={() => updateAlarm({ selected: p.key })}
                            className="accent-sertex-cyan"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-sertex-text font-mono">{p.label}</div>
                            <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px]">
                              {p.desc}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault();
                              stopAlarm();
                              playPreset(p.key, alarmSettings.volume);
                            }}
                            data-testid={`alarm-preview-${p.key}`}
                            title="Örnek çal"
                            className="p-1.5 rounded border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
                          >
                            <Play className="h-3 w-3" />
                          </button>
                        </label>
                      ))}

                      {/* Custom sound row */}
                      <label
                        data-testid="alarm-preset-custom"
                        className={`flex items-center gap-2 px-3 py-2 border rounded-md cursor-pointer transition-colors ${
                          alarmSettings.selected === "custom"
                            ? "border-sertex-cyan bg-sertex-cyan/10"
                            : "border-sertex-cyan/20 hover:border-sertex-cyan/40 hover:bg-sertex-cyan/5"
                        } ${!customAlarm ? "opacity-60" : ""}`}
                      >
                        <input
                          type="radio"
                          name="alarm-preset"
                          checked={alarmSettings.selected === "custom"}
                          disabled={!customAlarm}
                          onChange={() => customAlarm && updateAlarm({ selected: "custom" })}
                          className="accent-sertex-cyan"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm text-sertex-text font-mono truncate">
                            {customAlarm ? customAlarm.name : "Özel Ses (yüklenmedi)"}
                          </div>
                          <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px]">
                            Kendi ses dosyanı buraya yükle
                          </div>
                        </div>
                        {customAlarm && (
                          <>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                stopAlarm();
                                playCustomFromDataUrl(customAlarm.dataUrl, alarmSettings.volume);
                              }}
                              data-testid="alarm-preview-custom"
                              title="Örnek çal"
                              className="p-1.5 rounded border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 transition-colors"
                            >
                              <Play className="h-3 w-3" />
                            </button>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                handleRemoveCustom();
                              }}
                              data-testid="alarm-remove-custom"
                              title="Kaldır"
                              className="p-1.5 rounded border border-sertex-danger/40 text-sertex-danger hover:bg-sertex-danger/10 transition-colors"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </>
                        )}
                      </label>
                    </div>
                  </div>

                  {/* Upload */}
                  <div className="pt-3 border-t border-sertex-cyan/15">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="audio/*"
                      className="hidden"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        handleUpload(f);
                        e.target.value = "";
                      }}
                      data-testid="alarm-file-input"
                    />
                    <button
                      onClick={() => fileInputRef.current?.click()}
                      data-testid="alarm-upload-btn"
                      className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Kendi Alarm Sesini Yükle (Max 2 MB)
                    </button>
                    <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px] mt-1.5 text-center">
                      Desteklenen formatlar: mp3, wav, ogg, m4a
                    </div>
                  </div>

                  {/* Volume slider */}
                  <div className="pt-3 border-t border-sertex-cyan/15">
                    <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
                      <Volume2 className="h-3 w-3" /> SES SEVİYESİ:{" "}
                      <span className="text-sertex-text tabular-nums">
                        {Math.round(alarmSettings.volume * 100)}%
                      </span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={Math.round(alarmSettings.volume * 100)}
                      onChange={(e) => updateAlarm({ volume: Number(e.target.value) / 100 })}
                      data-testid="alarm-volume-slider"
                      className="w-full accent-sertex-cyan"
                    />
                  </div>

                  {/* Master preview */}
                  <button
                    onClick={handlePreview}
                    data-testid="alarm-preview-current"
                    className="w-full py-2 border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
                  >
                    <Play className="h-3.5 w-3.5" />
                    Seçili Alarmı Test Et
                  </button>
                </div>
              )}

              {tab === "account" && (
                <div className="space-y-4">
                  {/* Current user */}
                  <div className="glass-panel p-3 border-sertex-cyan/20">
                    <div className="hud-text text-sertex-textMuted mb-1">
                      <User className="h-3 w-3 inline mr-1" /> AKTİF KULLANICI
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-sertex-cyan font-mono text-base">
                        {user?.username || "-"}
                      </div>
                      {(isAdminLike(user) || isManager(user)) && (
                        <span className="hud-text text-yellow-300 px-2 py-0.5 border border-yellow-400/40 rounded bg-yellow-500/10">
                          {roleLabel(user?.role, user?.is_owner).toUpperCase()}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Change Password */}
                  <div>
                    <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1">
                      <Lock className="h-3 w-3" /> ŞİFRE DEĞİŞTİR
                    </div>
                    <input
                      type="password"
                      value={curPw}
                      onChange={(e) => setCurPw(e.target.value)}
                      placeholder="Mevcut şifre"
                      data-testid="acc-curpw"
                      className="w-full mb-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                    />
                    <input
                      type="password"
                      value={newPw}
                      onChange={(e) => setNewPw(e.target.value)}
                      placeholder="Yeni şifre (en az 6 karakter)"
                      data-testid="acc-newpw"
                      className="w-full mb-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                    />
                    <input
                      type="password"
                      value={newPw2}
                      onChange={(e) => setNewPw2(e.target.value)}
                      placeholder="Yeni şifre (tekrar)"
                      data-testid="acc-newpw2"
                      className="w-full mb-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                    />
                    <button
                      onClick={handleChangePassword}
                      disabled={saving || !curPw || !newPw}
                      data-testid="acc-change-password"
                      className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text disabled:opacity-40 transition-colors"
                    >
                      ŞİFREYİ GÜNCELLE
                    </button>
                  </div>

                  {/* Change Username */}
                  <div className="pt-4 border-t border-sertex-cyan/15">
                    <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1">
                      <KeyRound className="h-3 w-3" /> KULLANICI ADI DEĞİŞTİR
                    </div>
                    <input
                      type="text"
                      value={newUsername}
                      onChange={(e) => setNewUsername(e.target.value)}
                      placeholder="Yeni kullanıcı adı"
                      data-testid="acc-new-username"
                      className="w-full mb-2 bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-2 py-1.5 text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
                    />
                    <div className="hud-text text-sertex-textMuted mb-2 normal-case tracking-normal text-[10px]">
                      Mevcut şifreniz yukarıdaki "Mevcut şifre" kutusunda olmalı.
                    </div>
                    <button
                      onClick={handleChangeUsername}
                      disabled={saving || !curPw || !newUsername.trim()}
                      data-testid="acc-change-username"
                      className="w-full py-2 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md hud-text disabled:opacity-40 transition-colors"
                    >
                      KULLANICI ADINI GÜNCELLE
                    </button>
                  </div>

                  {/* Logout */}
                  <div className="pt-4 border-t border-sertex-cyan/15">
                    <button
                      onClick={() => {
                        logout();
                        onClose();
                        toast.success("Çıkış yapıldı");
                      }}
                      data-testid="acc-logout"
                      className="w-full py-2 border border-sertex-danger/50 text-sertex-danger hover:bg-sertex-danger/10 rounded-md hud-text flex items-center justify-center gap-2 transition-colors"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      ÇIKIŞ YAP
                    </button>
                  </div>
                </div>
              )}
            </div>
            </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
};

export default SettingsPanel;

// ============================================================================
// Faz 8 CP5 — Yaklaşan-uyarı ayarları sekmesi.
// Hierarchy shown left-to-right so users understand which layer takes effect.
//   Personal user  → sadece "kendi eşiğim"
//   Team employee  → "kendi eşiğim" + şirket'in default'unu göster (readonly)
//   Team manager   → hem kendi hem şirket ayarını değiştirebilir
//   Admin          → tüm şirketleri Şirketler sekmesinden görüyor; buradan
//                    kendi kişisel + kendi şirketini (varsa) ayarlar.
// Whitelist ("VARSAYILAN" + 1/2/3/5/7/14) backend allowlist ile birebir aynı.
// ============================================================================
const REMINDER_DAY_OPTIONS = [1, 2, 3, 5, 7, 14];

const ReminderSettingsTab = ({ cfg, saving, onSaveUser, onSaveCompany, role, workspaceMode, companyId }) => {
  const canEditCompany = (role === "admin" || role === "super_admin" || role === "manager") && !!companyId && workspaceMode === "team";
  const currentUser = cfg?.user_threshold;
  const currentCompany = cfg?.company_threshold;
  const effective = cfg?.effective ?? 3;
  const systemDefault = cfg?.system_default ?? 3;

  const label = (v) => (v == null ? `Varsayılan (${systemDefault})` : `${v} gün önce`);

  return (
    <div className="space-y-4" data-testid="reminders-tab-content">
      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[11px] leading-relaxed">
        Son tarihi yaklaşan görevler için <span className="text-orange-300 font-semibold">turuncu uyarı</span> ne kadar önceden gelsin?
        Her görev kendi ayarını taşıyabilir (sağ tık → <span className="text-orange-300">Yaklaşan Uyarısı</span>). Aşağıdakiler
        <span className="text-sertex-cyan"> varsayılan</span>: görev kendi ayarını taşımıyorsa devreye girer.
      </div>

      {/* Effective indicator */}
      <div className="glass-panel corner-bracket p-3 border-orange-500/30 flex items-center gap-3" data-testid="reminders-effective">
        <div className="h-10 w-10 rounded-md border border-orange-500/50 bg-orange-500/15 flex items-center justify-center">
          <span className="text-orange-300 font-mono font-semibold">{effective}g</span>
        </div>
        <div>
          <div className="hud-text text-orange-300">ŞUANKİ ETKİN EŞİK</div>
          <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
            Yeni görevlerin kaç gün önceden uyarı vereceği: <span className="text-orange-300">{effective} gün</span>
          </div>
        </div>
      </div>

      {/* User's own threshold */}
      <div className="glass-panel p-3 border-sertex-cyan/25 space-y-2" data-testid="reminders-user-block">
        <div className="hud-text text-sertex-text flex items-center gap-1.5">
          <User className="h-3.5 w-3.5 text-sertex-cyan" /> KENDİ EŞİĞİM
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
          Sadece sana özel — bu ayar seçili değilse {canEditCompany || currentCompany != null ? "şirket varsayılanı" : "sistem varsayılanı"} devreye girer.
        </div>
        <div className="flex flex-wrap gap-1.5">
          <ThresholdChip
            active={currentUser == null}
            onClick={() => onSaveUser(null)}
            disabled={saving}
            testid="reminders-user-default"
            label={`Varsayılan (${cfg?.company_threshold ?? systemDefault}g)`}
          />
          {REMINDER_DAY_OPTIONS.map((d) => (
            <ThresholdChip
              key={d}
              active={currentUser === d}
              onClick={() => onSaveUser(d)}
              disabled={saving}
              testid={`reminders-user-${d}d`}
              label={`${d} gün`}
            />
          ))}
        </div>
      </div>

      {/* Company threshold — visible when in team mode + company_id */}
      {workspaceMode === "team" && companyId && (
        <div
          className={`glass-panel p-3 border-purple-400/25 space-y-2 ${canEditCompany ? "" : "opacity-70"}`}
          data-testid="reminders-company-block"
        >
          <div className="hud-text text-purple-300 flex items-center gap-1.5">
            <Building2 className="h-3.5 w-3.5" /> ŞİRKET VARSAYILANI
            {!canEditCompany && (
              <span className="ml-auto text-[10px] text-sertex-textMuted normal-case">Sadece admin/müdür değiştirebilir</span>
            )}
          </div>
          <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
            Şirketteki tüm kullanıcılar için varsayılan — kişisel eşik seçenlerin
            ayarı önceliklidir.
          </div>
          <div className="flex flex-wrap gap-1.5">
            <ThresholdChip
              active={currentCompany == null}
              onClick={() => canEditCompany && onSaveCompany(null)}
              disabled={saving || !canEditCompany}
              testid="reminders-company-default"
              accent="purple"
              label={`Sistem (${systemDefault}g)`}
            />
            {REMINDER_DAY_OPTIONS.map((d) => (
              <ThresholdChip
                key={d}
                active={currentCompany === d}
                onClick={() => canEditCompany && onSaveCompany(d)}
                disabled={saving || !canEditCompany}
                testid={`reminders-company-${d}d`}
                accent="purple"
                label={`${d} gün`}
              />
            ))}
          </div>
        </div>
      )}

      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[10px] leading-relaxed pt-1">
        💡 Öncelik zinciri: <span className="text-orange-300">görev</span> → <span className="text-sertex-cyan">kendi eşiğim</span>
        {workspaceMode === "team" && companyId && <> → <span className="text-purple-300">şirket varsayılanı</span></>} → sistem ({systemDefault} gün)
      </div>
    </div>
  );
};

const ThresholdChip = ({ active, onClick, disabled, testid, label, accent = "cyan" }) => {
  const accentBase = accent === "purple" ? "purple-400" : "sertex-cyan";
  const activeCls = accent === "purple"
    ? "border-purple-400 text-purple-300 bg-purple-400/15"
    : "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/15";
  const idleCls = accent === "purple"
    ? "border-purple-400/25 text-sertex-textMuted hover:text-purple-300 hover:border-purple-400/60"
    : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      data-testid={testid}
      className={`px-2.5 py-1 rounded-md border hud-text transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${active ? activeCls : idleCls}`}
    >
      {label}
    </button>
  );
};

