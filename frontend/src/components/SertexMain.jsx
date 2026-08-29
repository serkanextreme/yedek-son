import React, { useEffect, useRef, useState } from "react";
import { Toaster, toast } from "sonner";
import HolographicSphere from "./HolographicSphere";
import { TopLeftHUD, TopRightHUD, BottomLeftHUD } from "./HUDOverlay";
import ChatMessages from "./ChatMessages";
import InputBar from "./InputBar";
import Sidebar from "./Sidebar";
import DetachedPanelsHost from "./DetachedPanelsHost";
import ReminderWatcher from "./ReminderWatcher";
import SettingsPanel from "./SettingsPanel";
import RedeemScreen from "./RedeemScreen";
import OverdueAlertModal from "./OverdueAlertModal";
import AnnouncementBanner from "./AnnouncementBanner";
// Faz 9 CP8 — Mobile-first responsive.
import MobileBottomNav from "./MobileBottomNav";
import { useIsMobile } from "../lib/useResponsive";
import KolayInterface from "./KolayInterface";
import ProfesyonelInterface from "./ProfesyonelInterface";
import TeknikInterface from "./TeknikInterface";
import AydinlikInterface from "./AydinlikInterface";
import PanoInterface from "./PanoInterface";
import { useAppearance } from "../lib/appearance";
import { chatApi, ttsApi, memoryApi } from "../lib/api";
import { t } from "../lib/i18n";
import { useAuth } from "../lib/auth";
import { initReminderAudio } from "../lib/reminderChime";
import { ArrowLeft, Eye } from "lucide-react";
import {
  createWakeWordListener,
  isWakeWordSupported,
  loadWakeSettings,
  saveWakeSettings,
} from "../lib/wakeWord";

// Detect manual/forget triggers to avoid double feedback with backend's own reply.
const MEMORY_TRIGGER_RE = /^(sertex[,\s]+)?(bunu\s+|şunu\s+)?(hatırla|hatırlaman?\s+gerekli?|not\s+et|aklında\s+tut|kaydet|unut|sil|forget|remember|note\s+that|keep\s+in\s+mind)/i;
const isMemoryTrigger = (text) => MEMORY_TRIGGER_RE.test((text || "").trim());

