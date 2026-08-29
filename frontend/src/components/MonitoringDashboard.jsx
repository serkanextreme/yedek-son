import React, { useEffect, useState, useCallback } from "react";
import {
  Activity, Users, ListChecks, MessageSquare, Database, AlertTriangle,
  Building2, KeyRound, Bell, RefreshCw, Clock, Server, TrendingUp,
} from "lucide-react";
import { statsApi, clientLogsApi } from "../lib/api";
import { toast } from "sonner";

/**
 * Faz 9 CP4 — Production Monitoring dashboard.
 * Admin-only tab inside Settings → İstatistik.
 *
 * Live cards with 30 s auto-refresh: users, tasks, chat, DB, error count.
 * Data comes from `GET /api/admin/health` (see monitoring_service.py).
 */

const MetricCard = ({ icon: Icon, label, value, sub, accent = "cyan", testid }) => {
  const accentClasses = {
    cyan: "border-sertex-cyan/30 text-sertex-cyan",
    green: "border-emerald-400/30 text-emerald-300",
    orange: "border-orange-400/30 text-orange-300",
    red: "border-sertex-danger/40 text-sertex-danger",
    purple: "border-purple-400/30 text-purple-300",
    yellow: "border-yellow-400/30 text-yellow-300",
  };
  return (
    <div
      data-testid={testid}
      className={`glass-panel corner-bracket p-3 border ${accentClasses[accent] || accentClasses.cyan}`}
    >
      <div className="flex items-center gap-2 mb-1">
        <Icon className="h-3.5 w-3.5" />
        <span className="hud-text opacity-80">{label}</span>
      </div>
      <div className="font-mono font-semibold text-lg tabular-nums neon-glow" data-testid={`${testid}-value`}>
        {value}
      </div>
      {sub && (
        <div className="text-[10px] font-mono text-sertex-textMuted mt-0.5 normal-case">
          {sub}
        </div>
      )}
    </div>
  );
};

