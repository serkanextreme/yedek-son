import React, { useEffect, useState } from "react";
import { LayoutTemplate, Plus, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { templatesApi } from "../../lib/api";

// "Şablondan Başla" çubuğu — Yeni Görev alanının yanında. Şablonlar seçilebilir
// çip olarak gelir; tıklanınca o şablondan görev oluşturulur (instantiate) ve
// düzenleme penceresi açılır. "Şablonlar" düğmesi kütüphaneyi açar.
export const TemplateBar = ({ refreshKey = 0, onUse, onManage }) => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [usingId, setUsingId] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    templatesApi.list()
      .then((r) => alive && setItems(Array.isArray(r) ? r : []))
      .catch(() => alive && setItems([]))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [refreshKey]);

  const use = async (t) => {
    setUsingId(t.id);
    try {
      const task = await templatesApi.instantiate(t.id);
      toast.success(`"${t.name}" şablonundan görev oluşturuldu — düzenleyin`);
      onUse?.(task);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Oluşturulamadı");
    } finally {
      setUsingId(null);
    }
  };

  return (
    <div className="flex items-center gap-2 flex-wrap" data-testid="template-bar">
      <span className="hud-text text-sertex-textMuted/80 shrink-0 flex items-center gap-1">
        <LayoutTemplate className="h-3.5 w-3.5" /> ŞABLONDAN BAŞLA:
      </span>
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 text-sertex-cyan animate-spin" />
      ) : (
        items.slice(0, 8).map((t) => (
          <button
            key={t.id}
            onClick={() => use(t)}
            disabled={usingId === t.id}
            data-testid={`template-chip-${t.id}`}
            title={t.title || t.name}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/15 hover:border-sertex-cyan text-[11px] font-mono transition-colors disabled:opacity-40"
          >
            {usingId === t.id && <Loader2 className="h-3 w-3 animate-spin" />}
            {t.name}
          </button>
        ))
      )}
      {!loading && items.length === 0 && (
        <span className="hud-text text-sertex-textMuted/60">henüz şablon yok</span>
      )}
      <button
        onClick={onManage}
        data-testid="template-manage-btn"
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full border border-sertex-textMuted/30 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50 text-[11px] font-mono transition-colors"
      >
        <Plus className="h-3 w-3" /> Şablonlar
      </button>
    </div>
  );
};

export default TemplateBar;
