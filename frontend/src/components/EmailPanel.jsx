import { confirmDialog } from "@/lib/confirm";
import React, { useEffect, useMemo, useState } from "react";
import {
  Mail,
  Plus,
  Trash2,
  Send,
  Loader2,
  RefreshCw,
  Inbox,
  Search,
  Eye,
  EyeOff,
  X,
  Reply,
  User,
  Paperclip,
  ChevronLeft,
  Check,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { emailApi } from "../lib/api";

const cardCls = "border border-sertex-cyan/20 rounded-md p-2.5 bg-sertex-cyan/5";

const fmtDate = (iso) => {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) {
      return d.toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit" });
    }
    return d.toLocaleDateString("tr-TR", { day: "2-digit", month: "short" });
  } catch {
    return iso;
  }
};

// ---------------- AddAccount Modal ---------------------------------------
const AddAccountForm = ({ providers, onCreated, onCancel }) => {
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    email: "",
    app_password: "",
    provider: "auto",
    label: "",
    imap_host: "",
    imap_port: "",
    smtp_host: "",
    smtp_port: "",
    smtp_mode: "starttls",
  });

  const isGeneric = form.provider === "generic";

  const submit = async () => {
    if (!form.email || !form.app_password) {
      toast.error("E-posta ve app-şifre zorunlu");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        email: form.email.trim(),
        app_password: form.app_password,
        label: form.label || undefined,
      };
      if (form.provider !== "auto") payload.provider = form.provider;
      if (isGeneric) {
        payload.imap_host = form.imap_host;
        payload.imap_port = Number(form.imap_port) || 993;
        payload.smtp_host = form.smtp_host;
        payload.smtp_port = Number(form.smtp_port) || 587;
        payload.smtp_mode = form.smtp_mode;
      }
      const acc = await emailApi.addAccount(payload);
      toast.success(`${acc.email} eklendi`);
      onCreated(acc);
    } catch (e) {
      const msg = e.response?.data?.detail || e.message || "Ekleme başarısız";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-2" data-testid="email-add-form">
      <div className="text-[10px] font-mono text-sertex-textMuted leading-relaxed p-2 border border-amber-400/30 bg-amber-400/5 rounded flex items-start gap-1.5">
        <Info className="h-3 w-3 text-amber-300 mt-0.5 shrink-0" />
        <div>
          <div className="text-amber-300">APP PASSWORD gerekli:</div>
          <div className="text-sertex-textSecondary">
            Gmail: Google Hesap → Güvenlik → 2FA → Uygulama Şifresi.<br />
            Outlook/Hotmail: Microsoft Hesap → Güvenlik → Gelişmiş → Uygulama Şifresi.<br />
            Normal şifren ÇALIŞMAZ.
          </div>
        </div>
      </div>

      <div className="text-[10px] font-mono leading-relaxed p-2 border border-rose-400/40 bg-rose-400/5 rounded flex items-start gap-1.5">
        <Info className="h-3 w-3 text-rose-300 mt-0.5 shrink-0" />
        <div>
          <div className="text-rose-300">HOTMAIL / OUTLOOK KULLANICILARI:</div>
          <div className="text-sertex-textSecondary">
            Microsoft, Eylül 2024'ten itibaren kişisel Hotmail/Outlook
            hesaplarında IMAP + App Password ile bağlantıyı kapattı.
            Şimdilik Gmail hesabı kullanmanız gerekir (veya Microsoft OAuth
            entegrasyonunun eklenmesini talep edin).
          </div>
        </div>
      </div>

      <div className="grid gap-1.5">
        <label className="text-[10px] font-mono text-sertex-textMuted">E-POSTA</label>
        <input
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
          placeholder="ornek@hotmail.com"
          className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-input"
        />
      </div>

      <div className="grid gap-1.5">
        <label className="text-[10px] font-mono text-sertex-textMuted">APP PASSWORD (16 hane)</label>
        <input
          type="password"
          value={form.app_password}
          onChange={(e) => setForm({ ...form, app_password: e.target.value })}
          placeholder="xxxxxxxxxxxxxxxx"
          className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-password-input"
        />
      </div>

      <div className="grid gap-1.5">
        <label className="text-[10px] font-mono text-sertex-textMuted">SAĞLAYICI</label>
        <select
          value={form.provider}
          onChange={(e) => setForm({ ...form, provider: e.target.value })}
          className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-provider-select"
        >
          <option value="auto">Otomatik (adresten tahmin)</option>
          {providers.map((p) => (
            <option key={p.key} value={p.key}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {isGeneric && (
        <div className="space-y-1.5 border border-sertex-cyan/20 rounded p-2 bg-sertex-bg/30">
          <div className="text-[10px] font-mono text-sertex-cyan">ÖZEL SUNUCU AYARLARI</div>
          <div className="grid grid-cols-2 gap-1.5">
            <input
              placeholder="IMAP host"
              value={form.imap_host}
              onChange={(e) => setForm({ ...form, imap_host: e.target.value })}
              className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
            <input
              placeholder="IMAP port (993)"
              value={form.imap_port}
              onChange={(e) => setForm({ ...form, imap_port: e.target.value })}
              className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
            <input
              placeholder="SMTP host"
              value={form.smtp_host}
              onChange={(e) => setForm({ ...form, smtp_host: e.target.value })}
              className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
            <input
              placeholder="SMTP port (587)"
              value={form.smtp_port}
              onChange={(e) => setForm({ ...form, smtp_port: e.target.value })}
              className="bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            />
          </div>
          <select
            value={form.smtp_mode}
            onChange={(e) => setForm({ ...form, smtp_mode: e.target.value })}
            className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          >
            <option value="starttls">STARTTLS (587)</option>
            <option value="tls">SSL/TLS (465)</option>
          </select>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <button
          onClick={submit}
          disabled={saving}
          className="flex-1 py-1.5 border border-sertex-cyan/40 bg-sertex-cyan/10 hover:bg-sertex-cyan/20 rounded text-xs hud-text text-sertex-cyan flex items-center justify-center gap-1 transition-colors disabled:opacity-50"
          data-testid="email-add-submit"
        >
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
          {saving ? "BAĞLANIYOR..." : "EKLE + TEST ET"}
        </button>
        <button
          onClick={onCancel}
          disabled={saving}
          className="px-3 py-1.5 border border-sertex-cyan/25 rounded text-xs hud-text text-sertex-textMuted hover:text-sertex-cyan disabled:opacity-50"
        >
          İPTAL
        </button>
      </div>
    </div>
  );
};

// ---------------- Compose Modal ------------------------------------------
const ComposeForm = ({ account, initial = {}, onClose, onSent }) => {
  const [sending, setSending] = useState(false);
  const [form, setForm] = useState({
    to: initial.to || "",
    cc: initial.cc || "",
    subject: initial.subject || "",
    body_text: initial.body_text || "",
  });

  const send = async () => {
    const toList = form.to.split(",").map((s) => s.trim()).filter(Boolean);
    if (toList.length === 0) return toast.error("Alıcı gerekli");
    setSending(true);
    try {
      const payload = {
        to: toList,
        cc: form.cc.split(",").map((s) => s.trim()).filter(Boolean),
        subject: form.subject,
        body_text: form.body_text,
      };
      await emailApi.send(account.id, payload);
      toast.success("Gönderildi");
      onSent?.();
      onClose();
    } catch (e) {
      toast.error(e.response?.data?.detail || "Gönderim başarısız");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4" data-testid="email-compose-modal">
      <div className="max-w-2xl w-full glass-panel border border-sertex-cyan/40 rounded-lg p-4 space-y-2">
        <div className="flex items-center justify-between border-b border-sertex-cyan/20 pb-2">
          <div className="hud-text text-sertex-cyan text-sm">
            <Mail className="inline h-3 w-3 mr-1" />
            YENİ E-POSTA — <span className="text-sertex-textSecondary">{account.email}</span>
          </div>
          <button onClick={onClose} className="text-sertex-textMuted hover:text-sertex-cyan">
            <X className="h-4 w-4" />
          </button>
        </div>
        <input
          placeholder="Kime: virgülle ayırın"
          value={form.to}
          onChange={(e) => setForm({ ...form, to: e.target.value })}
          className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-compose-to"
        />
        <input
          placeholder="CC: (opsiyonel)"
          value={form.cc}
          onChange={(e) => setForm({ ...form, cc: e.target.value })}
          className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-compose-cc"
        />
        <input
          placeholder="Konu"
          value={form.subject}
          onChange={(e) => setForm({ ...form, subject: e.target.value })}
          className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-compose-subject"
        />
        <textarea
          placeholder="Mesaj..."
          rows={10}
          value={form.body_text}
          onChange={(e) => setForm({ ...form, body_text: e.target.value })}
          className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1.5 text-sm font-mono text-sertex-text focus:border-sertex-cyan outline-none resize-y"
          data-testid="email-compose-body"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 border border-sertex-cyan/25 rounded text-xs hud-text text-sertex-textMuted hover:text-sertex-cyan"
          >
            İPTAL
          </button>
          <button
            onClick={send}
            disabled={sending}
            className="px-4 py-1.5 border border-sertex-cyan/40 bg-sertex-cyan/10 hover:bg-sertex-cyan/20 rounded text-xs hud-text text-sertex-cyan flex items-center gap-1 disabled:opacity-50"
            data-testid="email-compose-send"
          >
            {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
            {sending ? "GÖNDERİLİYOR..." : "GÖNDER"}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------- Message viewer -----------------------------------------
const MessageViewer = ({ account, folder, uid, onBack, onReply }) => {
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    emailApi
      .message(account.id, folder, uid)
      .then((m) => alive && setMsg(m))
      .catch((e) =>
        toast.error(e.response?.data?.detail || "Mesaj yüklenemedi")
      )
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [account.id, folder, uid]);

  return (
    <div className="space-y-2" data-testid="email-msg-viewer">
      <div className="flex items-center gap-2">
        <button
          onClick={onBack}
          className="p-1 border border-sertex-cyan/25 rounded text-sertex-cyan hover:bg-sertex-cyan/10"
          data-testid="email-msg-back"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
        </button>
        <div className="flex-1 min-w-0 hud-text text-sertex-cyan truncate">
          {msg?.subject || "..."}
        </div>
        <button
          onClick={() =>
            onReply({
              to: msg?.from || "",
              subject: msg?.subject?.startsWith("Re:") ? msg.subject : `Re: ${msg?.subject || ""}`,
              body_text: `\n\n---\n${msg?.from || ""}, ${fmtDate(msg?.date)}:\n> ${(msg?.text || "").split("\n").join("\n> ")}`,
            })
          }
          className="p-1 border border-sertex-cyan/25 rounded text-sertex-cyan hover:bg-sertex-cyan/10"
          data-testid="email-msg-reply"
          title="Yanıtla"
        >
          <Reply className="h-3.5 w-3.5" />
        </button>
      </div>
      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-sertex-cyan" />
        </div>
      ) : msg ? (
        <div className={`${cardCls} space-y-2`}>
          <div className="text-[10px] font-mono text-sertex-textMuted space-y-0.5">
            <div><span className="text-sertex-cyan">Kimden:</span> {msg.from}</div>
            <div><span className="text-sertex-cyan">Kime:</span> {(msg.to || []).join(", ")}</div>
            {msg.cc?.length > 0 && (
              <div><span className="text-sertex-cyan">CC:</span> {msg.cc.join(", ")}</div>
            )}
            <div><span className="text-sertex-cyan">Tarih:</span> {msg.date}</div>
          </div>
          {msg.attachments?.length > 0 && (
            <div className="text-[10px] font-mono text-amber-300 flex items-center gap-1">
              <Paperclip className="h-3 w-3" />
              {msg.attachments.length} ek
            </div>
          )}
          <div className="border-t border-sertex-cyan/20 pt-2">
            {msg.text ? (
              <pre className="text-xs font-mono text-sertex-text whitespace-pre-wrap break-words max-h-[50vh] overflow-y-auto scrollbar-sertex">
                {msg.text}
              </pre>
            ) : msg.html ? (
              <div
                className="text-xs text-sertex-text prose prose-invert max-w-none max-h-[50vh] overflow-y-auto scrollbar-sertex"
                dangerouslySetInnerHTML={{ __html: msg.html }}
              />
            ) : (
              <div className="text-xs text-sertex-textMuted">(Boş içerik)</div>
            )}
          </div>
        </div>
      ) : (
        <div className="text-xs text-sertex-textMuted">Mesaj yüklenemedi</div>
      )}
    </div>
  );
};

// ---------------- Main Panel ---------------------------------------------
const EmailPanel = ({ onDataChanged }) => {
  const [providers, setProviders] = useState([]);
  const [accounts, setAccounts] = useState([]);
  const [selectedAccountId, setSelectedAccountId] = useState(null);
  const [messages, setMessages] = useState([]);
  const [openUid, setOpenUid] = useState(null); // when viewing single message
  const [loading, setLoading] = useState(false);
  const [addingAccount, setAddingAccount] = useState(false);
  const [composing, setComposing] = useState(null); // {initial}
  const [q, setQ] = useState("");
  const [unreadOnly, setUnreadOnly] = useState(false);

  const selected = useMemo(
    () => accounts.find((a) => a.id === selectedAccountId) || null,
    [accounts, selectedAccountId]
  );

  const loadProviders = async () => {
    try {
      setProviders(await emailApi.providers());
    } catch (e) { console.warn("[EmailPanel.jsx] hata bastırıldı:", e); }
  };

  const loadAccounts = async () => {
    try {
      const list = await emailApi.listAccounts();
      setAccounts(list);
      if (!selectedAccountId && list.length > 0) setSelectedAccountId(list[0].id);
      if (selectedAccountId && !list.find((a) => a.id === selectedAccountId)) {
        setSelectedAccountId(list[0]?.id || null);
      }
    } catch (e) {
      toast.error("Hesap listesi yüklenemedi");
    }
  };

  useEffect(() => {
    loadProviders();
    loadAccounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadInbox = async () => {
    if (!selectedAccountId) return;
    setLoading(true);
    try {
      const r = await emailApi.messages(selectedAccountId, {
        folder: "INBOX",
        limit: 30,
        q,
        unread_only: unreadOnly,
      });
      setMessages(r.messages || []);
    } catch (e) {
      toast.error(e.response?.data?.detail || "E-postalar alınamadı");
      setMessages([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (selectedAccountId) {
      setOpenUid(null);
      loadInbox();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId]);

  const removeAccount = async (id) => {
    if (!(await confirmDialog({ message: "Bu e-posta hesabını silmek istiyor musun?", danger: true }))) return;
    try {
      await emailApi.deleteAccount(id);
      toast.success("Silindi");
      await loadAccounts();
      onDataChanged?.();
    } catch (e) {
      toast.error("Silinemedi");
    }
  };

  const toggleSeen = async (m) => {
    try {
      await emailApi.markSeen(selectedAccountId, "INBOX", [m.uid], !m.seen);
      setMessages((prev) =>
        prev.map((x) => (x.uid === m.uid ? { ...x, seen: !m.seen } : x))
      );
    } catch (e) {
      toast.error("Güncellenemedi");
    }
  };

  const deleteMsg = async (m) => {
    if (!(await confirmDialog({ message: "Bu e-postayı silmek istiyor musun?", danger: true }))) return;
    try {
      await emailApi.deleteMessages(selectedAccountId, "INBOX", [m.uid]);
      setMessages((prev) => prev.filter((x) => x.uid !== m.uid));
      toast.success("Silindi");
    } catch (e) {
      toast.error("Silinemedi");
    }
  };

  // ---------- Empty state / add-account form ------------------------------
  if (accounts.length === 0 && !addingAccount) {
    return (
      <div className="text-center py-6 space-y-3" data-testid="email-empty">
        <Mail className="h-8 w-8 mx-auto text-sertex-cyan/50" />
        <div className="hud-text text-sertex-textMuted">Kayıtlı e-posta hesabın yok</div>
        <button
          onClick={() => setAddingAccount(true)}
          className="mx-auto py-1.5 px-3 border border-sertex-cyan/40 bg-sertex-cyan/10 hover:bg-sertex-cyan/20 rounded text-xs hud-text text-sertex-cyan flex items-center gap-1 transition-colors"
          data-testid="email-add-first"
        >
          <Plus className="h-3.5 w-3.5" /> HESAP EKLE
        </button>
      </div>
    );
  }

  if (addingAccount) {
    return (
      <div className="space-y-2" data-testid="email-add-panel">
        <div className="hud-text text-sertex-cyan text-sm border-b border-sertex-cyan/20 pb-2">
          E-POSTA HESABI EKLE
        </div>
        <AddAccountForm
          providers={providers}
          onCreated={async () => {
            setAddingAccount(false);
            await loadAccounts();
            onDataChanged?.();
          }}
          onCancel={() => setAddingAccount(false)}
        />
      </div>
    );
  }

  // ---------- Main panel --------------------------------------------------
  return (
    <div className="space-y-2" data-testid="email-panel">
      {/* Account selector */}
      <div className="flex items-center gap-1.5">
        <select
          value={selectedAccountId || ""}
          onChange={(e) => setSelectedAccountId(e.target.value)}
          className="flex-1 min-w-0 bg-sertex-surface border border-sertex-cyan/25 rounded px-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
          data-testid="email-account-select"
        >
          {accounts.map((a) => (
            <option key={a.id} value={a.id}>
              {a.email} {a.label ? `· ${a.label}` : ""}
            </option>
          ))}
        </select>
        <button
          onClick={() => setAddingAccount(true)}
          title="Yeni hesap ekle"
          className="p-1 border border-sertex-cyan/25 rounded text-sertex-cyan hover:bg-sertex-cyan/10"
          data-testid="email-add-account-btn"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
        {selected && (
          <button
            onClick={() => removeAccount(selected.id)}
            title="Bu hesabı sil"
            className="p-1 border border-rose-400/30 rounded text-rose-300 hover:bg-rose-400/10"
            data-testid="email-remove-account-btn"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      {/* Compose + Toolbar */}
      <div className="flex items-center gap-1.5">
        <button
          onClick={() => setComposing({ initial: {} })}
          className="flex-1 py-1.5 border border-sertex-cyan/40 bg-sertex-cyan/10 hover:bg-sertex-cyan/20 rounded text-xs hud-text text-sertex-cyan flex items-center justify-center gap-1 transition-colors"
          data-testid="email-compose-btn"
        >
          <Send className="h-3.5 w-3.5" /> YENİ E-POSTA
        </button>
        <button
          onClick={loadInbox}
          disabled={loading}
          title="Yenile"
          className="p-1.5 border border-sertex-cyan/25 rounded text-sertex-cyan hover:bg-sertex-cyan/10 disabled:opacity-40"
          data-testid="email-refresh-btn"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
        </button>
      </div>

      {/* Filter row */}
      <div className="flex items-center gap-1.5">
        <div className="flex-1 relative">
          <Search className="h-3 w-3 absolute left-1.5 top-1/2 -translate-y-1/2 text-sertex-textMuted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && loadInbox()}
            placeholder="Ara..."
            className="w-full bg-sertex-surface border border-sertex-cyan/25 rounded pl-6 pr-2 py-1 text-xs font-mono text-sertex-text focus:border-sertex-cyan outline-none"
            data-testid="email-search-input"
          />
        </div>
        <label className="flex items-center gap-1 text-[10px] font-mono text-sertex-textMuted cursor-pointer">
          <input
            type="checkbox"
            checked={unreadOnly}
            onChange={(e) => setUnreadOnly(e.target.checked)}
            data-testid="email-unread-only"
          />
          Okunmamış
        </label>
      </div>

      {/* Inbox list or message viewer */}
      {openUid ? (
        <MessageViewer
          account={selected}
          folder="INBOX"
          uid={openUid}
          onBack={() => {
            setOpenUid(null);
            loadInbox();
          }}
          onReply={(initial) => {
            setOpenUid(null);
            setComposing({ initial });
          }}
        />
      ) : loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-5 w-5 animate-spin text-sertex-cyan" />
        </div>
      ) : messages.length === 0 ? (
        <div className="text-center py-6 hud-text text-sertex-textMuted">
          <Inbox className="h-6 w-6 mx-auto mb-2 opacity-50" /> Boş
        </div>
      ) : (
        <div className="space-y-1.5">
          {messages.map((m) => (
            <div
              key={m.uid}
              className={`${cardCls} cursor-pointer group hover:border-sertex-cyan/60 transition-colors ${
                !m.seen ? "border-sertex-cyan/60 bg-sertex-cyan/10" : ""
              }`}
              onClick={() => setOpenUid(m.uid)}
              data-testid={`email-msg-${m.uid}`}
            >
              <div className="flex items-start gap-2">
                <User
                  className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${!m.seen ? "text-sertex-cyan" : "text-sertex-textMuted"}`}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <div className={`text-xs font-mono truncate ${!m.seen ? "text-sertex-cyan font-bold" : "text-sertex-textSecondary"}`}>
                      {m.from_name || m.from}
                    </div>
                    <div className="text-[9px] font-mono text-sertex-textMuted shrink-0">{fmtDate(m.date)}</div>
                  </div>
                  <div className={`text-xs font-mono truncate ${!m.seen ? "text-sertex-text" : "text-sertex-textMuted"}`}>
                    {m.subject || "(Konu yok)"}
                  </div>
                  {m.attachments?.length > 0 && (
                    <div className="text-[9px] font-mono text-amber-300 mt-0.5 flex items-center gap-0.5">
                      <Paperclip className="h-2.5 w-2.5" /> {m.attachments.length}
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSeen(m);
                    }}
                    title={m.seen ? "Okunmamış yap" : "Okundu yap"}
                    className="text-sertex-textMuted hover:text-sertex-cyan"
                    data-testid={`email-toggle-seen-${m.uid}`}
                  >
                    {m.seen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteMsg(m);
                    }}
                    title="Sil"
                    className="text-sertex-textMuted hover:text-sertex-danger"
                    data-testid={`email-delete-${m.uid}`}
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {composing && selected && (
        <ComposeForm
          account={selected}
          initial={composing.initial}
          onClose={() => setComposing(null)}
          onSent={loadInbox}
        />
      )}
    </div>
  );
};

export default EmailPanel;
