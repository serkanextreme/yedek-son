// Admin — Sertex sohbet sistem promptunu (TR/EN) düzenleme paneli.
// Boş bırakılırsa backend yerleşik varsayılana düşer. Hafıza/RAG bağlamı
// prompt'a otomatik eklenmeye devam eder.
import React, { useEffect, useState } from "react";
import { api } from "../lib/api";
import { toast } from "sonner";
import { MessageSquare, Save, RotateCcw, Loader2 } from "lucide-react";

const ChatPromptEditor = () => {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tr, setTr] = useState("");
  const [en, setEn] = useState("");
  const [defaults, setDefaults] = useState({ tr: "", en: "" });

  useEffect(() => {
    let cancel = false;
    api
      .get("/admin/chat-prompt")
      .then((r) => {
        if (cancel) return;
        setTr(r.data.tr || "");
        setEn(r.data.en || "");
        setDefaults({ tr: r.data.default_tr || "", en: r.data.default_en || "" });
      })
      .catch((e) => toast.error(e?.response?.data?.detail || "Prompt yüklenemedi"))
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, []);

  const save = async () => {
    setSaving(true);
    try {
      await api.put("/admin/chat-prompt", { tr: tr.trim(), en: en.trim() });
      toast.success("Sertex promptu kaydedildi");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 text-sertex-textMuted hud-text py-8 justify-center"
        data-testid="chat-prompt-loading"
      >
        <Loader2 className="h-4 w-4 animate-spin" /> Yükleniyor...
      </div>
    );
  }

  return (
    <div className="space-y-4" data-testid="chat-prompt-editor">
      <div className="hud-text text-sertex-textMuted normal-case tracking-normal text-[11px] leading-relaxed">
        Sertex'in kimliğini ve konuşma tarzını buradan belirleyin. Boş bırakırsanız
        yerleşik varsayılan kullanılır. Kullanıcı hafızası ve dosya bağlamı (RAG)
        prompta otomatik eklenir.
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="hud-text text-sertex-cyan flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> TÜRKÇE PROMPT
          </label>
          <button
            onClick={() => setTr(defaults.tr)}
            data-testid="chat-prompt-reset-tr"
            className="hud-text text-sertex-textMuted hover:text-sertex-cyan flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Varsayılan
          </button>
        </div>
        <textarea
          value={tr}
          onChange={(e) => setTr(e.target.value)}
          data-testid="chat-prompt-tr"
          rows={6}
          placeholder={defaults.tr}
          className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-3 py-2 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none resize-y"
        />
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <label className="hud-text text-sertex-cyan flex items-center gap-1.5">
            <MessageSquare className="h-3.5 w-3.5" /> ENGLISH PROMPT
          </label>
          <button
            onClick={() => setEn(defaults.en)}
            data-testid="chat-prompt-reset-en"
            className="hud-text text-sertex-textMuted hover:text-sertex-cyan flex items-center gap-1 transition-colors"
          >
            <RotateCcw className="h-3 w-3" /> Varsayılan
          </button>
        </div>
        <textarea
          value={en}
          onChange={(e) => setEn(e.target.value)}
          data-testid="chat-prompt-en"
          rows={6}
          placeholder={defaults.en}
          className="w-full bg-sertex-surface/60 border border-sertex-cyan/25 rounded-md px-3 py-2 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none resize-y"
        />
      </div>

      <button
        onClick={save}
        disabled={saving}
        data-testid="chat-prompt-save"
        className="w-full flex items-center justify-center gap-2 bg-sertex-cyan/15 border border-sertex-cyan/50 text-sertex-cyan hover:bg-sertex-cyan/25 rounded-md py-2 hud-text transition-colors disabled:opacity-50"
      >
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
        {saving ? "KAYDEDİLİYOR..." : "KAYDET"}
      </button>
    </div>
  );
};

export default ChatPromptEditor;