const SertexMain = () => {
  // NOTE (Faz 9 CP4.1 — Panel-drift bug fix, 2026-07-26): the previous version
  // observed chip-stack size changes and pushed any visible panel that
  // overlapped the chip-stack area DOWNWARD by dispatching
  // `sertex:shift-down-{id}` events. That produced a cumulative +5 px drift
  // every hide → restore cycle for panels sitting near the top-left corner
  // (localStorage kept the drifted y, so the panel eventually slid off-screen
  // and had to be recovered via "Pencere Konumlarını Sıfırla"). Chip-stack
  // containers are already `pointer-events: none` and only ~28 px tall — they
  // don't functionally block panels — so this auto-shift served no purpose
  // and violated the user's explicit rule ("panels stay where the user placed
  // them"). Effect removed entirely; nothing consumed the `--sx-chip-*` CSS
  // vars it also set.

  const lang = "tr"; // Türkçe sabit
  const { user, stopImpersonating } = useAuth();
  const [messages, setMessages] = useState([]);
  const [conversationId, setConversationId] = useState(null);
  const [state, setState] = useState("idle");
  const [listening, setListening] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState("on");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Faz 9 CP8 — Mobile detection + which sidebar section the bottom nav
  // has focused. On desktop `activeMobileSection` is ignored; on mobile we
  // dispatch a CustomEvent to the sidebar to switch its inner tab and
  // ensure the drawer is open so the section is actually visible.
  const isMobile = useIsMobile();
  // Görünüm modu (Ayarlar → Temalar → ARAYÜZ). "kolay" → sade görev panosu.
  const { interface: appInterface } = useAppearance();
  const kolayMode = appInterface === "kolay";
  const profMode = appInterface === "profesyonel";
  const teknikMode = appInterface === "teknik";
  const aydinlikMode = appInterface === "aydinlik";
  const panoMode = appInterface === "pano";
  // Sade modlar = Detaylı dışındaki tüm arayüzler (küre/HUD/sohbet gizli,
  // sidebar kapalı, alternatif arayüz görünür).
  const simpleMode = !!appInterface && appInterface !== "detayli";
  const [activeMobileSection, setActiveMobileSection] = useState("history");
  useEffect(() => {
    // Sidebar defaults `open=true` for desktop; on first mobile mount
    // we want it CLOSED (bottom-nav opens it on tap).
    if (isMobile) setSidebarOpen(false);
  }, [isMobile]);
  // Sade arayüzler (Kolay/Profesyonel) sade kalsın — moda girince NEURAL LINK
  // panelini kapat (kullanıcı bir kutucuğa tıklayınca ilgili panel açılır).
  useEffect(() => {
    if (simpleMode) setSidebarOpen(false);
  }, [simpleMode]);
  const openMobileSection = (section) => {
    setActiveMobileSection(section);
    setSidebarOpen(true);
    // Sidebar exposes an internal `setTab` — bridge via CustomEvent so we
    // don't have to prop-drill.
    try {
      window.dispatchEvent(new CustomEvent("sertex:sidebar-tab", { detail: section }));
    } catch { /* noop */ }
  };
  // Faz 9 CP3 — when the license-expiring banner is clicked we jump straight
  // to the "Lisansım" tab in the settings modal.
  const [settingsInitialTab, setSettingsInitialTab] = useState(null);

  // Hatırlatma sesi için kalıcı AudioContext'i erkenden hazırla + ilk kullanıcı
  // hareketiyle unlock et (arka planda güvenilir çalması için).
  useEffect(() => {
    initReminderAudio();
  }, []);

  // Faz 9 CP4.7 — same routing pathway, this time triggered by the storage
  // quota banner in NeuralLinkHeader. Global CustomEvent keeps us out of
  // prop-drilling through Sidebar.
  useEffect(() => {
    const onOpen = (e) => {
      const tab = e?.detail?.tab || null;
      if (tab) setSettingsInitialTab(tab);
      setSettingsOpen(true);
    };
    window.addEventListener("sertex:open-settings-tab", onOpen);
    return () => window.removeEventListener("sertex:open-settings-tab", onOpen);
  }, []);

  // Faz 9 CP7 — Once we know we have an authenticated user, kick off the
  // FCM push flow. On the plain web build this resolves to a no-op; on
  // the Android Capacitor build it prompts for OS notification permission
  // and registers the device token with the backend.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      try {
        const mod = await import("../lib/pushNotifications");
        if (cancelled) return;
        await mod.initPushNotifications();
      } catch (e) {
        console.debug("[sertex-push] init skipped:", e?.message || e);
      }
    })();
    return () => { cancelled = true; };
  }, [user?.id]);
  const [refreshKey, setRefreshKey] = useState(0);
  const [licenseState, setLicenseState] = useState({ loading: true, ok: false });
  const [sessionKicked, setSessionKicked] = useState(false);
  const audioRef = useRef(null);
  const speechIdRef = useRef(0);
  const memoryIdsRef = useRef(null); // Set<string> of known memory ids (null = not yet initialized)

  // ---- Wake word ("Sertex, ...") ----
  const [wakeEnabled, setWakeEnabled] = useState(() => loadWakeSettings().enabled);
  const [wakeActive, setWakeActive] = useState(false); // is background listener actually running
  const wakeRef = useRef(null);
  const wakePendingResumeRef = useRef(false);

  // ---- License gating & session kicking ----
  useEffect(() => {
    const check = async () => {
      try {
        const { licenseApi } = await import("../lib/api");
        const s = await licenseApi.me();
        setLicenseState({ loading: false, ok: !!s.has_license, status: s });
      } catch {
        setLicenseState({ loading: false, ok: false, status: null });
      }
    };
    check();
    // Periodic background check so passive tabs notice session kick / license
    // expiry within a minute even without user interaction.
    const poll = setInterval(check, 60_000);
    const onNoLicense = () => setLicenseState((p) => ({ ...p, ok: false }));
    const onKicked = () => setSessionKicked(true);
    window.addEventListener("sertex:no-license", onNoLicense);
    window.addEventListener("sertex:session-kicked", onKicked);
    return () => {
      clearInterval(poll);
      window.removeEventListener("sertex:no-license", onNoLicense);
      window.removeEventListener("sertex:session-kicked", onKicked);
    };
  }, [user?.id]);

  // React to wake-enabled changes (toggle from Settings)
  useEffect(() => {
    const onChange = () => setWakeEnabled(loadWakeSettings().enabled);
    window.addEventListener("sertex:wake-settings-changed", onChange);
    return () => window.removeEventListener("sertex:wake-settings-changed", onChange);
  }, []);

  // Start / stop the background wake listener when enabled toggles
  useEffect(() => {
    if (!wakeEnabled) {
      wakeRef.current?.stop();
      wakeRef.current = null;
      setWakeActive(false);
      // Reset pending-resume so a leftover flag doesn't fire on next manual send
      wakePendingResumeRef.current = false;
      return;
    }
    if (!isWakeWordSupported()) {
      toast.error("Bu tarayıcı uyandırma kelimesini desteklemiyor (Chrome/Edge gerekli)");
      saveWakeSettings({ enabled: false });
      setWakeEnabled(false);
      return;
    }
    const listener = createWakeWordListener({
      lang: "tr-TR",
      onWake: (tail) => {
        // Wake detected — trigger the voice command capture flow.
        // Any leftover text after "Sertex" in the same utterance is passed
        // as an initial seed the user probably wants to send.
        wakePendingResumeRef.current = true;
        // Give a subtle audio cue (short high beep) so user knows we're listening
        try {
          const AC = window.AudioContext || window.webkitAudioContext;
          if (AC) {
            const ctx = new AC();
            const osc = ctx.createOscillator();
            const g = ctx.createGain();
            osc.type = "sine";
            osc.frequency.value = 1400;
            osc.connect(g);
            g.connect(ctx.destination);
            g.gain.setValueAtTime(0.0001, ctx.currentTime);
            g.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02);
            g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.12);
            osc.start();
            osc.stop(ctx.currentTime + 0.14);
            setTimeout(() => {
              try {
                if (ctx.state !== "closed") ctx.close?.();
              } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
            }, 300);
          }
        } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
        window.dispatchEvent(
          new CustomEvent("sertex:wake-triggered", { detail: { tail: tail || "" } })
        );
      },
      onError: (e) => {
        toast.error("Mikrofon izni gerekli — uyandırma kelimesi kapatıldı");
        saveWakeSettings({ enabled: false });
        setWakeEnabled(false);
      },
    });
    if (!listener) {
      setWakeActive(false);
      return;
    }
    wakeRef.current = listener;
    listener.start();
    setWakeActive(true);
    return () => {
      listener.stop();
      wakeRef.current = null;
    };
  }, [wakeEnabled]);

  // Resume the wake listener after a command completes (i.e., handleSend fires while pending)
  const resumeWakeListener = () => {
    if (wakePendingResumeRef.current && wakeRef.current) {
      wakePendingResumeRef.current = false;
      wakeRef.current.resume();
    }
  };

  // Single toggle helper shared by TopLeftHUD button + InputBar inline chip
  const handleToggleWake = () => {
    const next = !wakeEnabled;
    saveWakeSettings({ enabled: next });
    setWakeEnabled(next);
    window.dispatchEvent(new CustomEvent("sertex:wake-settings-changed"));
    if (next) {
      toast.success("Uyandırma kelimesi aktif — 'Sertex' de yeter", { duration: 2500 });
    } else {
      toast("Uyandırma kelimesi kapatıldı", { duration: 1800 });
    }
  };

  // Initialize memory-id snapshot on mount (single fetch)
  useEffect(() => {
    let alive = true;
    memoryApi
      .list()
      .then((list) => {
        if (alive) memoryIdsRef.current = new Set(list.map((m) => m.id));
      })
      .catch(() => {
        if (alive) memoryIdsRef.current = new Set();
      });
    return () => {
      alive = false;
    };
  }, []);

  // update state based on flags
  // Intentional: `state` is read (early-return) but should NOT trigger re-run
  // when it changes — the effect only reacts to listening/thinking transitions.
  useEffect(() => {
    if (state === "error") return; // let error state auto-clear
    if (thinking) setState("thinking");
    else if (state === "speaking") return;
    else if (listening) setState("listening");
    else setState("idle");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, thinking]);

  // Helper: briefly flash red error state
  const triggerError = () => {
    setState("error");
    setTimeout(() => setState("idle"), 2500);
  };

  const speak = async (text) => {
    if (voiceEnabled !== "on") return;
    const myId = ++speechIdRef.current;
    try {
      setState("speaking");
      const url = await ttsApi.synthesize(text, "onyx");
      // User (or a newer speak call) cancelled us while we were synthesising
      if (myId !== speechIdRef.current) {
        try { if (url && url.startsWith("blob:")) URL.revokeObjectURL(url); } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
        return;
      }
      if (audioRef.current) {
        audioRef.current.pause();
        audioRef.current.src = url;
        await audioRef.current.play();
      }
    } catch (e) {
      // Suppress error toast if this speak was cancelled
      if (myId !== speechIdRef.current) return;
      toast.error(t(lang, "ttsError"));
      triggerError();
    }
  };

  // Immediately stop Sertex speech playback (used by DUR button, sphere click, Escape key).
  // Also invalidates any in-flight TTS synthesis so it can't start playing after stop.
  const stopSpeaking = () => {
    speechIdRef.current++;
    const a = audioRef.current;
    if (a) {
      try { a.pause(); } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
      try { a.currentTime = 0; } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
      try {
        const oldSrc = a.src;
        a.removeAttribute("src");
        a.load();
        if (oldSrc && oldSrc.startsWith("blob:")) URL.revokeObjectURL(oldSrc);
      } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
    }
    setState("idle");
  };

  // Global Escape key = stop TTS immediately
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape" && state === "speaking") {
        stopSpeaking();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const handleSend = async (text) => {
    setThinking(true);
    const tempUserMsg = {
      id: `temp-${Date.now()}`,
      role: "user",
      content: text,
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    try {
      const res = await chatApi.send(text, conversationId, lang);
      setConversationId(res.conversation_id);
      // Attach sources onto the assistant message so ChatMessages can render badges
      const assistantWithSources = {
        ...res.assistant_message,
        sources: res.sources || [],
      };
      setMessages((prev) => [
        ...prev.filter((m) => m.id !== tempUserMsg.id),
        res.user_message,
        assistantWithSources,
      ]);
      setRefreshKey((k) => k + 1);
      speak(res.assistant_message.content);
      // Resume the background wake-word listener after a wake-triggered command completes.
      resumeWakeListener();

      // ---- Detect new memories auto-extracted in background ----
      // Skip if manual/forget trigger — backend already replied with confirmation.
      // Only check for long messages (auto-extract only runs when text > 15 chars).
      if (!isMemoryTrigger(text) && text.length > 15) {
        setTimeout(async () => {
          try {
            const list = await memoryApi.list();
            const known = memoryIdsRef.current || new Set();
            const newOnes = list.filter((m) => !known.has(m.id));
            if (newOnes.length > 0) {
              const first = newOnes[0].content;
              const label =
                newOnes.length === 1
                  ? `🧠 Yeni bilgi hafızama eklendi`
                  : `🧠 ${newOnes.length} yeni bilgi hafızama eklendi`;
              const desc =
                newOnes.length === 1
                  ? first
                  : `${first} · +${newOnes.length - 1} tane daha`;
              toast(label, {
                description: desc,
                duration: 3500,
                style: {
                  background: "rgba(5,9,20,0.95)",
                  border: "1px solid rgba(0,240,255,0.5)",
                  color: "#00F0FF",
                },
              });
              memoryIdsRef.current = new Set(list.map((m) => m.id));
              setRefreshKey((k) => k + 1); // Re-render MemoryPanel if open
            }
          } catch (e) {
            // silent fail — this is a UX enhancement, not critical
          }
        }, 6500);
      } else if (isMemoryTrigger(text)) {
        // Manual/forget trigger — sync operation completed. Just refresh id snapshot.
        try {
          const list = await memoryApi.list();
          memoryIdsRef.current = new Set(list.map((m) => m.id));
        } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
      }
    } catch (e) {
      toast.error(
        lang === "tr" ? "Bir hata oluştu" : "Something went wrong"
      );
      setMessages((prev) => prev.filter((m) => m.id !== tempUserMsg.id));
      triggerError();
      resumeWakeListener();
    } finally {
      setThinking(false);
    }
  };

  const handleSelectConversation = async (cid) => {
    try {
      const msgs = await chatApi.getMessages(cid);
      setConversationId(cid);
      setMessages(msgs);
    } catch (e) {
      toast.error("Load error");
    }
  };

  const handleNewChat = () => {
    setConversationId(null);
    setMessages([]);
  };

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-sertex-bg">
      {/* Faz 9 CP6 — Global announcement banner (fixed top). Only renders
          when the current user has an active un-acked announcement. */}
      <AnnouncementBanner />
      {!licenseState.loading && licenseState.ok && licenseState.status &&
        !licenseState.status.is_admin &&
        licenseState.status.type !== "lifetime" &&
        typeof licenseState.status.days_left === "number" &&
        licenseState.status.days_left <= 7 && (
        <button
          type="button"
          onClick={() => {
            setSettingsInitialTab("mylicense");
            setSettingsOpen(true);
          }}
          className="fixed top-2 left-1/2 -translate-x-1/2 z-40 px-3 py-1.5 rounded-md border border-amber-300/50 bg-amber-300/10 hover:bg-amber-300/20 backdrop-blur-md text-[11px] font-mono text-amber-300 flex items-center gap-2 shadow-lg cursor-pointer transition-colors"
          data-testid="license-expiring-banner"
          title="Lisans yönetim sekmesine git"
        >
          <span>⚠️</span>
          <span>
            Lisansın {licenseState.status.days_left} gün sonra bitecek —
            {licenseState.status.days_left === 0 ? " bugün " : " yakında "}
            yenilemeni öneririm.
          </span>
          <span className="ml-1 text-amber-200 underline underline-offset-2">Yenile →</span>
        </button>
      )}
      {!licenseState.loading && !licenseState.ok && !sessionKicked && (
        <RedeemScreen
          onRedeemed={() => setLicenseState({ loading: false, ok: true })}
        />
      )}
      {sessionKicked && (
        <div className="fixed inset-0 z-[60] bg-black/80 backdrop-blur-md flex items-center justify-center p-4">
          <div className="max-w-sm glass-panel border border-rose-400/50 rounded-lg p-6 text-center space-y-4">
            <div className="hud-text text-rose-300 text-lg neon-glow">
              OTURUM SONLANDIRILDI
            </div>
            <p className="text-xs font-mono text-sertex-text leading-relaxed">
              Hesabına başka bir cihazdan giriş yapıldı. Aynı anda sadece bir
              oturum aktif olabilir.
            </p>
            <button
              onClick={() => {
                try { localStorage.removeItem("sertex_token"); } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
                try { window.location.href = "/"; } catch (e) { console.warn("[SertexMain.jsx] hata bastırıldı:", e); }
              }}
              className="w-full py-2 border border-rose-400 bg-rose-400/10 hover:bg-rose-400/20 rounded-md hud-text text-rose-300"
              data-testid="session-kicked-relogin"
            >
              YENİDEN GİRİŞ YAP
            </button>
          </div>
        </div>
      )}
      <Toaster
        position="bottom-center"
        theme="dark"
        toastOptions={{
          style: {
            background: "rgba(5,9,20,0.9)",
            border: "1px solid rgba(0,240,255,0.3)",
            color: "#E2F1FF",
            fontFamily: "JetBrains Mono, monospace",
            fontSize: "12px",
          },
        }}
      />

      {/* Background layers */}
      <div className="absolute inset-0 grid-bg pointer-events-none opacity-40" />
      <div className="absolute inset-0 radial-glow pointer-events-none" />
      <div
        className="absolute left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-sertex-cyan/30 to-transparent animate-scanline pointer-events-none z-10"
        style={{ boxShadow: "0 0 16px rgba(0,240,255,0.4)" }}
      />

      {/* HUDs — hidden on mobile (< 1024px) to reclaim screen real estate.
          Bottom-nav + drawer sidebar replace them on small viewports.
          Also hidden in the KOLAY interface (clutter-free task board). */}
      {!isMobile && !simpleMode && (
        <>
          <TopLeftHUD
            lang={lang}
            state={state}
            onOpenSettings={() => setSettingsOpen(true)}
            wakeEnabled={wakeEnabled}
            wakeActive={wakeActive}
            onToggleWake={handleToggleWake}
          />
          <TopRightHUD lang={lang} sidebarOpen={sidebarOpen} />
          <BottomLeftHUD />
        </>
      )}

      {/* Impersonation banner */}
      {user?._impersonated && (
        <div
          className="fixed top-0 left-0 right-0 z-40 bg-yellow-500/20 border-b border-yellow-400/60 backdrop-blur-md px-4 py-2 flex items-center justify-between"
          data-testid="impersonation-banner"
        >
          <div className="flex items-center gap-2 text-yellow-300 hud-text">
            <Eye className="h-3 w-3" />
            <span className="font-mono normal-case text-xs">
              <span className="text-yellow-200 font-bold">{user._impersonated_by}</span>
              {" "}olarak <span className="text-yellow-200 font-bold">{user.username}</span>{" "}
              hesabına giriş yaptınız
            </span>
          </div>
          <button
            onClick={() => {
              if (stopImpersonating()) {
                window.location.reload();
              }
            }}
            data-testid="stop-impersonation"
            className="hud-text flex items-center gap-1 px-3 py-1 border border-yellow-400 text-yellow-300 hover:bg-yellow-500 hover:text-sertex-bg rounded transition-colors"
          >
            <ArrowLeft className="h-3 w-3" /> YÖNETİCİYE DÖN
          </button>
        </div>
      )}

      {/* Central Sphere — on mobile shrink & fade so it's a background
          effect rather than blocking chat/nav. Hidden in KOLAY interface. */}
      {!simpleMode && (
      <div
        className="absolute inset-0 flex items-center justify-center pointer-events-none z-0"
        style={{
          paddingRight: !isMobile && sidebarOpen ? 360 : 0,
          transition: "padding-right 300ms",
          opacity: isMobile ? 0.35 : 1,
        }}
      >
        <div
          className={`pointer-events-auto ${isMobile ? "w-[min(55vw,340px)] h-[min(55vw,340px)] -translate-y-16" : "w-[min(75vh,680px)] h-[min(75vh,680px)] -translate-y-8"}`}
        >
          <HolographicSphere
            state={state}
            onClick={() => {
              // Click sphere while speaking → stop TTS immediately
              if (state === "speaking") {
                stopSpeaking();
                return;
              }
              // click sphere activates mic if idle
              if (state === "idle") {
                // just trigger a hint
                toast(
                  lang === "tr"
                    ? "Mikrofon simgesine tıklayarak konuşabilirsiniz."
                    : "Click the microphone icon to speak.",
                  { duration: 2000 }
                );
              }
            }}
          />
        </div>
      </div>
      )}

      {/* Title above sphere — hidden on mobile / KOLAY interface */}
      <div
        className={`absolute top-[5vh] left-1/2 -translate-x-1/2 z-10 text-center pointer-events-none ${(isMobile || simpleMode) ? "hidden" : ""}`}
        style={{ paddingRight: sidebarOpen && !isMobile ? 180 : 0, transition: "padding-right 300ms" }}
      >
        {messages.length === 0 && (
          <>
            <h1 className="display-text text-3xl sm:text-4xl lg:text-5xl font-bold text-sertex-cyan neon-glow tracking-widest">
              S.E.R.T.E.X
            </h1>
            <p className="hud-text mt-1 text-sertex-textSecondary">
              {t(lang, "tagline")}
            </p>
          </>
        )}
      </div>

      {/* KOLAY arayüzü — sade görev panosu (Detaylı görünümün yerine geçer). */}
      {kolayMode && (
        <KolayInterface
          onOpenSection={openMobileSection}
          onOpenSettings={() => setSettingsOpen(true)}
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
        />
      )}

      {/* PROFESYONEL arayüzü — kurumsal SaaS panosu. */}
      {profMode && (
        <ProfesyonelInterface
          onOpenSection={openMobileSection}
          onOpenSettings={() => setSettingsOpen(true)}
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
        />
      )}

      {/* TEKNİK arayüzü — konsol/terminal tablo görünümü. */}
      {teknikMode && (
        <TeknikInterface
          onOpenSection={openMobileSection}
          onOpenSettings={() => setSettingsOpen(true)}
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
        />
      )}

      {/* AYDINLIK arayüzü — açık tema ferah liste. */}
      {aydinlikMode && (
        <AydinlikInterface
          onOpenSection={openMobileSection}
          onOpenSettings={() => setSettingsOpen(true)}
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
        />
      )}

      {/* PANO arayüzü — Kanban sütunları. */}
      {panoMode && (
        <PanoInterface
          onOpenSection={openMobileSection}
          onOpenSettings={() => setSettingsOpen(true)}
          sidebarOpen={sidebarOpen}
          isMobile={isMobile}
        />
      )}

      {/* Chat + Input at bottom — hidden in KOLAY interface. */}
      {!simpleMode && (
      <div
        className={`absolute left-0 right-0 z-20 px-4 ${isMobile ? "bottom-14" : "bottom-6"}`}
        style={{
          paddingRight: !isMobile && sidebarOpen ? 396 : 16,
          transition: "padding-right 300ms",
          paddingBottom: isMobile ? "env(safe-area-inset-bottom, 0px)" : undefined,
        }}
      >
        <div className="max-w-3xl mx-auto space-y-2">
          {messages.length > 0 && (
            <div className="glass-panel corner-bracket relative rounded-md px-2 py-2">
              <ChatMessages messages={messages} thinking={thinking} />
            </div>
          )}
          <InputBar
            onSend={handleSend}
            lang={lang}
            disabled={thinking}
            listening={listening}
            setListening={setListening}
            voiceEnabled={voiceEnabled}
            setVoiceEnabled={setVoiceEnabled}
            speaking={state === "speaking"}
            onStopSpeaking={stopSpeaking}
            wakeEnabled={wakeEnabled}
            wakeActive={wakeActive}
            onToggleWake={handleToggleWake}
          />
        </div>
      </div>
      )}

      {/* Sidebar */}
      <Sidebar
        lang={lang}
        open={sidebarOpen}
        setOpen={setSidebarOpen}
        activeConversationId={conversationId}
        onSelectConversation={handleSelectConversation}
        onNewChat={handleNewChat}
        refreshKey={refreshKey}
      />

      {/* Faz 9 CP8 — Mobile bottom navigation. Rendered only on < 1024px
          viewports; provides fast access to Sohbet / Görevler / Notlar /
          Ayarlar without needing to poke the tiny sidebar toggle. */}
      {isMobile && (
        <MobileBottomNav
          activeSection={sidebarOpen ? activeMobileSection : null}
          onOpenSection={openMobileSection}
          onOpenSettings={() => setSettingsOpen(true)}
        />
      )}

      {/* Settings modal */}
      <SettingsPanel
        open={settingsOpen}
        onClose={() => {
          setSettingsOpen(false);
          setSettingsInitialTab(null);
        }}
        initialTab={settingsInitialTab}
      />

      {/* Overdue-task alarm modal (auto-pops when a task passes its due date) */}
      <OverdueAlertModal />

      {/* Chip stack containers — DraggablePanel portals hidden-panel chips here so they never overlap.
          Each stack respects sidebar occupancy via CSS vars (--sx-sb-right/left/top/bottom).
          Height is auto (only as tall as its chips) so panels only shift by real chip height. */}
      <div
        id="chip-stack-left"
        className="fixed flex flex-col gap-1.5 py-3 pointer-events-none"
        style={{ zIndex: 45, left: 0, top: "var(--sx-sb-top, 0px)" }}
        aria-hidden="true"
      />
      <div
        id="chip-stack-right"
        className="fixed flex flex-col gap-1.5 py-3 items-end pointer-events-none"
        style={{ zIndex: 45, right: "var(--sx-sb-right, 0px)", top: "var(--sx-sb-top, 0px)" }}
        aria-hidden="true"
      />
      <div
        id="chip-stack-top"
        className="fixed flex flex-row gap-1.5 px-3 justify-center pointer-events-none"
        style={{ zIndex: 45, top: 0, left: "var(--sx-sb-left, 0px)", right: "var(--sx-sb-right, 0px)" }}
        aria-hidden="true"
      />
      <div
        id="chip-stack-bottom"
        className="fixed flex flex-row gap-1.5 px-3 justify-center pointer-events-none"
        style={{ zIndex: 45, bottom: 0, left: "var(--sx-sb-left, 0px)", right: "var(--sx-sb-right, 0px)" }}
        aria-hidden="true"
      />

      <audio
        ref={audioRef}
        onEnded={() => setState("idle")}
        onPause={() => {
          if (state === "speaking") setState("idle");
        }}
        data-testid="tts-audio"
      />
      <DetachedPanelsHost onDataChanged={() => setRefreshKey((k) => k + 1)} />
      {/* Her zaman mount'lu global hatırlatma gözcüsü — Sertex sekmesi arka
          plandayken bile tekrarlı hatırlatmalarda masaüstü bildirimi + JARVIS
          sesi çalar. Panel açıkken pas geçer (çift tetikleme yok). */}
      <ReminderWatcher enabled={!!user} />
    </div>
  );
};

export default SertexMain;
