// Monthly Report engine — computes ORFG RCN Forms 1, 2, 3, 4 and the
// Arabic roster sheet from existing pilot + sortie data, leaving only the
// values that genuinely change month-to-month (squadron strength,
// discipline morale, planned sorties, lecture hours, etc.) for the ops
// pilot to enter through a small wizard.

import type { Pilot, Sortie } from "./mock";

export type MissionBucket =
  | "GH" | "IF" | "NF_NVG" | "FORM_NAV" | "COURSES"
  | "EVAL_STAND" | "EMER" | "MTF" | "GP_CONT" | "MSN" | "OTHER";

export const MISSION_BUCKETS: MissionBucket[] = [
  "GH","IF","NF_NVG","FORM_NAV","COURSES","EVAL_STAND","EMER","MTF","GP_CONT","MSN","OTHER",
];

export const MISSION_LABEL: Record<MissionBucket,string> = {
  GH: "GH", IF: "IF", NF_NVG: "NF & NVG", FORM_NAV: "FORM & NAV",
  COURSES: "COURSES", EVAL_STAND: "EVAL & STAND", EMER: "EMER",
  MTF: "MTF", GP_CONT: "GP CONT", MSN: "MSN", OTHER: "OTHER",
};

export const NEXT_PLAN_EXERCISES = ["GH","IF","NVG","NIGHT","CONTINUATION TRNG","MTF"] as const;
export type NextPlanExercise = typeof NEXT_PLAN_EXERCISES[number];

export const LECTURE_NAMES = [
  "BOLD FACE","EMER. & LIMIT.","NIGHT TOPICS","FLT MANUAL (-10)","HOT WEATHER TOPICS",
] as const;
export type LectureName = typeof LECTURE_NAMES[number];

export interface ReportInputs {
  /* Form 3 squadron header */
  squadronStrength: number;
  ops: number;
  attached: number;
  course: number;
  sickLeave: number;
  sickRatePct: number;
  morale: "HIGH" | "MEDIUM" | "LOW";
  incidents: string;
  accidents: string;
  /* Form 3 planned vs achieved (achieved auto-computed; planned is user input) */
  plannedSorties: number;
  plannedHours: number;
  weatherAbortS: number; weatherAbortH: number;
  maintAbortS: number;   maintAbortH: number;
  opsAbortS: number;     opsAbortH: number;
  airAbortS: number;     airAbortH: number;
  /* Form 3 lectures */
  lectures: { name: string; hours: number; quizPct: number; remarks: string }[];
  /* Form 4 next-month plan */
  nextMonthPlanFor: string; // "YYYY-MM"
  pilotsAvailableNext: number;
  opsNext: number;
  nextPlan: {
    exercise: string;
    pilots: number;
    sortiesPerPilot: number;
    durationPerSortie: number;
    ammo275: string; ammo127: string; ammo762: string;
    remarks: string;
  }[];
  ammoPrev: { rkt275: string; mm127: string; mm762: string };
  ammoReq:  { rkt275: string; mm127: string; mm762: string };
  /* Form 1 per-pilot overrides */
  perPilotStatus: Record<string, string>;
  perPilotRemarks: Record<string, string>;
}

/* ───────────── helpers ───────────── */

