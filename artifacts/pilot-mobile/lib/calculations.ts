import type { PilotProfile, SortieRecord } from "./types";

export interface HalfYearBreakdown {
  day: number;
  night: number;
  nvg: number;
  sim: number;
  captain: number;
  total: number;
  sorties: number;
}

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
  totalSorties: number;
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
  h1: HalfYearBreakdown;
  h2: HalfYearBreakdown;
  h1Hours: number;
  h2Hours: number;
  yearHours: number;
}

const emptyHalf = (): HalfYearBreakdown => ({
  day: 0,
  night: 0,
  nvg: 0,
  sim: 0,
  captain: 0,
  total: 0,
  sorties: 0,
});

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
  // Half-year buckets (full category breakdown, matches old APK
  // "1st 6 months / 2nd 6 months" summary page).
  const h1: HalfYearBreakdown = emptyHalf();
  const h2: HalfYearBreakdown = emptyHalf();

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
        const bucket = m <= 5 ? h1 : h2;
        bucket.day += day;
        bucket.night += night;
        bucket.nvg += nvg;
        bucket.sim += sim;
        bucket.captain += cap;
        bucket.total += day + night;
        bucket.sorties += 1;
      }
    }
  }

  const totalDay = safeNum(profile.openingDay) + aDay;
  const totalNight = safeNum(profile.openingNight) + aNight;
  const totalNvg = safeNum(profile.openingNvg) + aNvg;
  const totalSim = safeNum(profile.openingSim) + aSim;
  const totalCaptain = safeNum(profile.openingCaptain) + aCap;

  // Captain / Second Pilot is a split of *actual flying hours only* (Day +
  // Night). NVG and Sim are tracked separately and must never be charged
  // against the P1/P2 split — they are not stick-time on a real aircraft.
  const flyingTotal = totalDay + totalNight;
  // Grand Total *does* include NVG + Sim so it matches the squadron PC
  // dashboard exactly. Canonical formula, kept identical on both surfaces.
  const grandTotal = flyingTotal + totalNvg + totalSim;
  return {
    totalDay,
    totalNight,
    totalNvg,
    totalSim,
    totalCaptain,
    totalSecondPilot: Math.max(0, flyingTotal - totalCaptain),
    grandTotal,
    totalSorties: sorties.length,
    monthDay: mDay,
    monthNight: mNight,
    monthNvg: mNvg,
    monthSim: mSim,
    monthCaptain: mCap,
    monthTotal: mDay + mNight,
    sortiesThisMonth: mCount,
    h1,
    h2,
    h1Hours: h1.total,
    h2Hours: h2.total,
    yearHours: h1.total + h2.total,
  };
}

export interface CurrencyItem {
  key: "day" | "night" | "nvg" | "irt" | "medical" | "sim";
  label: string;
  expiry: string | null;
  daysRemaining: number | null;
  status: "expired" | "urgent" | "soon" | "ok" | "missing";
}

export function computeCurrencies(profile: PilotProfile): CurrencyItem[] {
  // NVG is a distinct currency from Night — surface its own tile so the
  // pilot sees both expiries side by side and never assumes Night = NVG.
  const items: { key: CurrencyItem["key"]; label: string }[] = [
    { key: "day", label: "Day" },
    { key: "night", label: "Night" },
    { key: "nvg", label: "NVG" },
    { key: "irt", label: "IRT" },
    { key: "medical", label: "Medical" },
    { key: "sim", label: "Simulator" },
  ];

  // Ops can mark a currency N/A for a pilot on the dashboard
  // (e.g. a non-NVG-qualified pilot). Hidden currencies are dropped from
  // the mobile list entirely so the pilot doesn't see a stale tile.
  const hidden = new Set(profile.hiddenCurrencies ?? []);
  const visible = items.filter((i) => !hidden.has(i.key));

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return visible.map(({ key, label }) => {
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
