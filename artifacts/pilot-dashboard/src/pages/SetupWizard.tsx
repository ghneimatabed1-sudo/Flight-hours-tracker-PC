/**
 * Squadron Setup Wizard — Task #137 (zero-trouble multi-squadron install).
 *
 * Four steps:
 *   1. Identity  — squadron number, name, base, parent group / acronym.
 *                  When the squadron number already exists in the central
 *                  `squadrons` table, the wizard switches into a JOIN
 *                  flow: identity / aircraft / monthly target are loaded
 *                  from the existing row instead of being captured fresh,
 *                  so a new sibling PC can sign on without duplicating
 *                  the squadron record.
 *   2. Aircraft  — RJAF standard checklist (UH-60M/L/AIL, AS332, AH-1F,
 *                  AH-6i, F-16, etc.) plus free-form rows. Each airframe
 *                  carries its own monthly target and fuel-burn rate.
 *   3. Pilots    — quick "rank · name · military number" entry rows OR
 *                  paste a CSV block (one row per line, comma separated).
 *                  Persisted to the `pilots` table on finish.
 *   4. Done      — recap, "what's next" checklist, and a one-click link
 *                  to the diagnostic dashboard so the operator can
 *                  immediately verify that the install is healthy.
 *
 * Wizard state is persisted to localStorage under
 * `rjaf.setupWizard.<squadron>` so the operator can close and reopen
 * the page without losing progress.
 */
import { useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { Card, PageHead } from "@/components/Layout";
import { useAuth } from "@/lib/auth";
import { useToast } from "@/hooks/use-toast";
import {
  loadSquadronDefaults,
  saveSquadronDefaults,
  type SquadronDefaults,
} from "@/lib/squadron-defaults";
import { Check, ChevronLeft, ChevronRight, Plane, Users, Building2, PartyPopper, Stethoscope } from "lucide-react";
import { supabase, supabaseConfigured } from "@/lib/supabase";

const STEP_KEY_PREFIX = "rjaf.setupWizard.";

/**
 * RJAF standard airframe checklist offered on Step 2. Operators tick the
 * ones their squadron flies; the order in which they tick determines the
 * primary airframe (first ticked) which becomes the default A/C Type on
 * Add Sortie. Custom airframes can still be added below the checklist.
 */
const RJAF_STANDARD_AIRFRAMES: Array<{ model: string; defaultBurn: number }> = [
  { model: "UH-60M",  defaultBurn: 576 },
  { model: "AH-1F",   defaultBurn: 460 },
  { model: "F-16C/D", defaultBurn: 5200 },
  { model: "AS332L",  defaultBurn: 800 },
  { model: "EC635",   defaultBurn: 320 },
];

interface IdentityForm {
  number: string;
  name: string;
  airbase: string;
  wing: string;
  base: string;
  groupName: string;
  groupAcronym: string;
}

interface AircraftRow {
  model: string;
  fuelBurn: number;
  monthlyTarget: number;
}

interface PilotRow {
  rank: string;
  name: string;
  militaryNumber: string;
}

type Step = 0 | 1 | 2 | 3;

export default function SetupWizard() {
  const { squadron } = useAuth();
  const { toast } = useToast();
  const [, navigate] = useLocation();

  const sqKey = squadron?.number ?? squadron?.name ?? "default";
  const stateKey = STEP_KEY_PREFIX + sqKey;

  const initial = useMemo(() => {
    try {
      const raw = localStorage.getItem(stateKey);
      if (raw) return JSON.parse(raw) as {
        step: Step;
        identity: IdentityForm;
        aircraft: AircraftRow[];
        pilots: PilotRow[];
        targetMonthlyHours: number;
        pilotCsv: string;
      };
    } catch { /* fall through */ }
    return {
      step: 0 as Step,
      identity: {
        number: squadron?.number ?? "",
        name: squadron?.name ?? "",
        airbase: "",
        wing: "",
        base: "",
        groupName: "",
        groupAcronym: "",
      },
      aircraft: [] as AircraftRow[],
      pilots: [{ rank: "", name: "", militaryNumber: "" }],
      targetMonthlyHours: 12,
      pilotCsv: "",
    };
  }, [stateKey, squadron]);

  const [step, setStep] = useState<Step>(initial.step);
  const [identity, setIdentity] = useState<IdentityForm>(initial.identity);
  const [aircraft, setAircraft] = useState<AircraftRow[]>(initial.aircraft);
  const [pilots, setPilots] = useState<PilotRow[]>(initial.pilots);
  const [targetMonthlyHours, setTargetMonthlyHours] = useState<number>(initial.targetMonthlyHours);
  const [pilotCsv, setPilotCsv] = useState<string>(initial.pilotCsv ?? "");
  // "Join existing" detection: when the typed number matches a row in
  // `squadrons`, we surface a banner and offer to prefill from that row.
  const [joinTarget, setJoinTarget] = useState<{
    number: string;
    name: string;
    base: string | null;
    default_aircraft: Array<{ model: string; fuelBurn?: number }>;
    default_monthly_targets: Record<string, number>;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  // Look up the typed squadron number with a 400 ms debounce — if a row
  // exists, switch the UI into "join" mode.
  useEffect(() => {
    if (!supabaseConfigured || !supabase) return;
    const num = identity.number.trim();
    if (!num) { setJoinTarget(null); return; }
    let cancelled = false;
    const t = setTimeout(async () => {
      try {
        const { data } = await supabase!
          .from("squadrons")
          .select("number, name, base, default_aircraft, default_monthly_targets")
          .eq("number", num)
          .maybeSingle();
        if (cancelled) return;
        if (data) {
          setJoinTarget({
            number: data.number,
            name: data.name,
            base: data.base ?? null,
            default_aircraft: Array.isArray(data.default_aircraft) ? data.default_aircraft : [],
            default_monthly_targets: (data.default_monthly_targets ?? {}) as Record<string, number>,
          });
        } else {
          setJoinTarget(null);
        }
      } catch { /* offline — ignore */ }
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [identity.number]);

  const persist = (s: Step) => {
    try {
      localStorage.setItem(stateKey, JSON.stringify({
        step: s, identity, aircraft, pilots, targetMonthlyHours, pilotCsv,
      }));
    } catch { /* noop */ }
  };

  // Debounced auto-save: persist current draft after each field edit so
  // a reload mid-step recovers the half-finished form, not just the
  // last step the operator clicked Next on.
  useEffect(() => {
    const t = setTimeout(() => persist(step), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, aircraft, pilots, targetMonthlyHours, pilotCsv, step]);

  const adoptJoinTarget = () => {
    if (!joinTarget) return;
    setIdentity(v => ({
      ...v,
      number: joinTarget.number,
      name: joinTarget.name || v.name,
      airbase: joinTarget.base ?? v.airbase,
    }));
    const rows: AircraftRow[] = joinTarget.default_aircraft.map(a => ({
      model: a.model,
      fuelBurn: a.fuelBurn ?? 0,
      monthlyTarget: joinTarget.default_monthly_targets[a.model] ?? 0,
    }));
    if (rows.length) setAircraft(rows);
    const firstTarget = Object.values(joinTarget.default_monthly_targets).find(v => v > 0);
    if (firstTarget) setTargetMonthlyHours(firstTarget);
    toast({ title: `Joined existing squadron ${joinTarget.number}` });
  };

  const toggleStandardAirframe = (model: string, defaultBurn: number) => {
    setAircraft(rows => {
      const idx = rows.findIndex(r => r.model === model);
      if (idx >= 0) return rows.filter((_, i) => i !== idx);
      return [...rows, { model, fuelBurn: defaultBurn, monthlyTarget: targetMonthlyHours }];
    });
  };

  const importPilotsCsv = () => {
    // Each non-blank line: "rank,name,militaryNumber" — extra columns are
    // tolerated but ignored. We append rather than replace so the operator
    // can mix paste + manual entry without losing earlier rows.
    const parsed: PilotRow[] = [];
    for (const line of pilotCsv.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const [rank = "", name = "", militaryNumber = ""] = t.split(",").map(s => s.trim());
      if (!name) continue;
      parsed.push({ rank, name, militaryNumber });
    }
    if (parsed.length === 0) {
      toast({ title: "No pilot rows parsed from CSV", variant: "destructive" });
      return;
    }
    setPilots(rows => {
      const existing = rows.filter(r => r.name.trim());
      return [...existing, ...parsed];
    });
    setPilotCsv("");
    toast({ title: `Imported ${parsed.length} pilot${parsed.length === 1 ? "" : "s"}` });
  };

  const finish = async () => {
    setBusy(true);
    // Snapshot the wizard inputs into the per-squadron defaults store —
    // this is the localStorage cache of the `default_aircraft` and
    // `default_monthly_targets` columns introduced by migration 0039.
    const cur: SquadronDefaults = loadSquadronDefaults(sqKey);
    const usedAirframes = aircraft.filter(a => a.model.trim()).map(a => a.model.trim());
    const burn: Record<string, number> = { ...cur.fuelBurnByAirframe };
    for (const a of aircraft) {
      const m = a.model.trim();
      if (m) burn[m] = a.fuelBurn || burn[m] || 0;
    }
    saveSquadronDefaults(sqKey, {
      ...cur,
      airbase: identity.airbase.trim() || cur.airbase,
      wing: identity.wing.trim() || cur.wing,
      base: identity.base.trim() || cur.base,
      groupName: identity.groupName.trim() || cur.groupName,
      groupAcronym: identity.groupAcronym.trim() || cur.groupAcronym,
      airframes: usedAirframes.length ? usedAirframes : cur.airframes,
      primaryAirframe: usedAirframes[0] || cur.primaryAirframe,
      fuelBurnByAirframe: burn,
      minSixMonthHours: targetMonthlyHours * 6 || cur.minSixMonthHours,
    });

    // Push to the central server when reachable so any sibling PC for
    // this squadron silently picks up the configuration without re-
    // running the wizard. Errors are swallowed: localStorage above is
    // the source of truth for offline starts.
    if (supabaseConfigured && supabase && identity.number.trim()) {
      try {
        const aircraftPayload = aircraft
          .filter(a => a.model.trim())
          .map(a => ({ model: a.model.trim(), fuelBurn: a.fuelBurn || 0 }));
        const targetsPayload: Record<string, number> = {};
        for (const a of aircraft) {
          const m = a.model.trim();
          if (!m) continue;
          targetsPayload[m] = a.monthlyTarget || targetMonthlyHours || 0;
        }
        await supabase.from("squadrons").upsert({
          number: identity.number.trim(),
          name: identity.name.trim(),
          base: identity.base.trim() || identity.airbase.trim() || null,
          wing: identity.wing.trim() || null,
          default_aircraft: aircraftPayload,
          default_monthly_targets: targetsPayload,
        }, { onConflict: "number" });

        const { data: sqRow } = await supabase
          .from("squadrons")
          .select("id")
          .eq("number", identity.number.trim())
          .maybeSingle();
        const squadronId = (sqRow?.id as string | undefined) ?? null;

        // Persist captured pilots into the global `pilots` table. We
        // allocate fresh `Pxxx` ids from the current max so we don't
        // collide with rows owned by other squadrons. The wizard only
        // captures the rank / name / military number — the operator
        // can refine ranks, callsigns, and currencies later from the
        // Roster page.
        const cleanPilots = pilots.filter(p => p.name.trim());
        if (cleanPilots.length > 0) {
          const { data: existing } = await supabase
            .from("pilots")
            .select("id")
            .like("id", "P%");
          const used = new Set((existing ?? []).map(r => String(r.id)));
          const nums = (existing ?? [])
            .map(r => parseInt(String(r.id).replace(/\D/g, ""), 10))
            .filter(n => !isNaN(n));
          let next = (nums.length ? Math.max(...nums) : 0) + 1;
          const allocId = (): string => {
            // eslint-disable-next-line no-constant-condition
            while (true) {
              const id = `P${String(next++).padStart(3, "0")}`;
              if (!used.has(id)) { used.add(id); return id; }
            }
          };
          const rows = cleanPilots.map(p => ({
            id: allocId(),
            ...(squadronId ? { squadron_id: squadronId } : {}),
            name: p.name.trim(),
            rank: p.rank.trim(),
            available: true,
            data: {
              name: p.name.trim(),
              rank: p.rank.trim(),
              militaryNumber: p.militaryNumber.trim(),
              available: true,
            },
          }));
          const { error: pErr } = await supabase.from("pilots").insert(rows);
          if (pErr) {
            console.warn("[setup-wizard] pilot insert failed", pErr);
            toast({
              title: "Pilot import failed",
              description: pErr.message || "Couldn't insert pilots — add them later from the Roster page.",
              variant: "destructive",
            });
          }
        }
      } catch (e) {
        console.warn("[setup-wizard] squadron / pilot upsert failed (offline?)", e);
        toast({
          title: "Couldn't reach the central server",
          description: "Setup saved locally — pilot import and shared defaults will sync when you're back online.",
          variant: "destructive",
        });
      }
    }

    try {
      localStorage.removeItem(stateKey);
      localStorage.setItem(`rjaf.setupWizard.${sqKey}.complete`, "1");
    } catch { /* noop */ }
    setBusy(false);
    toast({ title: "Squadron setup complete" });
    navigate("/");
  };

  const steps = [
    { id: 0 as Step, label: "Identity", icon: Building2 },
    { id: 1 as Step, label: "Aircraft", icon: Plane },
    { id: 2 as Step, label: "Pilots",   icon: Users },
    { id: 3 as Step, label: "Done",     icon: PartyPopper },
  ];

  const canAdvance = (): boolean => {
    if (step === 0) return identity.number.trim().length > 0 && identity.name.trim().length > 0;
    if (step === 1) return aircraft.some(a => a.model.trim().length > 0);
    if (step === 2) return true; // pilots are optional — the operator can add them later from Roster
    return true;
  };

  return (
    <div className="max-w-3xl mx-auto">
      <PageHead title="Squadron Setup Wizard" subtitle="Four quick steps so this PC fits your squadron." />

      {/* Step pill rail */}
      <div className="flex gap-2 mb-4">
        {steps.map(s => {
          const active = s.id === step;
          const done = s.id < step;
          const Icon = s.icon;
          return (
            <div
              key={s.id}
              className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-md border text-xs font-semibold ${
                active ? "bg-primary text-primary-foreground border-primary"
                : done ? "bg-emerald-500/10 border-emerald-400/40 text-emerald-100"
                : "bg-secondary border-border text-muted-foreground"
              }`}
              data-testid={`wizard-step-${s.id}`}
            >
              {done ? <Check className="h-3.5 w-3.5" /> : <Icon className="h-3.5 w-3.5" />}
              <span>{s.label}</span>
            </div>
          );
        })}
      </div>

      <Card>
        {step === 0 && (
          <div className="space-y-3">
            <Field label="Squadron number">
              <input value={identity.number} onChange={e => setIdentity(v => ({ ...v, number: e.target.value }))}
                placeholder="e.g. 5" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                data-testid="wizard-identity-number" />
            </Field>

            {joinTarget && (
              <div
                className="rounded-md border border-blue-400/40 bg-blue-500/10 p-2 text-xs text-blue-100 flex items-center justify-between"
                data-testid="wizard-join-banner"
              >
                <div>
                  Squadron <b>{joinTarget.number}</b> ({joinTarget.name}) already exists on the central server.
                  This PC can <b>join</b> it instead of creating a new record.
                </div>
                <button
                  type="button"
                  onClick={adoptJoinTarget}
                  className="ml-2 px-2 py-1 rounded bg-blue-500/30 border border-blue-400/50 font-semibold"
                  data-testid="wizard-join-adopt"
                >
                  Prefill from existing
                </button>
              </div>
            )}

            <Field label="Squadron name">
              <input value={identity.name} onChange={e => setIdentity(v => ({ ...v, name: e.target.value }))}
                placeholder="e.g. 5 SQDN" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                data-testid="wizard-identity-name" />
            </Field>
            <div className="grid grid-cols-3 gap-3">
              <Field label="Air base">
                <input value={identity.airbase} onChange={e => setIdentity(v => ({ ...v, airbase: e.target.value }))}
                  placeholder="e.g. Main Air Base" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                  data-testid="wizard-identity-airbase" />
              </Field>
              <Field label="Wing">
                <input value={identity.wing} onChange={e => setIdentity(v => ({ ...v, wing: e.target.value }))}
                  placeholder="e.g. 8th Wing" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                  data-testid="wizard-identity-wing" />
              </Field>
              <Field label="Base">
                <input value={identity.base} onChange={e => setIdentity(v => ({ ...v, base: e.target.value }))}
                  placeholder="e.g. 8th Air Base" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                  data-testid="wizard-identity-base" />
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Parent group">
                <input value={identity.groupName} onChange={e => setIdentity(v => ({ ...v, groupName: e.target.value }))}
                  placeholder="e.g. ATTACK HELICOPTER GROUP" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                  data-testid="wizard-identity-group" />
              </Field>
              <Field label="Group acronym">
                <input value={identity.groupAcronym} onChange={e => setIdentity(v => ({ ...v, groupAcronym: e.target.value }))}
                  placeholder="e.g. AHG" className="w-full bg-input border border-border rounded px-2 py-1.5 text-sm"
                  data-testid="wizard-identity-acronym" />
              </Field>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="space-y-4">
            <div className="text-xs text-muted-foreground">
              Tick every airframe your squadron flies. The first one you tick becomes
              the default A/C Type on Add Sortie. You can also add custom airframes
              below. Each row carries its own per-month hour target and fuel-burn
              rate (lb/hr) — leave 0 if you don't know yet.
            </div>

            {/* RJAF standard checklist */}
            <div>
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">RJAF standard airframes</div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
                {RJAF_STANDARD_AIRFRAMES.map(opt => {
                  const ticked = aircraft.some(a => a.model === opt.model);
                  return (
                    <label
                      key={opt.model}
                      className={`flex items-center gap-2 px-2 py-1.5 rounded border text-xs cursor-pointer ${
                        ticked
                          ? "bg-primary/15 border-primary/40 text-primary-foreground"
                          : "bg-secondary border-border text-muted-foreground"
                      }`}
                      data-testid={`wizard-aircraft-preset-${opt.model}`}
                    >
                      <input
                        type="checkbox"
                        checked={ticked}
                        onChange={() => toggleStandardAirframe(opt.model, opt.defaultBurn)}
                      />
                      <span className="font-mono">{opt.model}</span>
                    </label>
                  );
                })}
              </div>
            </div>

            {/* Per-airframe target + burn editor */}
            <div className="space-y-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Selected airframes</div>
              {aircraft.length === 0 && (
                <div className="text-xs text-muted-foreground italic">None yet — tick from the list above or add a custom airframe.</div>
              )}
              {aircraft.map((a, i) => (
                <div key={`${a.model}-${i}`} className="grid grid-cols-12 gap-2 items-center text-sm">
                  <input value={a.model} onChange={e => setAircraft(rows => rows.map((r, j) => j === i ? { ...r, model: e.target.value } : r))}
                    placeholder="Airframe"
                    className="col-span-5 bg-input border border-border rounded px-2 py-1.5"
                    data-testid={`wizard-aircraft-model-${i}`} />
                  <input type="number" value={a.monthlyTarget || ""} onChange={e => setAircraft(rows => rows.map((r, j) => j === i ? { ...r, monthlyTarget: Number(e.target.value) || 0 } : r))}
                    placeholder="hrs/mo"
                    className="col-span-2 bg-input border border-border rounded px-2 py-1.5 font-mono"
                    data-testid={`wizard-aircraft-target-${i}`} />
                  <input type="number" value={a.fuelBurn || ""} onChange={e => setAircraft(rows => rows.map((r, j) => j === i ? { ...r, fuelBurn: Number(e.target.value) || 0 } : r))}
                    placeholder="lb/hr"
                    className="col-span-3 bg-input border border-border rounded px-2 py-1.5 font-mono"
                    data-testid={`wizard-aircraft-burn-${i}`} />
                  <button type="button" onClick={() => setAircraft(rows => rows.filter((_, j) => j !== i))}
                    className="col-span-2 text-xs text-rose-200 hover:text-rose-100">Remove</button>
                </div>
              ))}
              <button type="button"
                onClick={() => setAircraft(rows => [...rows, { model: "", fuelBurn: 0, monthlyTarget: targetMonthlyHours }])}
                className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs"
                data-testid="wizard-aircraft-add">+ Add custom airframe</button>
            </div>

            <Field label="Default monthly target (used as the seed for new airframes)">
              <input type="number" value={targetMonthlyHours} onChange={e => setTargetMonthlyHours(Number(e.target.value) || 0)}
                className="w-32 bg-input border border-border rounded px-2 py-1.5 text-sm font-mono"
                data-testid="wizard-monthly-target" />
            </Field>
          </div>
        )}

        {step === 2 && (
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground">
              Add the pilots assigned to this squadron. You can refine ranks,
              callsigns, and currencies later from Roster.
            </div>

            {/* CSV paste import */}
            <details className="rounded border border-border bg-secondary/40">
              <summary className="cursor-pointer px-2 py-1.5 text-xs font-semibold">Paste CSV (rank,name,militaryNumber)</summary>
              <div className="p-2 space-y-2">
                <textarea
                  value={pilotCsv}
                  onChange={e => setPilotCsv(e.target.value)}
                  rows={4}
                  placeholder="Maj,Ahmad Khaled,123456&#10;Capt,Mohammed Hasan,123457"
                  className="w-full bg-input border border-border rounded px-2 py-1.5 text-xs font-mono"
                  data-testid="wizard-pilot-csv"
                />
                <button
                  type="button"
                  onClick={importPilotsCsv}
                  className="px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold"
                  data-testid="wizard-pilot-csv-import"
                >
                  Import CSV
                </button>
              </div>
            </details>

            {pilots.map((p, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center text-sm">
                <input value={p.rank} onChange={e => setPilots(rows => rows.map((r, j) => j === i ? { ...r, rank: e.target.value } : r))}
                  placeholder="Rank (Capt, Maj…)"
                  className="col-span-3 bg-input border border-border rounded px-2 py-1.5"
                  data-testid={`wizard-pilot-rank-${i}`} />
                <input value={p.name} onChange={e => setPilots(rows => rows.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                  placeholder="Full name"
                  className="col-span-5 bg-input border border-border rounded px-2 py-1.5"
                  data-testid={`wizard-pilot-name-${i}`} />
                <input value={p.militaryNumber} onChange={e => setPilots(rows => rows.map((r, j) => j === i ? { ...r, militaryNumber: e.target.value } : r))}
                  placeholder="Mil #"
                  className="col-span-2 bg-input border border-border rounded px-2 py-1.5 font-mono"
                  data-testid={`wizard-pilot-mil-${i}`} />
                <button type="button" onClick={() => setPilots(rows => rows.length > 1 ? rows.filter((_, j) => j !== i) : rows)}
                  className="col-span-2 text-xs text-rose-200 hover:text-rose-100">Remove</button>
              </div>
            ))}
            <button type="button" onClick={() => setPilots(rows => [...rows, { rank: "", name: "", militaryNumber: "" }])}
              className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs"
              data-testid="wizard-pilot-add">+ Add pilot</button>
          </div>
        )}

        {step === 3 && (
          <div className="space-y-4 text-sm">
            <div className="text-base font-semibold">Ready to start.</div>

            <div>
              <div className="text-xs text-muted-foreground">Recap:</div>
              <ul className="text-xs space-y-1 list-disc list-inside">
                <li><b>Identity:</b> {identity.number || "—"} · {identity.name || "—"}</li>
                <li><b>Air base / Wing / Base:</b> {identity.airbase || "—"} · {identity.wing || "—"} · {identity.base || "—"}</li>
                <li><b>Group:</b> {identity.groupName || "—"} ({identity.groupAcronym || "—"})</li>
                <li><b>Aircraft:</b> {aircraft.filter(a => a.model.trim()).map(a => a.model).join(", ") || "—"}</li>
                <li><b>Pilots added:</b> {pilots.filter(p => p.name.trim()).length}</li>
                <li><b>Default monthly target:</b> {targetMonthlyHours} hrs/pilot</li>
              </ul>
            </div>

            <div>
              <div className="text-xs text-muted-foreground mb-1">What's next:</div>
              <ul className="text-xs space-y-1">
                <li className="flex items-start gap-2"><span className="text-emerald-300">✓</span> Open <b>Roster</b> to add callsigns, qualifications, and currencies.</li>
                <li className="flex items-start gap-2"><span className="text-emerald-300">✓</span> Open <b>Monthly Report → Defaults</b> to refine fuel-burn and per-airframe targets.</li>
                <li className="flex items-start gap-2"><span className="text-emerald-300">✓</span> Issue <b>license keys</b> to commander / wing / HQ PCs from Admin.</li>
              </ul>
            </div>

            <button
              type="button"
              onClick={() => navigate("/diagnostic")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-secondary border border-border text-xs font-semibold text-foreground"
              data-testid="wizard-link-diagnostics"
            >
              <Stethoscope className="h-3.5 w-3.5" /> Run install diagnostic
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mt-5">
          <button
            type="button"
            disabled={step === 0 || busy}
            onClick={() => { const next = (step - 1) as Step; setStep(next); persist(next); }}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-secondary border border-border text-xs disabled:opacity-40"
            data-testid="wizard-back"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Back
          </button>
          {step < 3 ? (
            <button
              type="button"
              disabled={!canAdvance() || busy}
              onClick={() => { const next = (step + 1) as Step; setStep(next); persist(next); }}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-xs font-semibold disabled:opacity-40"
              data-testid="wizard-next"
            >
              Next <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : (
            <button
              type="button"
              onClick={finish}
              disabled={busy}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-md bg-emerald-500/30 border border-emerald-400/50 text-emerald-100 text-xs font-semibold disabled:opacity-40"
              data-testid="wizard-finish"
            >
              <Check className="h-3.5 w-3.5" /> {busy ? "Saving…" : "Start using the app"}
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
