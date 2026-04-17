import type { CurrencyStatus, Pilot } from "./types";

export function currencyStatus(dateStr: string, warningDays = 30): CurrencyStatus {
  const target = new Date(dateStr).getTime();
  const now = Date.now();
  const diffDays = Math.floor((target - now) / 86400000);
  if (diffDays < 0) return "expired";
  if (diffDays <= warningDays) return "warning";
  return "current";
}

export function statusClass(s: CurrencyStatus): string {
  if (s === "expired") return "currency-expired";
  if (s === "warning") return "currency-warning";
  return "currency-current";
}

export function pilotWorstStatus(p: Pilot): CurrencyStatus {
  const s = [
    currencyStatus(p.dayCurrencyDate),
    currencyStatus(p.nightCurrencyDate),
    currencyStatus(p.irtCurrencyDate),
    currencyStatus(p.medicalCurrencyDate),
  ];
  if (s.includes("expired")) return "expired";
  if (s.includes("warning")) return "warning";
  return "current";
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
