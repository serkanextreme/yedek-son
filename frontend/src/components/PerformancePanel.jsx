import React from "react";
import { Sparkles, Gauge, BatteryLow, Check, Cpu } from "lucide-react";
import { toast } from "sonner";
import { useSettings, setQuality, detectDeviceTier } from "../lib/settings";

/**
 * Performans / Görsellik seviyesi — kullanıcı kendi cihazına göre seçer.
 * Seçim cihaza özeldir (localStorage) ve anında uygulanır.
 * "Otomatik" = cihaz gücünü sezip uygun seviyeyi kendisi uygular (varsayılan).
 */

const TIER_LABEL = { high: "Kaliteli", normal: "Normal", low: "Düşük" };

const OPTIONS = [
  {
    key: "high",
    label: "Kaliteli Görüntü",
    icon: Sparkles,
    color: "text-sertex-cyan",
    border: "border-sertex-cyan",
    ring: "bg-sertex-cyan",
    desc: "Tam 3B holografik küre, en akıcı animasyon ve tüm efektler.",
    note: "Güçlü masaüstü / yeni cihazlar",
  },
  {
    key: "normal",
    label: "Normal Görüntü",
    icon: Gauge,
    color: "text-emerald-300",
    border: "border-emerald-400",
    ring: "bg-emerald-400",
    desc: "Dengeli mod: 30 FPS ve hafifletilmiş küre. Görsel neredeyse aynı, ekran kartı yükü ~%50 azalır.",
    note: "Çoğu cihaz için önerilir",
  },
  {
    key: "low",
    label: "Düşük Görüntü",
    icon: BatteryLow,
    color: "text-orange-300",
    border: "border-orange-400",
    ring: "bg-orange-400",
    desc: "3B küre kapalı (hafif parıltı) + sadeleştirilmiş cam efektleri. En düşük ekran kartı yükü.",
    note: "Eski / zayıf cihazlar, dizüstü pil tasarrufu",
  },
];

const PerformancePanel = () => {
  const { quality } = useSettings();
  const active = quality || "auto";
  const detected = detectDeviceTier();

  const pick = (k) => {
    if (k === active) return;
    setQuality(k);
    const label = k === "auto" ? "Otomatik" : OPTIONS.find((o) => o.key === k)?.label || k;
    toast.success(`Performans: ${label}`);
  };

  const autoOn = active === "auto";

  return (
    <div className="space-y-3" data-testid="performance-panel">
      <div className="glass-panel corner-bracket p-3 border-sertex-cyan/25">
        <div className="hud-text text-sertex-cyan flex items-center gap-1.5">
          <Gauge className="h-3 w-3" /> GÖRSELLİK / PERFORMANS
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case mt-1">
          Cihazınız çok ısınıyor veya yavaşlıyorsa daha düşük bir seviye seçin.
          Bu ayar yalnızca bu cihaz için geçerlidir ve anında uygulanır.
        </div>
      </div>

      {/* Otomatik (Önerilen) — cihaz gücünü sezer */}
      <button
        data-testid="perf-quality-auto"
        onClick={() => pick("auto")}
        className={`w-full text-left glass-panel corner-bracket p-4 border transition-colors ${
          autoOn ? "border-sertex-cyan bg-white/[0.04]" : "border-sertex-cyan/15 hover:border-sertex-cyan/40"
        }`}
      >
        <div className="flex items-center gap-3">
          <Cpu className={`h-6 w-6 shrink-0 ${autoOn ? "text-sertex-cyan" : "text-sertex-text"}`} />
          <div className="flex-1 min-w-0">
            <div className={`display-text tracking-wide ${autoOn ? "text-sertex-cyan" : "text-sertex-text"}`}>
              Otomatik <span className="text-[10px] font-mono opacity-70">(Önerilen)</span>
            </div>
            <div className="text-[11px] font-mono text-sertex-textMuted normal-case mt-1 leading-relaxed">
              Cihazınızın gücünü algılar ve en uygun seviyeyi kendisi seçer.
            </div>
            <div className="text-[10px] font-mono text-sertex-cyan/80 normal-case mt-1">
              ◈ Bu cihaz için algılanan: <b>{TIER_LABEL[detected] || detected}</b>
            </div>
          </div>
          <div
            className={`h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
              autoOn ? "border-sertex-cyan bg-sertex-cyan" : "border-sertex-cyan/30"
            }`}
          >
            {autoOn && <Check className="h-3 w-3 text-sertex-bg" strokeWidth={3} />}
          </div>
        </div>
      </button>

      <div className="hud-text text-sertex-textMuted/70 px-1">— veya elle seç —</div>

      {OPTIONS.map((o) => {
        const on = active === o.key;
        const Icon = o.icon;
        return (
          <button
            key={o.key}
            data-testid={`perf-quality-${o.key}`}
            onClick={() => pick(o.key)}
            className={`w-full text-left glass-panel corner-bracket p-4 border transition-colors ${
              on ? `${o.border} bg-white/[0.04]` : "border-sertex-cyan/15 hover:border-sertex-cyan/40"
            }`}
          >
            <div className="flex items-center gap-3">
              <Icon className={`h-6 w-6 shrink-0 ${o.color}`} />
              <div className="flex-1 min-w-0">
                <div className={`display-text tracking-wide ${on ? o.color : "text-sertex-text"}`}>
                  {o.label}
                </div>
                <div className="text-[11px] font-mono text-sertex-textMuted normal-case mt-1 leading-relaxed">
                  {o.desc}
                </div>
                <div className="text-[10px] font-mono text-sertex-textMuted/70 normal-case mt-1">
                  ◈ {o.note}
                </div>
              </div>
              <div
                className={`h-5 w-5 shrink-0 rounded-full border-2 flex items-center justify-center ${
                  on ? `${o.border} ${o.ring}` : "border-sertex-cyan/30"
                }`}
              >
                {on && <Check className="h-3 w-3 text-sertex-bg" strokeWidth={3} />}
              </div>
            </div>
          </button>
        );
      })}
    </div>
  );
};

export default PerformancePanel;
