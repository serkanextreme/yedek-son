// Görev Kopyalama Panosu (Kopyala → Yapıştır) — mobil.
// Kopyalanan görev "pano"da tutulur; kullanıcı bir iş kolu başlığındaki
// "Yapıştır" düğmesine dokununca o iş koluna çoğaltılır. Pano ELLE
// temizlenene kadar kalır → aynı görev birden fazla iş koluna yapıştırılabilir.
// storage'da (JSON string) kalıcı + pub/sub ile canlı güncellenir.
import { useEffect, useState } from "react";
import { storage } from "@/src/utils/storage";

const KEY = "sertex.task.clipboard.v1";

export type TaskClip = {
  sourceId: string;
  title: string;
  includeSubtasks: boolean;
  includeAttachments: boolean;
};

let state: TaskClip | null = null;
let hydrated = false;
const subs = new Set<(c: TaskClip | null) => void>();

function emit() {
  subs.forEach((fn) => fn(state));
}

async function hydrate() {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = await storage.getItem<string | null>(KEY, null);
    state = raw ? (JSON.parse(raw) as TaskClip) : null;
  } catch {
    state = null;
  }
  emit();
}

export function getTaskClipboard(): TaskClip | null {
  return state;
}

export function setTaskClipboard(clip: TaskClip | null) {
  state = clip;
  if (clip) storage.setItem(KEY, JSON.stringify(clip));
  else storage.removeItem(KEY);
  emit();
}

export function clearTaskClipboard() {
  setTaskClipboard(null);
}

export function useTaskClipboard(): TaskClip | null {
  const [clip, setClip] = useState<TaskClip | null>(state);
  useEffect(() => {
    const fn = (c: TaskClip | null) => setClip(c);
    subs.add(fn);
    setClip(state);
    if (!hydrated) hydrate();
    return () => {
      subs.delete(fn);
    };
  }, []);
  return clip;
}