const MonitoringDashboard = () => {
  const [snapshot, setSnapshot] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastRefreshed, setLastRefreshed] = useState(null);
  const [clientLogs, setClientLogs] = useState(null);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const data = await statsApi.adminHealth();
      setSnapshot(data);
      setLastRefreshed(new Date());
    } catch (e) {
      toast.error(e?.response?.data?.detail || "İstatistik alınamadı");
    } finally {
      setLoading(false);
    }
    try {
      const cl = await clientLogsApi.list({ limit: 100 });
      setClientLogs(cl);
    } catch {
      /* silent — frontend error radar en iyi çaba (best-effort) */
    }
  }, []);

  const clearClientLogs = async () => {
    try {
      await clientLogsApi.clear();
      setClientLogs({ logs: [], total: 0, last_24h: 0 });
      toast.success("Frontend hata kayıtları temizlendi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Temizlenemedi");
    }
  };

  useEffect(() => {
    refresh();
    // Auto-refresh every 30 s (silent).
    const id = setInterval(() => refresh(true), 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  if (!snapshot && loading) {
    return (
      <div className="py-8 text-center hud-text text-sertex-textMuted" data-testid="monitoring-loading">
        YÜKLENIYOR...
      </div>
    );
  }
  if (!snapshot) {
    return (
      <div className="py-8 text-center hud-text text-sertex-textMuted">
        Veri yok.
        <button
          onClick={() => refresh()}
          data-testid="monitoring-retry"
          className="mt-3 mx-auto flex items-center gap-1 px-3 py-1.5 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded"
        >
          <RefreshCw className="h-3 w-3" /> Tekrar dene
        </button>
      </div>
    );
  }

  const u = snapshot.users || {};
  const t = snapshot.tasks || {};
  const c = snapshot.chat || {};
  const db = snapshot.db || {};
  const err = snapshot.errors || {};
  const totalErrors24h = (err.windowed?.ERROR || 0) + (err.windowed?.CRITICAL || 0);
  const totalWarnings24h = err.windowed?.WARNING || 0;

  return (
    <div className="space-y-4" data-testid="monitoring-dashboard">
      {/* Header row — uptime + refresh */}
      <div className="glass-panel corner-bracket p-3 border-sertex-cyan/30 flex items-center gap-3">
        <div className="h-10 w-10 rounded-md border border-emerald-400/50 bg-emerald-400/15 flex items-center justify-center">
          <Activity className="h-5 w-5 text-emerald-300" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="hud-text text-emerald-300 flex items-center gap-2">
            SİSTEM DURUMU · <span className="text-[10px] normal-case">{snapshot.status?.toUpperCase()}</span>
          </div>
          <div className="text-[11px] font-mono text-sertex-textMuted normal-case">
            Uptime: <span className="text-sertex-text" data-testid="monitoring-uptime">{snapshot.uptime_human}</span>
            {" · "}Python {snapshot.python_version}
          </div>
        </div>
        <button
          onClick={() => refresh()}
          data-testid="monitoring-refresh"
          disabled={loading}
          className="p-1.5 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded disabled:opacity-40"
          title="Yenile"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Users row */}
      <div>
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <Users className="h-3 w-3" /> KULLANICILAR
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            testid="monitoring-users-total"
            icon={Users} label="TOPLAM" value={u.total} accent="cyan"
            sub={`${u.admin || 0} yönetici · ${u.manager || 0} müdür · ${u.employee || 0} çalışan`}
          />
          <MetricCard
            testid="monitoring-users-active"
            icon={TrendingUp} label="AKTİF (24s)" value={u.active_24h} accent="green"
            sub="Son 24 saatte giriş yapan"
          />
        </div>
      </div>

      {/* Tasks row */}
      <div>
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <ListChecks className="h-3 w-3" /> GÖREVLER
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            testid="monitoring-tasks-created"
            icon={ListChecks} label="AÇILAN (24s)" value={t.created_24h} accent="cyan"
            sub={`${t.total} toplam görev`}
          />
          <MetricCard
            testid="monitoring-tasks-done"
            icon={ListChecks} label="TAMAMLANAN (24s)" value={t.done_24h} accent="green"
          />
          <MetricCard
            testid="monitoring-tasks-overdue"
            icon={Clock} label="GECİKEN" value={t.overdue_open} accent="red"
            sub={t.overdue_open > 0 ? "İnceleme gerekli" : "Temiz"}
          />
          <MetricCard
            testid="monitoring-tasks-orphaned"
            icon={AlertTriangle} label="YARIM KALAN" value={t.orphaned} accent="orange"
          />
        </div>
      </div>

      {/* Chat row */}
      <div>
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <MessageSquare className="h-3 w-3" /> SOHBET & BİLDİRİM (24s)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            testid="monitoring-chat-conversations"
            icon={MessageSquare} label="KONUŞMA" value={c.conversations_24h} accent="purple"
          />
          <MetricCard
            testid="monitoring-chat-messages"
            icon={MessageSquare} label="MESAJ" value={c.messages_24h} accent="purple"
          />
          <MetricCard
            testid="monitoring-notif-unread"
            icon={Bell} label="OKUNMAMIŞ BİLDİRİM"
            value={snapshot.notifications?.unread ?? 0}
            accent="yellow"
          />
          <MetricCard
            testid="monitoring-licenses-active"
            icon={KeyRound} label="AKTİF LİSANS"
            value={snapshot.licenses?.active ?? 0}
            accent="green"
          />
        </div>
      </div>

      {/* Companies row */}
      <div>
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <Building2 className="h-3 w-3" /> ŞİRKETLER & VERİTABANI
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            testid="monitoring-companies-total"
            icon={Building2} label="ŞİRKET" value={snapshot.companies?.total ?? 0} accent="cyan"
          />
          <MetricCard
            testid="monitoring-db-size"
            icon={Database} label="VERİ BOYUTU"
            value={`${db.data_size_mb ?? 0} MB`}
            accent="cyan"
            sub={`${db.objects || 0} kayıt · ${db.collections || 0} koleksiyon`}
          />
        </div>
      </div>

      {/* Errors row */}
      <div>
        <div className="hud-text text-sertex-danger mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> HATA İZLEME (SON 24s)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            testid="monitoring-errors-count"
            icon={AlertTriangle} label="HATA"
            value={totalErrors24h} accent="red"
            sub={`Toplam: ${(err.total?.ERROR || 0) + (err.total?.CRITICAL || 0)}`}
          />
          <MetricCard
            testid="monitoring-warnings-count"
            icon={AlertTriangle} label="UYARI"
            value={totalWarnings24h} accent="orange"
            sub={`Toplam: ${err.total?.WARNING || 0}`}
          />
        </div>
        {err.recent && err.recent.length > 0 && (
          <div className="mt-3 glass-panel corner-bracket p-3 border-sertex-danger/30" data-testid="monitoring-errors-list">
            <div className="hud-text text-sertex-danger mb-2 flex items-center gap-1.5">
              <Server className="h-3 w-3" /> SON HATALAR
            </div>
            <div className="space-y-1.5 max-h-48 overflow-y-auto scrollbar-sertex">
              {err.recent.slice().reverse().map((e, idx) => (
                <div
                  key={idx}
                  data-testid={`monitoring-error-row-${idx}`}
                  className="text-[11px] font-mono border-l-2 border-sertex-danger/60 pl-2"
                >
                  <div className="flex items-center gap-2">
                    <span className={`px-1 rounded text-[9px] font-semibold ${
                      e.level === "CRITICAL" ? "bg-sertex-danger/30 text-sertex-danger" : "bg-orange-400/20 text-orange-300"
                    }`}>{e.level}</span>
                    <span className="text-sertex-textMuted normal-case">{e.logger}</span>
                    <span className="text-sertex-textMuted normal-case ml-auto text-[10px]">
                      {new Date(e.ts).toLocaleTimeString()}
                    </span>
                  </div>
                  <div className="text-sertex-text mt-0.5 normal-case break-words">
                    {e.message}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Frontend (tarayıcı) hataları — Error Radar */}
      <div>
        <div className="hud-text text-orange-300 mb-2 flex items-center gap-1.5">
          <AlertTriangle className="h-3 w-3" /> FRONTEND HATALARI (TARAYICI)
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MetricCard
            testid="monitoring-client-errors-24h"
            icon={AlertTriangle} label="SON 24s"
            value={clientLogs?.last_24h ?? 0}
            accent={(clientLogs?.last_24h ?? 0) > 0 ? "red" : "green"}
            sub={`${clientLogs?.total ?? 0} toplam kayıt`}
          />
          <MetricCard
            testid="monitoring-client-errors-total"
            icon={Server} label="TOPLAM KAYIT"
            value={clientLogs?.total ?? 0} accent="orange"
          />
        </div>
        {clientLogs?.logs?.length > 0 ? (
          <div className="mt-3 glass-panel corner-bracket p-3 border-orange-400/30" data-testid="monitoring-client-logs-list">
            <div className="flex items-center justify-between mb-2">
              <div className="hud-text text-orange-300 flex items-center gap-1.5">
                <Server className="h-3 w-3" /> SON FRONTEND HATALARI
              </div>
              <button
                onClick={clearClientLogs}
                data-testid="monitoring-client-logs-clear"
                className="px-2 py-0.5 border border-orange-400/40 text-orange-300 hover:bg-orange-400/10 rounded hud-text transition-colors"
              >
                TEMİZLE
              </button>
            </div>
            <div className="space-y-1.5 max-h-56 overflow-y-auto scrollbar-sertex">
              {clientLogs.logs.map((e, idx) => (
                <div
                  key={e.id || idx}
                  data-testid={`monitoring-client-log-row-${idx}`}
                  className="text-[11px] font-mono border-l-2 border-orange-400/60 pl-2"
                >
                  <div className="flex items-center gap-2">
                    <span className="px-1 rounded text-[9px] font-semibold bg-sertex-cyan/15 text-sertex-cyan normal-case">
                      {e.username || "anonim"}
                    </span>
                    <span className="text-sertex-textMuted normal-case ml-auto text-[10px]">
                      {e.created_at ? new Date(e.created_at).toLocaleString() : ""}
                    </span>
                  </div>
                  <div className="text-sertex-text mt-0.5 normal-case break-words">
                    {e.message}
                  </div>
                  {e.page_url && (
                    <div className="text-sertex-textMuted/70 normal-case text-[10px] truncate mt-0.5">
                      {e.page_url}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            className="mt-2 text-[11px] font-mono text-sertex-textMuted normal-case text-center py-3 border border-sertex-cyan/10 rounded"
            data-testid="monitoring-client-logs-empty"
          >
            Frontend hatası kaydı yok — temiz.
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="text-[10px] font-mono text-sertex-textMuted normal-case text-center pt-1">
        Otomatik yenileme: 30 saniye
        {lastRefreshed && (
          <> · Son güncelleme: {lastRefreshed.toLocaleTimeString()}</>
        )}
      </div>
    </div>
  );
};

export default MonitoringDashboard;
