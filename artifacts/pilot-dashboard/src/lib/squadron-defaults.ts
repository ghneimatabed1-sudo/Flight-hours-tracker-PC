/**
 * Squadron-level Monthly Report defaults.
 *
 * Why this exists
 * ───────────────
 * The Monthly Report has three kinds of fields:
 *   1. AUTO  — pulled from the Sortie log / Roster / Currency directly.
 *   2. DEFAULT — values that almost never change month-to-month for a given
 *      squadron (lecture topics, the standard exercise list, fuel-burn rate
 *      per airframe, the standard incidents/accidents wording, ammo
 *      placeholders). The operations pilot edits these once for their
 *      squadron and they prefill every month after.
 *   3. MANUAL — true commander judgement (sick rate, abort tallies, lecture
 *      hours/quiz scores, planned-vs-achieved figures). Filled per-month.
 *
 * This module owns category 2. Each squadron has its own set of defaults
 * keyed by `squadronNumber` so the same APK can be deployed to other
 * squadrons (with different airframes, different fuel rates, different
 * lecture syllabus) and each one keeps its own baseline.
 *
 * Storage is plain localStorage on the operations pilot PC — same scope as
 * the per-period saved inputs in monthly-report.ts.
 */

const KEY_PREFIX = "rjaf.monthlyReport.defaults.";

/** Default lecture topics taught every month at the squadron level. */
const FACTORY_LECTURES = [
  "EMERGENCY PROCEDURES",
  "AIRCRAFT SYSTEMS",
  "AERODYNAMICS",
  "INSTRUMENT PROCEDURES",
  "TACTICS",
  "SAFETY",
];

/** Default exercise types in the next-month plan grid. */
const FACTORY_EXERCISES = ["GH", "IF", "NVG", "NIGHT", "CONTINUATION TRNG", "MTF"];

/**
 * Aircraft models the squadron operates. Drives the A/C Type dropdown on
 * Add Sortie, the Sortie Log edit form, and the seed value on every new
 * Flight Program row. NO.8 SQDN flies UH-60M and UH-60AIL with AS332 as a
 * crossover; an AH-1F squadron would replace these. Operator-editable.
 */
const FACTORY_AIRFRAMES = ["UH-60M", "UH-60L", "UH-60AIL", "AS332"];

/**
 * Per-airframe fuel burn rate (lb/hr). UH-60M is the squadron's primary
 * airframe and burns 576 lb/hr per the workbook. Operators can add more
 * airframe entries (e.g. UH-60AIL, AH-1, OH-58) on the defaults page.
 */
const FACTORY_FUEL_BURN: Record<string, number> = {
  "UH-60M": 576,
  "UH-60AIL": 576,
};

export interface SquadronDefaults {
  /** Default lecture topics — operator can add/remove on the defaults page. */
  lectures: string[];
  /** Default exercise types in next-month plan grid. */
  exercises: string[];
  /** Default morale used when starting a brand-new period. */
  morale: "HIGH" | "MEDIUM" | "LOW";
  /** Default text for INCIDENTS field — almost always "NIL". */
  incidentsDefault: string;
  /** Default text for ACCIDENTS field — almost always "NIL". */
  accidentsDefault: string;
  /** Per-airframe fuel burn rate (lb/hr). Editable. */
  fuelBurnByAirframe: Record<string, number>;
  /** Default ammo placeholder text — workbook uses "-" or "NIL". */
  ammoPlaceholder: string;
  /** Default REMARKS suggestions enabled (auto-fill from leave/TDY records). */
  autoSuggestRemarks: boolean;
  /** Minimum hours required across the rolling 6-month window. Drives the
   *  currency flag on the printed SIX-MONTHS sheet. Typical UH-60M
   *  squadrons run 30 hrs / 6 months as the floor, but other airframes /
   *  other regulators may differ — operator edits per squadron. */
  minSixMonthHours: number;
  /** Higher-echelon name printed at the top of every Monthly Report sheet
   *  (above the squadron). For NO.8 SQDN this is "QUICK REACTION FORCE
   *  GROUP". Other RJAF squadrons sit under different parents (e.g. an
   *  AH-1F squadron under "ATTACK HELICOPTER GROUP"); editing this once
   *  per APK install retitles the whole packet. */
  groupName: string;
  /** Acronym for the parent group, used as the prefix on every form name
   *  ("QRFG RCN FORM 1", "QRFG FUEL", "QRFG AUTHORIZATION", etc.) and on
   *  the unit block of F1/F2/F3. Defaults to "QRFG". Operators editing
   *  `groupName` should also update this. */
  groupAcronym: string;
  /** Primary airframe model (e.g. "UH-60M", "AH-1F", "UH-60AIL"). Used
   *  as the F1 unit-cell fallback, the Arabic-roster column header,
   *  and the FUEL helper text. Combined with the per-airframe burn rate
   *  in `fuelBurnByAirframe` to drive the Form 4 fuel formula. */
  primaryAirframe: string;
  /** All aircraft models the squadron operates, in the order they should
   *  appear in dropdowns. Drives the A/C Type select on Add Sortie, the
   *  Sortie Log edit form, and the seed value on every new Flight Program
   *  row. NO.8 SQDN flies UH-60M / UH-60L / UH-60AIL plus AS332 as a
   *  crossover; an AH-1F squadron would replace the list entirely. */
  airframes: string[];
  /** Short label shown on the Sortie Log header on Add Sortie
   *  ("QREG · 2026-04-23 · UH-60M"). NO.8 SQDN uses "QREG" (Quick
   *  Reaction Group) — other squadrons may use "SQNREG", "FLTLOG",
   *  or any short tag of their choice. Editing this once per APK
   *  install retitles the daily log header. */
  sortieLogLabel: string;
}

