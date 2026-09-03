// Görev Kopyalama Panosu (Kopyala → Yapıştır).
// Kopyalanan görev "pano"da tutulur; kullanıcı bir iş koluna sağ tıklayıp
// "Yapıştır" deyince bu pano içeriği o iş koluna çoğaltılır. Pano ELLE
// temizlenene kadar kalır → aynı görev birden fazla iş koluna yapıştırılabilir
// (hazır şablon mantığı). localStorage'da kalıcı + pub/sub ile canlı güncellenir.
import { useEffect, useState } from "react";

const KEY = "sertex_task_clipboard_v1";
const subs = new Set();

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

let state = load();

function persist() {
  try {
    if (state) localStorage.setItem(KEY, JSON.stringify(state));
    else localStorage.removeItem(KEY);
  } catch {
    /* yoksay */
  }
}

export function getTaskClipboard() {
  return state;
}

// clip: { sourceId, title, includeSubtasks, includeAttachments }
export function setTaskClipboard(clip) {
  state = clip || null;
  persist();
  subs.forEach((fn) => fn(state));
}

export function clearTaskClipboard() {
  setTaskClipboard(null);
}

export function useTaskClipboard() {
  const [clip, setClip] = useState(state);
  useEffect(() => {
    const fn = (v) => setClip(v);
    subs.add(fn);
    setClip(state);
    return () => subs.delete(fn);
  }, []);
  return clip;
}
