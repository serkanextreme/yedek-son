import React, { useEffect, useRef, useState } from "react";
import { Activity, Cpu, Wifi, Globe2, Zap, Settings, Battery, BatteryCharging, WifiOff, Sunrise, Sunset, Search, X, MapPin, Loader2, Ear } from "lucide-react";
import { t } from "../lib/i18n";
import { weatherApi } from "../lib/api";
import { useSystemStats, fpsToPct, prettyPlatform } from "../lib/systemStats";
import DraggablePanel from "./DraggablePanel";

const WEATHER_CITY_KEY = "sertex_weather_city_v1";
const DEFAULT_CITY = { name: "Istanbul", latitude: 41.0138, longitude: 28.9497, timezone: "Europe/Istanbul", country: "Türkiye" };

const loadCity = () => {
  try {
    const raw = localStorage.getItem(WEATHER_CITY_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { console.warn("[HUDOverlay.jsx] hata bastırıldı:", e); }
  return DEFAULT_CITY;
};

const saveCity = (c) => {
  try { localStorage.setItem(WEATHER_CITY_KEY, JSON.stringify(c)); } catch (e) { console.warn("[HUDOverlay.jsx] hata bastırıldı:", e); }
};

const fmtSunTime = (iso, tz) => {
  if (!iso) return "--:--";
  // Backend returns local time already for the city's timezone; treat as local
  const s = iso.length === 16 ? iso : iso.slice(0, 16);
  return s.slice(11, 16);
};

const useClock = () => {
  const [now, setNow] = useState(new Date());
  useEffect(() => {
    const i = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(i);
  }, []);
  return now;
};

const StatBar = ({ label, value, testId }) => (
  <div className="flex items-center gap-2 mt-1" data-testid={testId}>
    <span className="hud-text text-sertex-textMuted w-9">{label}</span>
    <div className="flex-1 h-1 bg-sertex-surface/60 rounded-sm overflow-hidden">
      <div
        className="h-full bg-gradient-to-r from-sertex-blue to-sertex-cyan transition-all duration-1000"
        style={{ width: `${value}%`, boxShadow: "0 0 6px rgba(0,240,255,0.6)" }}
      />
    </div>
    <span className="hud-text text-sertex-cyan tabular-nums w-8 text-right">
      {value}%
    </span>
  </div>
);

export const TopLeftHUD = ({ lang, state, onOpenSettings, wakeEnabled, wakeActive, onToggleWake }) => {
  const sys = useSystemStats();

  const stateLabels = {
    idle: t(lang, "idle"),
    listening: t(lang, "listening"),
    thinking: t(lang, "thinking"),
    speaking: t(lang, "speaking"),
    error: "HATA",
  };
  const stateColor = {
    idle: "text-sertex-textSecondary",
    listening: "text-sertex-cyan neon-glow",
    thinking: "text-sertex-blue",
    speaking: "text-sertex-cyan neon-glow animate-flicker",
    error: "text-sertex-danger neon-glow",
  }[state];

  const fpsPct = fpsToPct(sys.fps);

  return (
    <DraggablePanel
      id="topleft"
      title="SERTEX · SİSTEM"
      defaultPos={{ x: 16, y: 16 }}
      defaultSize={{ width: 300, height: 290 }}
      minWidth={260}
      minHeight={240}
      testId="hud-top-left"
    >
      <div className="p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <div className="h-2 w-2 rounded-full bg-sertex-cyan animate-pulse-glow" />
            <span className="display-text text-sertex-cyan neon-glow text-base tracking-[0.25em] font-bold">
              SERTEX
            </span>
          </div>
          <Zap className="h-3 w-3 text-sertex-cyan" />
        </div>

        <div className="hud-text text-sertex-textMuted flex items-center justify-between">
          <span>
            DURUM: <span className={stateColor}>{stateLabels[state]}</span>
          </span>
          <span className="text-sertex-cyan">
            <Activity className="h-3 w-3 inline" />
          </span>
        </div>

        <div className="mt-2 pt-2 border-t border-sertex-cyan/15">
          <StatBar label="YÜK" value={sys.loadPct} testId="stat-load" />
          {sys.ramPct !== null ? (
            <StatBar label="RAM" value={sys.ramPct} testId="stat-ram" />
          ) : (
            <div className="hud-text text-sertex-textMuted mt-1">
              RAM: <span className="text-sertex-textMuted">yalnızca Chrome</span>
            </div>
          )}
          <StatBar label="FPS" value={fpsPct} testId="stat-fps" />
        </div>

        <div className="mt-2 pt-2 border-t border-sertex-cyan/15 grid grid-cols-2 gap-1">
          <div className="hud-text text-sertex-textMuted">
            ÇEK: <span className="text-sertex-cyan tabular-nums">{sys.cores}</span>
          </div>
          <div className="hud-text text-sertex-textMuted text-right">
            FPS: <span className="text-sertex-cyan tabular-nums">{sys.fps}</span>
          </div>
          <div className="hud-text text-sertex-textMuted">
            OS: <span className="text-sertex-cyan">{prettyPlatform(sys.platform)}</span>
          </div>
          <div className="hud-text text-sertex-textMuted text-right">
            {sys.deviceMemGB ? (
              <>MEM: <span className="text-sertex-cyan tabular-nums">{sys.deviceMemGB}GB</span></>
            ) : (
              <>MEM: <span className="text-sertex-textMuted">?</span></>
            )}
          </div>
        </div>

        <div className="mt-3 flex items-center justify-between gap-1 border-t border-sertex-cyan/15 pt-2">
          <button
            onClick={onToggleWake}
            data-testid="wake-word-toggle"
            aria-pressed={!!wakeEnabled}
            aria-label={
              wakeEnabled
                ? wakeActive
                  ? "Uyandırma kelimesi aktif — kapatmak için tıkla"
                  : "Uyandırma kelimesi açık ama şu an dinlemiyor"
                : "Uyandırma kelimesini aç — Sertex de demen yeter"
            }
            title={wakeEnabled ? "Uyandırma kelimesini kapat" : "'Sertex' der demez seni dinler"}
            className={`hud-text flex items-center gap-1 px-2 py-1 border rounded-sm transition-all ${
              wakeEnabled
                ? wakeActive
                  ? "border-emerald-400 text-emerald-300 bg-emerald-500/10 shadow-[0_0_8px_rgba(52,211,153,0.4)]"
                  : "border-yellow-400/50 text-yellow-300 bg-yellow-500/5"
                : "border-sertex-cyan/25 text-sertex-textMuted hover:text-sertex-cyan hover:border-sertex-cyan/50"
            }`}
          >
            <Ear
              className={`h-3 w-3 ${wakeEnabled && wakeActive ? "animate-pulse" : ""}`}
            />
            {wakeEnabled ? (wakeActive ? "SERTEX'İ DİNLE · AKTİF" : "SERTEX'İ DİNLE") : "SERTEX'İ DİNLE"}
          </button>
          <button
            onClick={onOpenSettings}
            data-testid="open-settings"
            className="hud-text flex items-center gap-1 px-2 py-1 border border-sertex-cyan/30 text-sertex-cyan hover:bg-sertex-cyan/10 hover:border-sertex-cyan rounded-sm transition-colors"
          >
            <Settings className="h-3 w-3" /> AYARLAR
          </button>
        </div>
      </div>
    </DraggablePanel>
  );
};

const WeatherIcon = ({ condition }) => {
  const c = condition?.toLowerCase() || "";
  if (c.includes("açık") || c.includes("clear") || c.includes("sunny"))
    return <span className="text-sertex-warning">☀</span>;
  if (c.includes("güneşli"))
    return <span className="text-sertex-warning">☀</span>;
  if (c.includes("kar")) return <span>❄</span>;
  if (c.includes("çisenti") || c.includes("sağanak") || c.includes("yağmur"))
    return <span>☂</span>;
  if (c.includes("fırtına") || c.includes("gök")) return <span>⚡</span>;
  if (c.includes("bulut")) return <span>☁</span>;
  if (c.includes("sis") || c.includes("kırağı")) return <span>≋</span>;
  return <span>◐</span>;
};

export const TopRightHUD = ({ lang, sidebarOpen }) => {
  const now = useClock();
  const [city, setCity] = useState(loadCity);
  const [weather, setWeather] = useState(null);
  const [showPicker, setShowPicker] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef(null);

  const fetchWeather = async (c) => {
    try {
      const data = await weatherApi.get(c.name, {
        lat: c.latitude,
        lon: c.longitude,
        tz: c.timezone,
      });
      setWeather(data);
    } catch {
      setWeather(null);
    }
  };

  useEffect(() => {
    fetchWeather(city);
    const i = setInterval(() => fetchWeather(city), 300000);
    return () => clearInterval(i);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [city.latitude, city.longitude]);

  // Debounced search
  useEffect(() => {
    if (!showPicker) return;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    searchTimer.current = setTimeout(async () => {
      setSearching(true);
      try {
        const r = await weatherApi.search(q);
        setResults(r || []);
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => searchTimer.current && clearTimeout(searchTimer.current);
  }, [query, showPicker]);

  const pickCity = (c) => {
    const next = {
      name: c.name,
      latitude: c.latitude,
      longitude: c.longitude,
      timezone: c.timezone,
      country: c.country,
      admin1: c.admin1,
    };
    setCity(next);
    saveCity(next);
    setShowPicker(false);
    setQuery("");
    setResults([]);
  };

  const time = now.toLocaleTimeString("tr-TR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const date = now.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    weekday: "short",
  });

  const rightGap = sidebarOpen ? 456 : 16;

  return (
    <DraggablePanel
      id="topright"
      title="ZAMAN · HAVA"
      defaultPos={{ x: rightGap, y: 16 }}
      defaultSize={{ width: 290, height: 245 }}
      minWidth={240}
      minHeight={200}
      anchorRight
      testId="hud-top-right"
    >
      <div className="p-3 text-right relative">
        <div className="display-text text-2xl text-sertex-cyan neon-glow font-mono tracking-wider">
          {time}
        </div>
        <div className="hud-text text-sertex-textMuted mt-1">{date}</div>
        {weather && (
          <>
            <div className="mt-2 pt-2 border-t border-sertex-cyan/15 flex items-center justify-end gap-3">
              <div className="text-right">
                <button
                  onClick={() => setShowPicker(true)}
                  data-testid="weather-city-btn"
                  className="hud-text text-sertex-textMuted flex items-center gap-1 justify-end hover:text-sertex-cyan transition-colors cursor-pointer"
                  title="Şehri değiştir"
                >
                  <Globe2 className="h-3 w-3" />
                  <span className="truncate max-w-[140px]">{weather.city}</span>
                </button>
                <div
                  className="hud-text mt-0.5 text-sertex-text"
                  data-testid="weather-summary"
                >
                  {weather.temperature_c}°C · {weather.condition}
                </div>
                <div className="text-[10px] font-mono text-sertex-textMuted mt-0.5">
                  {weather.temp_min_c != null && weather.temp_max_c != null && (
                    <>↓{weather.temp_min_c}° ↑{weather.temp_max_c}° · </>
                  )}
                  Nem %{weather.humidity} · Rüzgar {weather.wind_kph} km/s
                </div>
              </div>
              <div className="text-2xl text-sertex-cyan">
                <WeatherIcon condition={weather.condition} />
              </div>
            </div>

            <div
              className="mt-2 pt-2 border-t border-sertex-cyan/15 flex items-center justify-end gap-4"
              data-testid="weather-sun"
            >
              <div className="flex items-center gap-1.5">
                <Sunrise className="h-3.5 w-3.5 text-amber-300" />
                <div className="text-left leading-tight">
                  <div className="text-[9px] font-mono text-sertex-textMuted uppercase tracking-wider">
                    Doğuş
                  </div>
                  <div
                    className="hud-text text-sertex-text tabular-nums"
                    data-testid="weather-sunrise"
                  >
                    {fmtSunTime(weather.sunrise, weather.timezone)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1.5">
                <Sunset className="h-3.5 w-3.5 text-orange-400" />
                <div className="text-left leading-tight">
                  <div className="text-[9px] font-mono text-sertex-textMuted uppercase tracking-wider">
                    Batış
                  </div>
                  <div
                    className="hud-text text-sertex-text tabular-nums"
                    data-testid="weather-sunset"
                  >
                    {fmtSunTime(weather.sunset, weather.timezone)}
                  </div>
                </div>
              </div>
            </div>
          </>
        )}

        {/* City picker modal (in-panel) */}
        {showPicker && (
          <div
            className="absolute inset-0 bg-sertex-bg/95 backdrop-blur-md border border-sertex-cyan/30 rounded-md p-3 z-20 flex flex-col"
            data-testid="weather-city-picker"
          >
            <div className="flex items-center justify-between mb-2">
              <div className="hud-text text-sertex-cyan flex items-center gap-1">
                <MapPin className="h-3 w-3" /> ŞEHİR SEÇ
              </div>
              <button
                onClick={() => { setShowPicker(false); setQuery(""); setResults([]); }}
                className="text-sertex-textMuted hover:text-sertex-text"
                data-testid="weather-picker-close"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-sertex-textMuted" />
              <input
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Şehir ara (örn: Ankara)"
                data-testid="weather-city-input"
                className="w-full pl-7 pr-2 py-1.5 bg-sertex-surface border border-sertex-cyan/25 rounded text-sm font-mono text-sertex-text placeholder:text-sertex-textMuted focus:border-sertex-cyan outline-none"
              />
            </div>
            <div
              className="mt-2 flex-1 overflow-y-auto scrollbar-sertex space-y-1"
              data-testid="weather-city-results"
            >
              {searching && (
                <div className="flex items-center justify-center py-3 text-sertex-cyan">
                  <Loader2 className="h-4 w-4 animate-spin" />
                </div>
              )}
              {!searching && query.trim().length >= 2 && results.length === 0 && (
                <div className="hud-text text-sertex-textMuted text-center py-3">
                  Sonuç yok
                </div>
              )}
              {results.map((r, i) => (
                <button
                  key={`${r.name}-${r.latitude}-${i}`}
                  onClick={() => pickCity(r)}
                  data-testid={`weather-city-option-${i}`}
                  className="w-full text-left px-2 py-1.5 border border-sertex-cyan/15 hover:border-sertex-cyan/50 hover:bg-sertex-cyan/10 rounded transition-colors"
                >
                  <div className="text-sm text-sertex-text font-mono truncate">
                    {r.name}
                    {r.admin1 && r.admin1 !== r.name ? (
                      <span className="text-sertex-textMuted">, {r.admin1}</span>
                    ) : null}
                  </div>
                  <div className="text-[10px] text-sertex-textMuted font-mono">
                    {r.country} · {r.latitude?.toFixed(2)}, {r.longitude?.toFixed(2)}
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </DraggablePanel>
  );
};

export const BottomLeftHUD = () => {
  const sys = useSystemStats();
  return (
    <DraggablePanel
      id="bottomleft"
      title="NEURAL CORE"
      defaultPos={{ x: 16, y: window.innerHeight - 210 }}
      defaultSize={{ width: 240, height: 190 }}
      minWidth={220}
      minHeight={160}
      testId="hud-bottom-left"
    >
      <div className="p-3">
        <div className="hud-text text-sertex-cyan mb-1 flex items-center gap-1 border-b border-sertex-cyan/15 pb-1">
          <Zap className="h-3 w-3" /> NEURAL CORE
        </div>
        <div className="hud-text text-sertex-textMuted flex items-center gap-1">
          <Cpu className="h-3 w-3" /> RAM:{" "}
          <span className="text-sertex-cyan tabular-nums">
            {sys.ramUsedMB !== null ? `${sys.ramUsedMB} MB` : "-"}
          </span>
        </div>
        <div className="hud-text text-sertex-textMuted flex items-center gap-1 mt-1">
          {sys.online ? (
            <Wifi className="h-3 w-3" />
          ) : (
            <WifiOff className="h-3 w-3 text-sertex-danger" />
          )}{" "}
          LAT:{" "}
          <span
            className={`tabular-nums ${
              sys.latency === null
                ? "text-sertex-danger"
                : sys.latency > 300
                ? "text-sertex-warning"
                : "text-sertex-cyan"
            }`}
          >
            {sys.latency === null ? "?" : `${sys.latency}ms`}
          </span>
          {sys.network && (
            <span className="text-sertex-textMuted ml-1">· {sys.network.toUpperCase()}</span>
          )}
        </div>
        {sys.battery !== null && (
          <div className="hud-text text-sertex-textMuted flex items-center gap-1 mt-1">
            {sys.charging ? (
              <BatteryCharging className="h-3 w-3 text-sertex-cyan" />
            ) : (
              <Battery className="h-3 w-3" />
            )}{" "}
            BAT:{" "}
            <span
              className={`tabular-nums ${
                sys.battery < 20 ? "text-sertex-danger" : "text-sertex-cyan"
              }`}
            >
              {sys.battery}%{sys.charging ? " ⚡" : ""}
            </span>
          </div>
        )}
        <div className="hud-text text-sertex-textMuted mt-1">
          FPS: <span className="text-sertex-cyan tabular-nums">{sys.fps}</span>
        </div>
        <div className="hud-text text-sertex-textMuted mt-1">
          CORE: <span className="text-sertex-cyan">GPT-5.2</span>
        </div>
      </div>
    </DraggablePanel>
  );
};
