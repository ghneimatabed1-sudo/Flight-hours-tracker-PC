// Mirrors the clean totals logic used by the RJAF mobile app
// (artifacts/pilot-mobile/lib/calculations.ts) so both apps report the
// same numbers for the same pilot. Totals = opening balance + sum of
// sorties the pilot appeared in (as P1 OR P2). Captain hours credit
// only when that seat's `pilotIsCaptain` / `coPilotIsCaptain` flag is set.
//
// The full year breakdown is split into calendar halves (H1 = Jan–Jun,
// H2 = Jul–Dec) so the Cycle page and the Pilot Detail page can show the
// pilot's training load by half-cycle. The opening balance is intentionally
// EXCLUDED from H1/H2 — those buckets only count sorties flown this calendar
// year. NVG hours stay in their own column and are NEVER folded into Night.
import type { Pilot, Sortie } from "./mock";

export interface HalfYearBreakdown {
  day: number;
  night: number;
  nvg: number;
  sim: number;
  captain: number;
  total: number;   // day + night (NVG kept separate per RJAF SOP)
  sorties: number;
}

export interface PilotTotals {
  monthDay: number;
  monthNight: number;
  monthNvg: number;
  monthSim: number;
  monthCaptain: number;
  monthTotal: number;
  totalDay: number;
  totalNight: number;
  totalNvg: number;
  totalSim: number;
  totalCaptain: number;
  grandTotal: number;
  sortiesThisMonth: number;
  // Calendar-year half breakdowns (current year only). Opening balance is
  // excluded so these reflect actual sorties flown in H1/H2 of THIS year.
  h1: HalfYearBreakdown;
  h2: HalfYearBreakdown;
  h1Hours: number;
  h2Hours: number;
  yearHours: number;
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

const emptyHalf = (): HalfYearBreakdown => ({
  day: 0, night: 0, nvg: 0, sim: 0, captain: 0, total: 0, sorties: 0,
});

// Sum a sortie's category hours for ONE pilot. Two routing strategies:
//
// 1) Seat-aware (preferred, set by the rebuilt Add Sortie page):
//    The sortie carries `pilotSeatStatus` / `coPilotSeatStatus` plus a
//    single flight `time`. We attribute `time` to the requested pilot's
//    own seat — so a (1st × Dual) sortie credits the 1st-seat pilot with
//    `time` flying hours and the dual-seat pilot with `time` instruction
//    hours, never double-counting.
//
// 2) Legacy fallback (historical records & demo data without seat status):
//    Sum the flat day1+day2+dayDual style buckets. The legacy single-seat
//    Add Sortie page only ever wrote one seat's hours into those flat
//    fields, so this path stays correct for old data.
function sortieCategories(s: Sortie, isP1: boolean) {
  const seatStatus = isP1 ? s.pilotSeatStatus : s.coPilotSeatStatus;
  const time = n(s.time);
  if (seatStatus && time > 0 && s.condition) {
    const day = s.condition === "Day" ? time : 0;
    const night = s.condition === "Night" ? time : 0;
    const nvg = s.condition === "NVG" ? time : 0;
    const sim = n(s.sim);
    return { day, night, nvg, sim, actual: time + sim };
  }
  // Legacy path — flat bucket sum.
  const day = n(s.day1) + n(s.day2) + n(s.dayDual);
  const night = n(s.night1) + n(s.night2) + n(s.nightDual);
  const nvg = n(s.nvg) || (n(s.nvg1) + n(s.nvg2) + n(s.nvgDual));
  const sim = n(s.sim);
  const actual = n(s.actual) || day + night + nvg + sim;
  return { day, night, nvg, sim, actual };
}

export function computePilotTotals(pilot: Pilot, allSorties: Sortie[]): PilotTotals {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = now.getMonth();

  let mDay = 0, mNight = 0, mNvg = 0, mSim = 0, mCap = 0, mCount = 0;
  let aDay = 0, aNight = 0, aNvg = 0, aSim = 0, aCap = 0;
  const h1: HalfYearBreakdown = emptyHalf();
  const h2: HalfYearBreakdown = emptyHalf();

  for (const s of allSorties) {
    const isP1 = s.pilotId === pilot.id;
    const isP2 = s.coPilotId === pilot.id;
    if (!isP1 && !isP2) continue;

    const c = sortieCategories(s, isP1);
    // Captain credit prefers explicit per-seat flag (set by the rebuilt
    // Add Sortie page where each seat carries its own captain flag).
    // Falls back to the legacy assumption that P1 = captain for very old
    // records that pre-date the per-seat flag.
    const flag = isP1 ? s.pilotIsCaptain : s.coPilotIsCaptain;
    const captainCredit = typeof flag === "boolean" ? flag : isP1;
    const cap = captainCredit ? c.actual : 0;

    aDay += c.day; aNight += c.night; aNvg += c.nvg; aSim += c.sim; aCap += cap;

    const parts = (s.date || "").split("-");
    if (parts.length === 3) {
      const y = Number(parts[0]);
      const m = Number(parts[1]) - 1;
      if (y === yyyy && m === mm) {
        mDay += c.day; mNight += c.night; mNvg += c.nvg; mSim += c.sim; mCap += cap;
        mCount += 1;
      }
      // H1/H2 buckets only count sorties flown in the current calendar year.
      if (y === yyyy) {
        const bucket = m <= 5 ? h1 : h2;
        bucket.day += c.day;
        bucket.night += c.night;
        bucket.nvg += c.nvg;
        bucket.sim += c.sim;
        bucket.captain += cap;
        // `total` excludes NVG to match the mobile/old-APK convention where
        // the half-year column "Total" = Day+Night and NVG sits in its own
        // column.
        bucket.total += c.day + c.night;
        bucket.sorties += 1;
      }
    }
  }

  const totalDay = n(pilot.openingDay) + aDay;
  const totalNight = n(pilot.openingNight) + aNight;
  const totalNvg = n(pilot.openingNvg) + aNvg;
  const totalSim = aSim;
  const totalCaptain = aCap;

  const round1 = (v: number) => +v.toFixed(1);
  const roundHalf = (h: HalfYearBreakdown): HalfYearBreakdown => ({
    day: round1(h.day),
    night: round1(h.night),
    nvg: round1(h.nvg),
    sim: round1(h.sim),
    captain: round1(h.captain),
    total: round1(h.total),
    sorties: h.sorties,
  });
  const h1r = roundHalf(h1);
  const h2r = roundHalf(h2);

  return {
    monthDay: round1(mDay),
    monthNight: round1(mNight),
    monthNvg: round1(mNvg),
    monthSim: round1(mSim),
    monthCaptain: round1(mCap),
    monthTotal: round1(mDay + mNight + mNvg + mSim),
    totalDay: round1(totalDay),
    totalNight: round1(totalNight),
    totalNvg: round1(totalNvg),
    totalSim: round1(totalSim),
    totalCaptain: round1(totalCaptain),
    grandTotal: round1(totalDay + totalNight + totalNvg + totalSim),
    sortiesThisMonth: mCount,
    h1: h1r,
    h2: h2r,
    h1Hours: h1r.total,
    h2Hours: h2r.total,
    yearHours: round1(h1r.total + h2r.total),
  };
}

// Handy when we have the full roster + sortie list and want a
// name/id → totals lookup in O(pilots × sorties_touching_them).
export function computeAllTotals(pilots: Pilot[], sorties: Sortie[]): Record<string, PilotTotals> {
  const out: Record<string, PilotTotals> = {};
  for (const p of pilots) out[p.id] = computePilotTotals(p, sorties);
  return out;
}

export function formatHours(v: number): string {
  if (!Number.isFinite(v)) return "0.0";
  return v.toFixed(1);
}
