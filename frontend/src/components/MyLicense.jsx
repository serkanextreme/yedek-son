import React, { useEffect, useState } from "react";
import { KeyRound, CheckCircle2, AlertTriangle, Clock, Copy, RefreshCw, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { licenseApi } from "../lib/api";

const LABEL = {
  trial: "Deneme (30 gün)",
  monthly: "Aylık",
  yearly: "Yıllık",
  lifetime: "Ömür Boyu",
  admin: "Yönetici (Sınırsız)",
};

const fmtDate = (iso) => {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const MyLicense = () => {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);
  const [redeeming, setRedeeming] = useState(false);
  const [newKey, setNewKey] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const s = await licenseApi.me();
      setStatus(s);
    } catch (e) {
      toast.error("Lisans bilgisi alınamadı");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const redeem = async () => {
    const k = newKey.trim().toUpperCase();
    if (!k.startsWith("SERTEX-") || k.length < 15) {
      toast.error("Geçersiz kod formatı");
      return;
    }
    setRedeeming(true);
    try {
      await licenseApi.redeem(k);
      toast.success("Yeni lisans aktive edildi!");
      setNewKey("");
      await load();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Kod kullanılamadı");
    } finally {
      setRedeeming(false);
    }
  };

  const daysLeft = status?.days_left;
  const isLifetime = status?.type === "lifetime";
  const isAdmin = status?.is_admin;
  const isExpiring = !isLifetime && !isAdmin && daysLeft !== null && daysLeft <= 7;

  const boxCls = `border rounded-md p-3 space-y-2 ${
    isExpiring
      ? "border-amber-300/50 bg-amber-300/5"
      : "border-sertex-cyan/25 bg-sertex-cyan/5"
  }`;

  return (
    <div className="space-y-3" data-testid="my-license-tab">
      <div className="flex items-center justify-between">
        <div className="hud-text text-sertex-cyan flex items-center gap-2">
          <KeyRound className="h-4 w-4" /> LİSANSIM
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded-md text-[10px] font-mono flex items-center gap-1"
        >
          <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} />
          Yenile
        </button>
      </div>

      {status && (
        <div className={boxCls} data-testid="license-status-card">
          <div className="flex items-center gap-2 flex-wrap">
            {status.has_license ? (
              <CheckCircle2 className="h-5 w-5 text-emerald-300" />
            ) : (
              <AlertTriangle className="h-5 w-5 text-rose-300" />
            )}
            <span className="text-sm font-mono text-sertex-text">
              {status.has_license
                ? `Aktif · ${LABEL[status.type] || status.type_label || status.type}`
                : "Aktif lisans yok"}
            </span>
          </div>

          {status.has_license && !isLifetime && !isAdmin && (
            <div className="flex items-center gap-1 text-xs font-mono">
              <Clock className="h-3 w-3 text-sertex-cyan" />
              <span
                className={
                  isExpiring ? "text-amber-300 font-bold" : "text-sertex-textMuted"
                }
              >
                {daysLeft} gün kaldı
              </span>
              {isExpiring && (
                <span className="text-amber-300">
                  · yakında yeni bir kod al!
                </span>
              )}
              <span className="text-sertex-textMuted ml-auto">
                bitiş: {fmtDate(status.expires_at)}
              </span>
            </div>
          )}

          {status.has_license && isLifetime && (
            <div className="text-xs font-mono text-emerald-300">
              ∞ Süresiz erişim
            </div>
          )}

          {status.has_license && isAdmin && (
            <div className="text-xs font-mono text-sertex-cyan">
              Yönetici hesabı — lisans kısıtlaması yok
            </div>
          )}

          {status.key && (
            <div className="flex items-center gap-2 pt-2 border-t border-sertex-cyan/20">
              <span className="text-[10px] font-mono text-sertex-textMuted">
                Kod:
              </span>
              <span
                className="text-[10px] font-mono text-sertex-cyan tracking-wider cursor-pointer"
                onClick={() => {
                  navigator.clipboard.writeText(status.key);
                  toast.success("Kopyalandı");
                }}
                data-testid="my-license-key"
              >
                {status.key}
              </span>
              <Copy
                className="h-3 w-3 text-sertex-textMuted hover:text-sertex-cyan cursor-pointer"
                onClick={() => {
                  navigator.clipboard.writeText(status.key);
                  toast.success("Kopyalandı");
                }}
              />
            </div>
          )}
        </div>
      )}

      {/* Redeem another / new key */}
      {!isAdmin && (
        <div className="border border-sertex-cyan/25 rounded-md p-3 space-y-2">
          <div className="hud-text text-sertex-cyan text-[11px]">
            {status?.has_license ? "YENİ KOD KULLAN" : "KOD AKTİVE ET"}
          </div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newKey}
              onChange={(e) =>
                setNewKey(
                  e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 32)
                )
              }
              onKeyDown={(e) => e.key === "Enter" && !redeeming && redeem()}
              placeholder="SERTEX-XXXX-XXXX-XXXX"
              spellCheck={false}
              className="flex-1 bg-sertex-surface border border-sertex-cyan/40 rounded-md px-2 py-1.5 text-xs font-mono text-sertex-cyan tracking-widest text-center focus:border-sertex-cyan outline-none"
              data-testid="my-license-input"
            />
            <button
              onClick={redeem}
              disabled={redeeming || !newKey}
              className="px-3 py-1.5 border border-sertex-cyan bg-sertex-cyan/10 hover:bg-sertex-cyan/20 disabled:opacity-40 rounded-md hud-text text-sertex-cyan flex items-center gap-1"
              data-testid="my-license-submit"
            >
              {redeeming ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <KeyRound className="h-3 w-3" />
              )}
              KULLAN
            </button>
          </div>
          {status?.has_license && (
            <div className="text-[10px] font-mono text-sertex-textMuted">
              Yeni bir kod aktive edersen, süresi eskisine EKLENMEZ — en yeni
              aktif kod baz alınır.
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MyLicense;
