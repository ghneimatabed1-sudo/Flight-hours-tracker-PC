import type { PilotProfile, SortieRecord } from "./types";

export interface PilotTotals {
  totalDay: number;
  totalNight: number;
  totalNvg: number;
  totalSim: number;
  totalCaptain: number;
  // Hours flown as the non-captain crew member (second pilot / co-pilot).
  // Derived as grandTotal − totalCaptain so it always stays consistent with
  // whatever definition of "captain" the upstream sortie uses.
  totalSecondPilot: number;
  grandTotal: number;
  monthDay: number;
  monthNight: number;
  monthNvg: number;
  monthSim: number;
  monthCaptain: number;
  monthTotal: number;
  sortiesThisMonth: number;
  // Year-to-date rollups, split into calendar halves so the pilot can see
  // training load in the first and second half of the current year at a
  // glance (matches the old APK's "1st 6 / 2nd 6" cards).
  h1Hours: number;
  h2Hours: number;
  yearHours: number;
}

function safeNum(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n ?? 0);
  return Number.isFinite(v) ? v : 0;
}

export function computeTotals(
  profile: PilotProfile,
  sorties: SortieRecord[]
): PilotTotals {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  let mDay = 0,
    mNight = 0,
    mNvg = 0,
    mSim = 0,
    mCap = 0,
    mCount = 0;
  let aDay = 0,
    aNight = 0,
    aNvg = 0,
    aSim = 0,
    aCap = 0;
  // Half-year buckets (sum of day + night only; matches old APK which
  // tracked "flight hours" per half and kept sim/NVG separate).
  let h1 = 0,
    h2 = 0;

  for (const s of sorties) {
    const day = safeNum(s.day);
    const night = safeNum(s.night);
    const nvg = safeNum(s.nvg);
    const sim = safeNum(s.sim);
    const total = safeNum(s.total);
    const cap = s.pilotIsCaptain ? total : 0;

    aDay += day;
    aNight += night;
    aNvg += nvg;
    aSim += sim;
    aCap += cap;

    // Parse date as local Y/M/D to avoid timezone off-by-one issues.
    const parts = (s.date || "").split("-");
    if (parts.length === 3) {
      const y = Number(parts[0]);
      const m = Number(parts[1]) - 1;
      if (y === yyyy && m === mm) {
        mDay += day;
        mNight += night;
        mNvg += nvg;
        mSim += sim;
        mCap += cap;
        mCount += 1;
      }
      // Half-year bucketing uses only the current calendar year so the
      // pilot never sees last year's flights counted in "this year's" halves.
      if (y === yyyy) {
        const flightOnly = day + night;
        if (m <= 5) h1 += flightOnly;
        else h2 += flightOnly;
      }
    }
  }

  const totalDay = safeNum(profile.openingDay) + aDay;
  const totalNight = safeNum(profile.openingNight) + aNight;
  const totalNvg = safeNum(profile.openingNvg) + aNvg;
  const totalSim = safeNum(profile.openingSim) + aSim;
  const totalCaptain = safeNum(profile.openingCaptain) + aCap;

  const grandTotal = totalDay + totalNight;
  return {
    totalDay,
    totalNight,
    totalNvg,
    totalSim,
    totalCaptain,
    totalSecondPilot: Math.max(0, grandTotal - totalCaptain),
    grandTotal,
    monthDay: mDay,
    monthNight: mNight,
    monthNvg: mNvg,
    monthSim: mSim,
    monthCaptain: mCap,
    monthTotal: mDay + mNight,
    sortiesThisMonth: mCount,
    h1Hours: h1,
    h2Hours: h2,
    yearHours: h1 + h2,
  };
}

export interface CurrencyItem {
  key: "day" | "night" | "irt" | "medical" | "sim";
  label: string;
  expiry: string | null;
  daysRemaining: number | null;
  status: "expired" | "urgent" | "soon" | "ok" | "missing";
}

export function computeCurrencies(profile: PilotProfile): CurrencyItem[] {
  const items: { key: CurrencyItem["key"]; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "night", label: "Night" },
    { key: "irt", label: "IRT" },
    { key: "medical", label: "Medical" },
    { key: "sim", label: "Simulator" },
  ];

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return items.map(({ key, label }) => {
    const raw = profile.expiry?.[key];
    if (!raw) {
      return { key, label, expiry: null, daysRemaining: null, status: "missing" };
    }
    const parts = raw.split("-");
    if (parts.length !== 3) {
      return { key, label, expiry: raw, daysRemaining: null, status: "missing" };
    }
    const exp = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
    const days = Math.floor((exp.getTime() - today.getTime()) / 86400000);
    let status: CurrencyItem["status"];
    if (days < 0) status = "expired";
    else if (days <= 14) status = "urgent";
    else if (days <= 45) status = "soon";
    else status = "ok";
    return { key, label, expiry: raw, daysRemaining: days, status };
  });
}

export function formatHours(n: number): string {
  if (!Number.isFinite(n)) return "0.0";
  return n.toFixed(1);
}