function pad2(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export function monthBounds(period: string): { start: Date; endExclusive: Date; eomInclusive: Date } {
  const [y, m] = period.split("-").map(Number);
  const start = new Date(y, m - 1, 1);
  const endExclusive = new Date(y, m, 1);
  const eomInclusive = new Date(y, m, 0);
  return { start, endExclusive, eomInclusive };
}

export function nextPeriod(period: string): string {
  const [y, m] = period.split("-").map(Number);
  const d = new Date(y, m, 1); // m is 0-based for next month after period
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function lastCompletedPeriod(now: Date = new Date()): string {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`;
}

export function periodLabel(period: string, _lang: "en"|"ar" = "en"): string {
  // MM-YYYY in line with the squadron-wide DD-MM-YYYY standard.
  const [y, m] = period.split("-");
  return `${m}-${y}`;
}

export function missionBucket(s: Sortie): MissionBucket {
  const t = ((s.sortieType || "") + " " + (s.name || "")).toUpperCase();
  if (/MTF|TEST FLIGHT/.test(t)) return "MTF";
  if (/EVAL|STAND/.test(t)) return "EVAL_STAND";
  if (/EMER/.test(t)) return "EMER";
  if (/GP\s*CONT/.test(t)) return "GP_CONT";
  if (/COURSE|\bCRS\b/.test(t)) return "COURSES";
  if (/FORM|NAV/.test(t)) return "FORM_NAV";
  if (/\bNF\b|\bNVG\b|NIGHT FLIGHT/.test(t)) return "NF_NVG";
  if (/^IF\b|INSTRUMENT/.test(t)) return "IF";
  if (/\bGH\b|GENERAL HANDLING/.test(t)) return "GH";
  if (/\bMSN\b|MISSION/.test(t)) return "MSN";
  return "OTHER";
}

export function defaultPilotStatus(p: Pilot): string {
  const q = (p.qualifications || []).join(",").toUpperCase();
  if (/FLT\.?CMDR|FLIGHT CMDR/.test(q)) return "FLT.CMDR";
  if (/QHI/.test(q)) return "QHI+FL+MTP";
  if (/MTP/.test(q)) return "PILOT+MTP";
  if (/CO-?PILOT/.test(q)) return "CO-PILOT";
  // fall back by rank — senior officers default to PILOT, others to CO-PILOT
  if (/LTC|MAJ|CPT|CAPT/i.test(p.rank)) return "PILOT";
  return "CO-PILOT";
}

export function currencyState(expiry: string | undefined, eomInclusive: Date): "C" | "R" | "N/C" | "U/R" {
  if (!expiry) return "U/R";
  const e = new Date(expiry);
  if (Number.isNaN(e.getTime())) return "U/R";
  const days = Math.round((e.getTime() - eomInclusive.getTime()) / 86400000);
  if (days >= 30) return "C";
  if (days >= 0) return "R";
  if (days >= -30) return "N/C";
  return "U/R";
}

/* ───────────── per-pilot monthly totals ───────────── */

export interface PilotMonthRow {
  pilot: Pilot;
  status: string;
  day1: number; day2: number; dayDual: number;
  night1: number; night2: number; nightDual: number;
  nvg: number;
  totalForMonth: number;
  cap: number; sor: number;
  ifSim: number; ifAct: number;
  remarks: string;
}

export function buildForm1Rows(
  pilots: Pilot[],
  sorties: Sortie[],
  period: string,
  inputs: Pick<ReportInputs, "perPilotStatus" | "perPilotRemarks">,
): PilotMonthRow[] {
  const monthSorties = sorties.filter(s => (s.date || "").startsWith(period));
  return pilots.map(p => {
    const mine = monthSorties.filter(s => s.pilotId === p.id || s.coPilotId === p.id);
    let day1=0,day2=0,dayDual=0,night1=0,night2=0,nightDual=0,nvg=0,sim=0,act=0,cap=0,sor=0;
    for (const s of mine) {
      const isAsPilot = s.pilotId === p.id;
      const explicitCap = isAsPilot ? s.pilotIsCaptain : s.coPilotIsCaptain;
      const isPic = typeof explicitCap === "boolean" ? explicitCap : isAsPilot;
      const isCo  = s.coPilotId === p.id;
      if (isPic) { day1 += s.day1||0; night1 += s.night1||0; cap++; }
      if (isCo)  { day2 += s.day2||0; night2 += s.night2||0; }
      dayDual += (s.dayDual||0) / (isPic && isCo ? 1 : 1);
      nightDual += (s.nightDual||0);
      nvg += (s.nvg||0);
      sim += (s.sim||0);
      act += (s.actual||0);
      sor++;
    }
    const totalForMonth = round1(day1+day2+dayDual+night1+night2+nightDual);
    return {
      pilot: p,
      // Per the v1.0.6 directive: leave the status BLANK when the officer
      // hasn't filled it in. Previously we auto-guessed from rank/quals which
      // could mislead. The wizard's per-pilot override row is the only source.
      status: inputs.perPilotStatus[p.id] || "",
      day1: round1(day1), day2: round1(day2), dayDual: round1(dayDual),
      night1: round1(night1), night2: round1(night2), nightDual: round1(nightDual),
      nvg: round1(nvg),
      totalForMonth,
      cap, sor,
      ifSim: round1(sim), ifAct: round1(act),
      remarks: inputs.perPilotRemarks[p.id] || "",
    };
  });
}

function round1(n: number): number { return Math.round(n * 10) / 10; }

/* ───────────── Form 2 ───────────── */

export interface PilotForm2Row {
  pilot: Pilot;
  totalForMonthAllTypes: number;
  grandTotal: number;
  currencyNF: "C" | "R" | "N/C" | "U/R";
  currencyIF: "C" | "R" | "N/C" | "U/R";
  ifSimMonth: number;
  ifActMonth: number;
  ifSimTotal: number;
  ifActTotal: number;
  ifExpiryDate: string;
  remarks: string;
}

export function buildForm2Rows(
  pilots: Pilot[],
  sorties: Sortie[],
  period: string,
  form1: PilotMonthRow[],
): PilotForm2Row[] {
  const { eomInclusive } = monthBounds(period);
  const allSortiesByPilot = new Map<string, Sortie[]>();
  for (const s of sorties) {
    [s.pilotId, s.coPilotId].filter(Boolean).forEach(id => {
      const arr = allSortiesByPilot.get(id) || [];
      arr.push(s);
      allSortiesByPilot.set(id, arr);
    });
  }
  return pilots.map((p, idx) => {
    const f1 = form1[idx];
    const all = allSortiesByPilot.get(p.id) || [];
    const cumDay = all.reduce((a,s) => a + (s.day1||0) + (s.day2||0) + (s.dayDual||0), 0);
    const cumNight = all.reduce((a,s) => a + (s.night1||0) + (s.night2||0) + (s.nightDual||0), 0);
    const cumNvg = all.reduce((a,s) => a + (s.nvg||0), 0);
    const cumSim = all.reduce((a,s) => a + (s.sim||0), 0);
    const cumAct = all.reduce((a,s) => a + (s.actual||0), 0);
    const grandTotal = round1((p.openingDay||0) + (p.openingNight||0) + (p.openingNvg||0) + cumDay + cumNight + cumNvg);
    return {
      pilot: p,
      totalForMonthAllTypes: f1.totalForMonth,
      grandTotal,
      currencyNF: currencyState(p.expiry?.day, eomInclusive),
      currencyIF: currencyState(p.expiry?.irt, eomInclusive),
      ifSimMonth: f1.ifSim,
      ifActMonth: f1.ifAct,
      ifSimTotal: round1(cumSim),
      ifActTotal: round1(cumAct),
      ifExpiryDate: p.expiry?.irt || "",
      remarks: f1.remarks,
    };
  });
}

/* ───────────── Form 3 ───────────── */

export interface Form3Computed {
  missionTotals: Record<MissionBucket, { sorties: number; hours: number }>;
  totalSorties: number;
  totalHours: number;
  achievedSorties: number;
  achievedHours: number;
}

/**
 * Derived percentages on top of Form 3 — these aren't stored, just rendered.
 * Achievement is achieved/planned (handles divide-by-zero).
 * Weather % is weather-aborted sorties as a share of attempted sorties.
 */
export function deriveForm3Stats(inputs: ReportInputs, computed: Form3Computed) {
  const planS = inputs.plannedSorties || 0;
  const planH = inputs.plannedHours  || 0;
  const totalAbortS = inputs.weatherAbortS + inputs.maintAbortS + inputs.opsAbortS + inputs.airAbortS;
  const totalAbortH = round1(inputs.weatherAbortH + inputs.maintAbortH + inputs.opsAbortH + inputs.airAbortH);
  const attempted = computed.achievedSorties + totalAbortS;
  return {
    achievementSortiesPct: planS ? round1((computed.achievedSorties / planS) * 100) : 0,
    achievementHoursPct:   planH ? round1((computed.achievedHours   / planH) * 100) : 0,
    totalAbortSorties: totalAbortS,
    totalAbortHours: totalAbortH,
    weatherAbortPct: attempted ? round1((inputs.weatherAbortS / attempted) * 100) : 0,
  };
}

/* Pre-fill helper used by the "Auto-fill" wizard button. Looks at the
 * previous month's actual achievement and proposes that as next month's
 * plan — a sensible starting point the officer can tweak in seconds. */
export function suggestNextMonthPlanFrom(prevAchieved: { sorties: number; hours: number }) {
  return {
    plannedSorties: prevAchieved.sorties,
    plannedHours: prevAchieved.hours,
  };
}

export function buildForm3(sorties: Sortie[], period: string): Form3Computed {
  const monthSorties = sorties.filter(s => (s.date || "").startsWith(period));
  const totals = Object.fromEntries(
    MISSION_BUCKETS.map(b => [b, { sorties: 0, hours: 0 }])
  ) as Record<MissionBucket, { sorties: number; hours: number }>;
  for (const s of monthSorties) {
    const b = missionBucket(s);
    totals[b].sorties += 1;
    totals[b].hours += (s.day1||0)+(s.day2||0)+(s.dayDual||0)+(s.night1||0)+(s.night2||0)+(s.nightDual||0);
  }
  for (const b of MISSION_BUCKETS) totals[b].hours = round1(totals[b].hours);
  const achievedSorties = monthSorties.length;
  const achievedHours = round1(monthSorties.reduce((a,s) =>
    a + (s.day1||0)+(s.day2||0)+(s.dayDual||0)+(s.night1||0)+(s.night2||0)+(s.nightDual||0), 0));
  return {
    missionTotals: totals,
    totalSorties: achievedSorties,
    totalHours: achievedHours,
    achievedSorties,
    achievedHours,
  };
}

/* ───────────── Arabic roster sheet ───────────── */

export interface ArabicRosterRow {
  pilot: Pilot;
  medicalExpiry: string;
  lastFlightDate: string;
  cumulativeHoursUH60M: number;
  monthHours: number;
}

export function buildArabicRoster(
  pilots: Pilot[],
  sorties: Sortie[],
  period: string,
  form1: PilotMonthRow[],
): ArabicRosterRow[] {
  return pilots.map((p, idx) => {
    const all = sorties.filter(s => s.pilotId === p.id || s.coPilotId === p.id);
    const lastFlight = all
      .map(s => s.date)
      .filter(Boolean)
      .sort()
      .pop() || "";
    const cum = all.reduce((a,s) =>
      a + (s.day1||0)+(s.day2||0)+(s.dayDual||0)+(s.night1||0)+(s.night2||0)+(s.nightDual||0), 0);
    const grand = round1((p.openingDay||0)+(p.openingNight||0)+(p.openingNvg||0) + cum);
    return {
      pilot: p,
      medicalExpiry: p.expiry?.medical || "",
      lastFlightDate: lastFlight,
      cumulativeHoursUH60M: grand,
      monthHours: form1[idx]?.totalForMonth || 0,
    };
  });
}

/* ───────────── persistence ───────────── */

const KEY_PREFIX = "rjaf.monthlyReport.";

export function loadInputs(period: string): ReportInputs | null {
  try {
    const raw = localStorage.getItem(KEY_PREFIX + period);
    return raw ? JSON.parse(raw) as ReportInputs : null;
  } catch { return null; }
}

export function saveInputs(period: string, inputs: ReportInputs): void {
  try { localStorage.setItem(KEY_PREFIX + period, JSON.stringify(inputs)); } catch { /* noop */ }
}

export function defaultInputs(period: string, pilots: Pilot[]): ReportInputs {
  return {
    squadronStrength: pilots.length,
    ops: 0, attached: 0, course: 0, sickLeave: 0,
    sickRatePct: 0,
    morale: "HIGH",
    incidents: "NIL", accidents: "NIL",
    plannedSorties: 0, plannedHours: 0,
    weatherAbortS: 0, weatherAbortH: 0,
    maintAbortS: 0,   maintAbortH: 0,
    opsAbortS: 0,     opsAbortH: 0,
    airAbortS: 0,     airAbortH: 0,
    lectures: LECTURE_NAMES.map(n => ({ name: n, hours: 0, quizPct: 0, remarks: "" })),
    nextMonthPlanFor: nextPeriod(period),
    pilotsAvailableNext: pilots.length,
    opsNext: 0,
    nextPlan: NEXT_PLAN_EXERCISES.map(ex => ({
      exercise: ex, pilots: 0, sortiesPerPilot: 0, durationPerSortie: 0,
      ammo275: "-", ammo127: "-", ammo762: "-", remarks: "",
    })),
    ammoPrev: { rkt275: "-", mm127: "-", mm762: "-" },
    ammoReq:  { rkt275: "-", mm127: "-", mm762: "-" },
    perPilotStatus: {},
    perPilotRemarks: {},
  };
}
