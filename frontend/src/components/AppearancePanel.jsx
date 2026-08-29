import React, { useRef } from "react";
import { Palette, Type, LayoutGrid, Check, RotateCcw, Lock } from "lucide-react";
import { toast } from "sonner";
import {
  useAppearance,
  setAccent,
  resetAccent,
  setFontScale,
  setInterfaceMode,
  ACCENT_PRESETS,
  FONT_SCALES,
  INTERFACES,
  DEFAULT_ACCENT,
} from "../lib/appearance";

/**
 * Görünüm ayarları — Ayarlar → Temalar → ARAYÜZ.
 *   1) ARAYÜZ  : adlandırılmış düzen seçici ("Detaylı" varsayılan/aktif)
 *   2) VURGU RENGİ : tüm arayüzün ana rengini değiştir (renk fonksiyonu)
 *   3) YAZI BOYUTU : kök rem ölçeği → tüm metin orantılı büyür
 * Seçimler cihaza özeldir (localStorage) ve anında uygulanır.
 */
const AppearancePanel = () => {
  const { accent, fontScale, interface: iface } = useAppearance();
  const colorInputRef = useRef(null);
  const isCustomAccent = !ACCENT_PRESETS.some((p) => p.value.toLowerCase() === (accent || "").toLowerCase());

  const pickInterface = (opt) => {
    if (!opt.ready) {
      toast("“" + opt.name + "” arayüzü hazırlanıyor — çok yakında", { duration: 2200 });
      return;
    }
    if (opt.key === iface) return;
    setInterfaceMode(opt.key);
    toast.success(`Arayüz: ${opt.name}`);
  };

  return (
    <div className="space-y-5" data-testid="appearance-panel">
      {/* ---- ARAYÜZ ---- */}
      <div>
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <LayoutGrid className="h-3.5 w-3.5" /> ARAYÜZ
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case mb-2 leading-relaxed">
          Uygulamayı hangi görünümde kullanmak istersin? “Detaylı” mevcut zengin
          görünümdür (varsayılan). Diğer görünümler sırayla ekleniyor.
        </div>
        <div className="grid grid-cols-1 gap-1.5">
          {INTERFACES.map((opt) => {
            const active = iface === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => pickInterface(opt)}
                data-testid={`interface-${opt.key}`}
                className={`w-full text-left p-3 rounded-md border transition-colors ${
                  active
                    ? "border-sertex-cyan bg-sertex-cyan/10"
                    : opt.ready
                    ? "border-sertex-cyan/25 hover:border-sertex-cyan/60"
                    : "border-sertex-textMuted/20 opacity-70 hover:opacity-90"
                }`}
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className={`hud-text ${active ? "text-sertex-cyan neon-glow" : "text-sertex-text"}`}>
                    {opt.name.toUpperCase()}
                  </span>
                  {active && (
                    <span className="ml-auto flex items-center gap-1 text-[10px] font-mono text-sertex-cyan">
                      <Check className="h-3 w-3" /> AKTİF
                    </span>
                  )}
                  {!opt.ready && !active && (
                    <span className="ml-auto flex items-center gap-1 text-[9px] font-mono text-amber-300/80 border border-amber-300/30 rounded px-1.5 py-0.5">
                      <Lock className="h-2.5 w-2.5" /> YAKINDA
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-sertex-textMuted normal-case leading-relaxed">
                  {opt.desc}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ---- VURGU RENGİ ---- */}
      <div className="pt-4 border-t border-sertex-cyan/15">
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5" /> VURGU RENGİ
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case mb-2 leading-relaxed">
          Arayüzün ana rengini beğenmediysen buradan değiştir — tüm butonlar,
          çerçeveler ve vurgular anında yeni rengi alır.
        </div>
        <div className="flex flex-wrap items-center gap-2" data-testid="accent-swatches">
          {ACCENT_PRESETS.map((p) => {
            const on = (accent || "").toLowerCase() === p.value.toLowerCase();
            return (
              <button
                key={p.value}
                type="button"
                onClick={() => { setAccent(p.value); toast.success(`Renk: ${p.name}`); }}
                data-testid={`accent-${p.value.replace("#", "").toLowerCase()}`}
                title={p.name}
                className={`h-8 w-8 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 ${
                  on ? "border-white" : "border-transparent"
                }`}
                style={{ background: p.value, boxShadow: `0 0 10px ${p.value}` }}
              >
                {on && <Check className="h-4 w-4 text-black" strokeWidth={3} />}
              </button>
            );
          })}

          {/* Özel renk seçici */}
          <button
            type="button"
            onClick={() => colorInputRef.current?.click()}
            data-testid="accent-custom-open"
            title="Özel renk seç"
            className={`h-8 w-8 rounded-full border-2 flex items-center justify-center transition-transform hover:scale-110 ${
              isCustomAccent ? "border-white" : "border-sertex-textMuted/50"
            }`}
            style={{
              background: isCustomAccent ? accent : "conic-gradient(from 0deg, #ff3b5c, #ffc53d, #00ff88, #00f0ff, #3b82f6, #b96bff, #ff4fd8, #ff3b5c)",
            }}
          >
            {isCustomAccent && <Check className="h-4 w-4 text-black" strokeWidth={3} />}
          </button>
          <input
            ref={colorInputRef}
            type="color"
            value={accent || DEFAULT_ACCENT}
            onChange={(e) => setAccent(e.target.value)}
            data-testid="accent-custom-input"
            className="sr-only"
            aria-label="Özel vurgu rengi"
          />

          {(accent || "").toLowerCase() !== DEFAULT_ACCENT.toLowerCase() && (
            <button
              type="button"
              onClick={() => { resetAccent(); toast.success("Renk varsayılana döndü"); }}
              data-testid="accent-reset"
              title="Varsayılan renge dön"
              className="ml-1 h-8 px-2 rounded-md border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 flex items-center gap-1 hud-text transition-colors"
            >
              <RotateCcw className="h-3 w-3" /> SIFIRLA
            </button>
          )}
        </div>
      </div>

      {/* ---- YAZI BOYUTU ---- */}
      <div className="pt-4 border-t border-sertex-cyan/15">
        <div className="hud-text text-sertex-cyan mb-2 flex items-center gap-1.5">
          <Type className="h-3.5 w-3.5" /> YAZI BOYUTU
        </div>
        <div className="text-[11px] font-mono text-sertex-textMuted normal-case mb-2 leading-relaxed">
          Yazılar küçük geliyorsa büyüt. Tüm uygulamadaki metinler orantılı
          olarak değişir.
        </div>
        <div className="grid grid-cols-4 gap-1.5" data-testid="fontscale-options">
          {FONT_SCALES.map((f) => {
            const on = fontScale === f.key;
            return (
              <button
                key={f.key}
                type="button"
                onClick={() => { setFontScale(f.key); toast.success(`Yazı boyutu: ${f.label}`); }}
                data-testid={`fontscale-${f.key}`}
                className={`py-2 rounded-md border transition-colors flex flex-col items-center gap-0.5 ${
                  on ? "border-sertex-cyan bg-sertex-cyan/10 text-sertex-cyan" : "border-sertex-cyan/25 text-sertex-textMuted hover:border-sertex-cyan/60 hover:text-sertex-text"
                }`}
              >
                <span style={{ fontSize: `${f.px}px`, lineHeight: 1 }} className="font-mono">Aa</span>
                <span className="text-[9px] font-mono normal-case">{f.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-2 glass-panel border-sertex-cyan/20 p-2.5 rounded-md" data-testid="fontscale-preview">
          <div className="text-sertex-text">Örnek: Bugünkü görevlerin hazır.</div>
          <div className="hud-text text-sertex-textMuted mt-1">ÖNİZLEME METNİ · 12.06.2026</div>
        </div>
      </div>
    </div>
  );
};

export default AppearancePanel;
