// Per-squadron currency window overrides. The ops officer can change the
// refresh window (default 60 days) for Day and NVG/Night currencies so the
// auto-bump on sortie save matches local SOP. Stored in localStorage so it
// survives reloads on the same desktop client.

import { useEffect, useState } from "react";

export interface CurrencyWindow {
  day: number;
  nvg: number;
}

export const DEFAULT_CURRENCY_WINDOW: CurrencyWindow = { day: 60, nvg: 60 };
const LS_KEY = "rjaf_currency_window_v1";

function clamp(n: number): number {
  if (!Number.isFinite(n)) return 60;
  return Math.max(1, Math.min(365, Math.round(n)));
}

export function getCurrencyWindow(): CurrencyWindow {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return { ...DEFAULT_CURRENCY_WINDOW };
    const p = JSON.parse(raw) as Partial<CurrencyWindow>;
    return {
      day: clamp(Number(p.day ?? DEFAULT_CURRENCY_WINDOW.day)),
      nvg: clamp(Number(p.nvg ?? DEFAULT_CURRENCY_WINDOW.nvg)),
    };
  } catch {
    return { ...DEFAULT_CURRENCY_WINDOW };
  }
}

export function setCurrencyWindow(w: CurrencyWindow): void {
  const next: CurrencyWindow = { day: clamp(w.day), nvg: clamp(w.nvg) };
  localStorage.setItem(LS_KEY, JSON.stringify(next));
  window.dispatchEvent(new CustomEvent("rjaf:currency-window", { detail: next }));
}

export function useCurrencyWindow(): [CurrencyWindow, (w: CurrencyWindow) => void] {
  const [w, setW] = useState<CurrencyWindow>(() => getCurrencyWindow());
  useEffect(() => {
    const onChange = () => setW(getCurrencyWindow());
    window.addEventListener("rjaf:currency-window", onChange);
    window.addEventListener("storage", onChange);
    return () => {
      window.removeEventListener("rjaf:currency-window", onChange);
      window.removeEventListener("storage", onChange);
    };
  }, []);
  return [w, (next) => { setCurrencyWindow(next); setW(next); }];
}
