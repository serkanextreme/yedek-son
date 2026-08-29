// Sertex — kombine özel süre girişi (Gün · Saat · Dk) + uygula butonu.
//
// Kullanıcı "2 saat 45 dk" veya "2 gün" gibi kendi süresini girer; toplam
// dakikaya çevrilip `onApply(totalMinutes)` ile üst bileşene verilir. Süresi
// Geçmiş Görev penceresi, hatırlatma toast'ı ve sağ-tık menüsünde ORTAK
// kullanılır ("her yerde").
import React, { useState } from "react";
import { toast } from "sonner";
import { Clock } from "lucide-react";

export const CustomSnoozeInput = ({ onApply, label = "Ertele", testPrefix = "custom-snooze" }) => {
  const [w, setW] = useState("");
  const [d, setD] = useState("");
  const [h, setH] = useState("");
  const [m, setM] = useState("");

  const stop = (e) => e.stopPropagation();

  const apply = (e) => {
    stop(e);
    const total =
      (parseInt(w || "0", 10) || 0) * 10080 +
      (parseInt(d || "0", 10) || 0) * 1440 +
      (parseInt(h || "0", 10) || 0) * 60 +
      (parseInt(m || "0", 10) || 0);
    if (!total || total <= 0) {
      toast.error("Hafta, gün, saat veya dakika girin");
      return;
    }
    onApply(total);
    setW("");
    setD("");
    setH("");
    setM("");
  };

  const inputCls =
    "w-11 bg-sertex-surface/60 border border-sertex-cyan/25 rounded px-1 py-1 text-[11px] font-mono text-sertex-text text-center focus:border-sertex-cyan outline-none";

  return (
    <div className="flex items-center gap-1 flex-wrap" data-testid={`${testPrefix}-row`}>
      <input
        type="number" min={0} placeholder="0" value={w}
        onChange={(e) => setW(e.target.value)} onClick={stop}
        data-testid={`${testPrefix}-weeks`} className={inputCls} title="Hafta"
      />
      <span className="hud-text text-sertex-textMuted">hafta</span>
      <input
        type="number" min={0} placeholder="0" value={d}
        onChange={(e) => setD(e.target.value)} onClick={stop}
        data-testid={`${testPrefix}-days`} className={inputCls} title="Gün"
      />
      <span className="hud-text text-sertex-textMuted">gün</span>
      <input
        type="number" min={0} placeholder="0" value={h}
        onChange={(e) => setH(e.target.value)} onClick={stop}
        data-testid={`${testPrefix}-hours`} className={inputCls} title="Saat"
      />
      <span className="hud-text text-sertex-textMuted">saat</span>
      <input
        type="number" min={0} placeholder="0" value={m}
        onChange={(e) => setM(e.target.value)} onClick={stop}
        data-testid={`${testPrefix}-mins`} className={inputCls} title="Dakika"
      />
      <span className="hud-text text-sertex-textMuted">dk</span>
      <button
        type="button" onClick={apply}
        data-testid={`${testPrefix}-apply`}
        className="px-2 py-1 border border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10 rounded text-[10px] font-mono flex items-center gap-1 transition-colors"
      >
        <Clock className="h-3 w-3" /> {label}
      </button>
    </div>
  );
};

export default CustomSnoozeInput;
