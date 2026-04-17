import type { CurrencyStatus, Pilot } from "./types";

export function currencyStatus(dateStr: string): CurrencyStatus {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diffDays = Math.floor((target - now) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays < 5) return "critical";
  if (diffDays < 10) return "expiringSoon";
  if (diffDays <= 15) return "warning";
  return "current";
}

export function statusClass(s: CurrencyStatus): string {
  if (s === "expired" || s === "critical") return "currency-expired";
  if (s === "warning" || s === "expiringSoon") return "currency-warning";
  return "currency-current";
}

export function isRedStatus(s: CurrencyStatus): boolean {
  return s === "expired" || s === "critical";
}

export function isYellowStatus(s: CurrencyStatus): boolean {
  return s === "warning" || s === "expiringSoon";
}

const rank: Record<CurrencyStatus, number> = {
  current: 0,
  warning: 1,
  expiringSoon: 2,
  critical: 3,
  expired: 4,
};

export function pilotWorstStatus(p: Pilot): CurrencyStatus {
  const all: CurrencyStatus[] = [
    currencyStatus(p.dayCurrencyDate),
    currencyStatus(p.nightCurrencyDate),
    currencyStatus(p.irtCurrencyDate),
    currencyStatus(p.medicalCurrencyDate),
  ];
  return all.reduce((worst, s) => (rank[s] > rank[worst] ? s : worst), "current" as CurrencyStatus);
}

// Returns the date string of the currency that drives the pilot's worst status.
// Used so badges can show "Expiring Soon · 23 Apr" rather than a bare label.
export function pilotWorstDate(p: Pilot): string | null {
  const entries: { status: CurrencyStatus; date: string }[] = [
    { status: currencyStatus(p.dayCurrencyDate), date: p.dayCurrencyDate },
    { status: currencyStatus(p.nightCurrencyDate), date: p.nightCurrencyDate },
    { status: currencyStatus(p.irtCurrencyDate), date: p.irtCurrencyDate },
    { status: currencyStatus(p.medicalCurrencyDate), date: p.medicalCurrencyDate },
  ];
  let best: { status: CurrencyStatus; date: string } | null = null;
  for (const e of entries) {
    if (!best || rank[e.status] > rank[best.status]) best = e;
  }
  return best && best.status !== "current" ? best.date : null;
}

export function fmtDate(d: string, lang: string): string {
  return new Date(d).toLocaleDateString(lang === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric", month: "short", day: "2-digit",
  });
}

export function fmtDateTime(d: string, lang: string): string {
  return new Date(d).toLocaleString(lang === "ar" ? "ar-EG" : "en-GB", {
    year: "numeric", month: "short", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}
