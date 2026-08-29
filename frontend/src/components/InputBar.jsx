import React, { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Send, Volume2, VolumeX, Loader2, Square, Ear } from "lucide-react";
import { createRecognizer, isNativeSTTSupported, createWhisperRecorder } from "../lib/speech";
import { t } from "../lib/i18n";
import VoiceVisualizer from "./VoiceVisualizer";
import { toast } from "sonner";

const InputBar = ({
  onSend,
  lang,
  disabled,
  listening,
  setListening,
  voiceEnabled,
  setVoiceEnabled,
  speaking = false,
  onStopSpeaking,
  wakeEnabled = false,
  wakeActive = false,
  onToggleWake,
}) => {
  const [text, setText] = useState("");
  const [interim, setInterim] = useState("");
  const [sttMode, setSttMode] = useState("native"); // 'native' | 'whisper'
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef(null);
  const whisperRef = useRef(null);
  // Latest final transcript so async silence handlers can submit without reading stale state
  const latestTextRef = useRef("");
  // Was recording auto-stopped by VAD (silence)? If so, auto-submit on stop.
  const autoSubmitRef = useRef(false);

  // Keep the ref in sync with the state so silence handlers submit up-to-date text.
  useEffect(() => {
    latestTextRef.current = text;
  }, [text]);

  // Wake-word integration: SertexMain fires `sertex:wake-triggered` when it hears
  // "Sertex" in the background. That's our cue to start the mic listener
  // automatically without the user tapping anything.
  useEffect(() => {
    const onWake = (e) => {
      // If we're already listening (e.g. user already tapped mic), ignore.
      if (listening || transcribing || disabled) return;
      // If the wake utterance contained extra text after "Sertex" (e.g.
      // "Sertex bugün hava nasıl"), seed the input with it — VAD will still
      // auto-submit once the user finishes speaking (or immediately if silent).
      const tail = e?.detail?.tail || "";
      if (tail) {
        setText(tail);
        latestTextRef.current = tail;
      }
      startListening();
    };
    window.addEventListener("sertex:wake-triggered", onWake);
    return () => window.removeEventListener("sertex:wake-triggered", onWake);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listening, transcribing, disabled]);

  // Detect STT mode once on mount
  useEffect(() => {
    setSttMode(isNativeSTTSupported() ? "native" : "whisper");
  }, []);

  useEffect(() => {
    return () => {
      try {
        recRef.current?.stop();
      } catch (e) { console.warn("[InputBar.jsx] hata bastırıldı:", e); }
      try {
        whisperRef.current?.cancel();
      } catch (e) { console.warn("[InputBar.jsx] hata bastırıldı:", e); }
    };
  }, []);

  // ---- Native Web Speech (Chrome) ----
  const startNative = () => {
    const rec = createRecognizer(lang === "tr" ? "tr-TR" : "en-US");
    if (!rec) {
      // Fallback if suddenly unavailable
      setSttMode("whisper");
      startWhisper();
      return;
    }
    rec.onresult = (e) => {
      let final = "";
      let inter = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) final += r[0].transcript;
        else inter += r[0].transcript;
      }
      if (final) {
        setText((prev) => {
          const next = prev ? prev + " " + final : final;
          latestTextRef.current = next;
          return next;
        });
      }
      setInterim(inter);
    };
    rec.onerror = (e) => {
      // 'not-allowed' or 'service-not-allowed' → try Whisper fallback
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        toast.error("Mikrofon izni gerekli");
      } else if (e.error === "network" || e.error === "audio-capture") {
        toast.info("Whisper'a geçiliyor...");
        setSttMode("whisper");
        startWhisper();
        return;
      } else if (e.error !== "no-speech" && e.error !== "aborted") {
        toast.error(`Mikrofon hatası: ${e.error}`);
      }
      setListening(false);
    };
    rec.onend = () => {
      setListening(false);
      setInterim("");
      // Native Web Speech auto-ends when user pauses. If we captured any final
      // transcript, submit it automatically without requiring another click.
      const value = latestTextRef.current.trim();
      if (value && !disabled) {
        onSend(value);
        setText("");
        latestTextRef.current = "";
      }
    };
    recRef.current = rec;
    setListening(true);
    try {
      rec.start();
    } catch (e) {
      setListening(false);
    }
  };

  const stopNative = () => {
    try {
      recRef.current?.stop();
    } catch (e) { console.warn("[InputBar.jsx] hata bastırıldı:", e); }
    setListening(false);
  };

  // ---- Whisper fallback (Firefox, Mobile) ----
  const startWhisper = async () => {
    try {
      autoSubmitRef.current = false;
      const wr = await createWhisperRecorder({
        language: lang === "tr" ? "tr" : "en",
        onError: (e) => {
          toast.error("Kayıt hatası");
          setListening(false);
        },
        // Voice Activity Detection — auto-stop 1.5s after user goes silent
        onSilence: (reason) => {
          autoSubmitRef.current = true;
          stopWhisper();
        },
        silenceMs: 1500,
        maxDurationMs: 20000,
      });
      whisperRef.current = wr;
      wr.start();
      setListening(true);
    } catch (e) {
      toast.error(e.message || "Mikrofon başlatılamadı");
      setListening(false);
    }
  };

  const stopWhisper = async () => {
    const wr = whisperRef.current;
    if (!wr) {
      setListening(false);
      return;
    }
    setListening(false);
    setTranscribing(true);
    const shouldAutoSubmit = autoSubmitRef.current;
    autoSubmitRef.current = false;
    try {
      const transcript = await wr.stop();
      if (transcript && transcript.trim()) {
        const clean = transcript.trim();
        // Prepend existing typed text if any (usually empty in voice-first flow)
        const merged = latestTextRef.current ? latestTextRef.current + " " + clean : clean;
        if (shouldAutoSubmit && !disabled) {
          // VAD triggered — send immediately without a second click
          onSend(merged);
          setText("");
          latestTextRef.current = "";
        } else {
          setText(merged);
          latestTextRef.current = merged;
        }
      } else {
        toast.info("Ses algılanmadı");
      }
    } catch (e) {
      toast.error("Ses çevirisi başarısız");
    } finally {
      setTranscribing(false);
      whisperRef.current = null;
    }
  };

  const startListening = () => {
    if (sttMode === "native") startNative();
    else startWhisper();
  };

  const stopListening = () => {
    if (sttMode === "native") stopNative();
    else stopWhisper();
  };

  const submit = () => {
    const value = (text + " " + interim).trim();
    if (!value || disabled) return;
    onSend(value);
    setText("");
    setInterim("");
    if (listening) stopListening();
  };

  const showVisualizer = listening || transcribing || voiceEnabled === "busy";

  return (
    <div className="w-full max-w-3xl mx-auto" data-testid="input-bar">
      {showVisualizer && (
        <div className="mb-2 px-2">
          <VoiceVisualizer active={listening || voiceEnabled === "busy"} />
          {listening && !transcribing && (
            <div
              className="text-center hud-text text-sertex-cyan/80 mt-1 tracking-[0.2em]"
              data-testid="voice-auto-hint"
            >
              KONUŞUN — SUSUNCA OTOMATİK GÖNDERİLİR
            </div>
          )}
          {transcribing && (
            <div className="text-center hud-text text-sertex-cyan mt-1 flex items-center justify-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              WHISPER ÇÖZÜMLÜYOR...
            </div>
          )}
        </div>
      )}
      <div className="glass-panel corner-bracket relative flex items-center gap-2 px-3 py-2">
        {speaking && (
          <button
            onClick={onStopSpeaking}
            data-testid="stop-speaking-button"
            title="Konuşmayı durdur (Esc)"
            className="absolute inset-0 z-10 flex items-center justify-center gap-2 rounded-md border-2 border-sertex-danger bg-sertex-danger/15 text-sertex-danger hover:bg-sertex-danger/25 transition-colors animate-pulse-glow"
          >
            <Square className="h-5 w-5 fill-current" />
            <span className="display-text tracking-[0.3em] font-bold text-base">DUR</span>
            <span className="hud-text opacity-70 hidden sm:inline">(Esc)</span>
          </button>
        )}
        <button
          onClick={listening ? stopListening : startListening}
          disabled={transcribing}
          className={`p-2 rounded-md border transition-colors relative ${
            listening
              ? "border-sertex-danger text-sertex-danger bg-sertex-danger/10"
              : "border-sertex-cyan/40 text-sertex-cyan hover:bg-sertex-cyan/10"
          } ${transcribing ? "opacity-50 cursor-wait" : ""}`}
          data-testid="mic-button"
          aria-label="microphone"
          title={
            sttMode === "whisper"
              ? "Whisper STT (Firefox/Mobil uyumlu)"
              : "Web Speech (Chrome)"
          }
        >
          {transcribing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : listening ? (
            <MicOff className="h-4 w-4" />
          ) : (
            <Mic className="h-4 w-4" />
          )}
          {sttMode === "whisper" && !listening && !transcribing && (
            <span
              className="absolute -top-1 -right-1 text-[8px] font-bold text-sertex-cyan bg-sertex-bg px-0.5 rounded"
              style={{ fontSize: "7px", lineHeight: "10px" }}
              data-testid="mic-mode-badge"
            >
              W
            </span>
          )}
        </button>

        {/* Wake-word quick toggle — sits right next to mic so user can flip
            auto-listen on/off without opening any menu. */}
        {onToggleWake && (
          <button
            onClick={onToggleWake}
            data-testid="wake-toggle-inline"
            aria-pressed={!!wakeEnabled}
            title={
              wakeEnabled
                ? wakeActive
                  ? "OTOMATİK DİNLEME AÇIK — 'Sertex' der demez dinlemeye başlar"
                  : "Uyandırma açık ama şu an pasif"
                : "Otomatik dinleme (uyandırma kelimesi) — kapalı"
            }
            className={`flex items-center gap-1 px-2 py-2 rounded-md border transition-all hud-text ${
              wakeEnabled
                ? wakeActive
                  ? "border-emerald-400 text-emerald-300 bg-emerald-500/10 shadow-[0_0_8px_rgba(52,211,153,0.4)]"
                  : "border-yellow-400/50 text-yellow-300 bg-yellow-500/5"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50"
            }`}
          >
            <Ear
              className={`h-4 w-4 ${wakeEnabled && wakeActive ? "animate-pulse" : ""}`}
            />
            <span className="hidden md:inline text-[10px] tracking-[0.15em]">AUTO</span>
          </button>
        )}

        <input
          value={text + (interim ? " " + interim : "")}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder={t(lang, "inputPlaceholder")}
          disabled={disabled}
          data-testid="chat-input"
          className="flex-1 bg-transparent outline-none text-sertex-text font-mono text-sm placeholder:text-sertex-textMuted disabled:opacity-50"
        />

        <button
          onClick={() => setVoiceEnabled(voiceEnabled === "on" ? "off" : "on")}
          className={`p-2 rounded-md border transition-colors ${
            voiceEnabled === "on"
              ? "border-sertex-cyan text-sertex-cyan bg-sertex-cyan/10"
              : "border-sertex-cyan/20 text-sertex-textMuted hover:text-sertex-cyan"
          }`}
          data-testid="voice-toggle"
          title={voiceEnabled === "on" ? t(lang, "voiceOn") : t(lang, "voiceOff")}
        >
          {voiceEnabled === "on" ? (
            <Volume2 className="h-4 w-4" />
          ) : (
            <VolumeX className="h-4 w-4" />
          )}
        </button>

        <button
          onClick={submit}
          disabled={disabled}
          className="px-3 py-2 rounded-md border border-sertex-cyan text-sertex-cyan hover:bg-sertex-cyan hover:text-sertex-bg disabled:opacity-40 transition-colors flex items-center gap-1"
          data-testid="send-button"
        >
          <Send className="h-4 w-4" />
          <span className="hud-text hidden sm:inline">{t(lang, "send")}</span>
        </button>
      </div>
    </div>
  );
};

export default InputBar;
