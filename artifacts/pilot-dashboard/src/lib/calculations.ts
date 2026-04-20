// Mirrors the clean totals logic used by the RJAF mobile app
// (artifacts/pilot-mobile/lib/calculations.ts) so both apps report the
// same numbers for the same pilot. Totals = opening balance + sum of
// sorties the pilot appeared in (as P1 OR P2). Captain hours credit
// only when the pilot was P1 on the sortie.
import type { Pilot, Sortie } from "./mock";

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
}

function n(v: unknown): number {
  const x = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(x) ? x : 0;
}

// Sum Day buckets (day1/day2/dayDual) and Night buckets from a sortie
// record. NVG and Sim are single fields. Actual hours fall back to the
// sum of Day+Night+NVG+Sim when `actual` is blank.
function sortieCategories(s: Sortie) {
  const day = n(s.day1) + n(s.day2) + n(s.dayDual);
  const night = n(s.night1) + n(s.night2) + n(s.nightDual);
  const nvg = n(s.nvg);
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
    }
  }

  const totalDay = n(pilot.openingDay) + aDay;
  const totalNight = n(pilot.openingNight) + aNight;
  const totalNvg = n(pilot.openingNvg) + aNvg;
  // Web `Pilot` has no opening Sim/Captain field, so totals start at the
  // sortie-derived numbers. Matches the seed data convention.
  const totalSim = aSim;
  const totalCaptain = aCap;

  return {
    monthDay: +mDay.toFixed(1),
    monthNight: +mNight.toFixed(1),
    monthNvg: +mNvg.toFixed(1),
    monthSim: +mSim.toFixed(1),
    monthCaptain: +mCap.toFixed(1),
    monthTotal: +(mDay + mNight + mNvg + mSim).toFixed(1),
    totalDay: +totalDay.toFixed(1),
    totalNight: +totalNight.toFixed(1),
    totalNvg: +totalNvg.toFixed(1),
    totalSim: +totalSim.toFixed(1),
    totalCaptain: +totalCaptain.toFixed(1),
    grandTotal: +(totalDay + totalNight + totalNvg + totalSim).toFixed(1),
    sortiesThisMonth: mCount,
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