export function factoryDefaults(): SquadronDefaults {
  return {
    lectures: [...FACTORY_LECTURES],
    exercises: [...FACTORY_EXERCISES],
    morale: "HIGH",
    incidentsDefault: "NIL",
    accidentsDefault: "NIL",
    fuelBurnByAirframe: { ...FACTORY_FUEL_BURN },
    ammoPlaceholder: "-",
    autoSuggestRemarks: true,
    minSixMonthHours: 30,
    groupName: "QUICK REACTION FORCE GROUP",
    groupAcronym: "QRFG",
    primaryAirframe: "UH-60M",
    airframes: [...FACTORY_AIRFRAMES],
    sortieLogLabel: "QREG",
  };
}

export function loadSquadronDefaults(squadronNumber: string | undefined): SquadronDefaults {
  const key = squadronNumber || "default";
  try {
    const raw = localStorage.getItem(KEY_PREFIX + key);
    if (!raw) return factoryDefaults();
    const parsed = JSON.parse(raw) as Partial<SquadronDefaults>;
    // Merge with factory so newly-added fields survive an upgrade.
    const f = factoryDefaults();
    return {
      lectures: parsed.lectures?.length ? parsed.lectures : f.lectures,
      exercises: parsed.exercises?.length ? parsed.exercises : f.exercises,
      morale: parsed.morale ?? f.morale,
      incidentsDefault: parsed.incidentsDefault ?? f.incidentsDefault,
      accidentsDefault: parsed.accidentsDefault ?? f.accidentsDefault,
      fuelBurnByAirframe: { ...f.fuelBurnByAirframe, ...(parsed.fuelBurnByAirframe || {}) },
      ammoPlaceholder: parsed.ammoPlaceholder ?? f.ammoPlaceholder,
      autoSuggestRemarks: parsed.autoSuggestRemarks ?? f.autoSuggestRemarks,
      minSixMonthHours: parsed.minSixMonthHours ?? f.minSixMonthHours,
      groupName: parsed.groupName ?? f.groupName,
      groupAcronym: parsed.groupAcronym ?? f.groupAcronym,
      primaryAirframe: parsed.primaryAirframe ?? f.primaryAirframe,
      airframes: parsed.airframes?.length ? parsed.airframes : f.airframes,
      sortieLogLabel: parsed.sortieLogLabel ?? f.sortieLogLabel,
    };
  } catch {
    return factoryDefaults();
  }
}

export function saveSquadronDefaults(squadronNumber: string | undefined, d: SquadronDefaults): void {
  const key = squadronNumber || "default";
  try {
    localStorage.setItem(KEY_PREFIX + key, JSON.stringify(d));
  } catch { /* noop */ }
}

/**
 * Look up the burn rate for an airframe; fall back to UH-60M (576) and then
 * to a reasonable global default. Used by the Form 4 fuel formula.
 */
export function fuelBurnFor(d: SquadronDefaults, airframe: string | undefined): number {
  if (airframe && d.fuelBurnByAirframe[airframe] != null) return d.fuelBurnByAirframe[airframe];
  if (d.fuelBurnByAirframe["UH-60M"] != null) return d.fuelBurnByAirframe["UH-60M"];
  return 576;
}
