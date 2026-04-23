import { useEffect, useMemo, useState } from "react";
import DateInput from "@/components/DateInput";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { useAuth } from "@/lib/auth";
import { loadSquadronDefaults } from "@/lib/squadron-defaults";
import { Button } from "@/components/ui/button";
import { Printer, Save, Settings, Send, X as CloseIcon, Check, X, Trash2, Eye, EyeOff } from "lucide-react";
import FlightScheduleSheet, { emptyProgramRow } from "@/components/FlightScheduleSheet";
import {
  type ScheduleProgram,
  type ScheduleProgramRow,
  useRegisteredPCs,
  useSubmitSchedule,
  useScheduleShares,
  useDecideSchedule,
  useDeleteScheduleShare,
  makePcMatcher,
  getLocalPcId,
  getFlightBinding,
} from "@/lib/cross-pc";
import { useToast } from "@/hooks/use-toast";

type Mode = ScheduleProgram["mode"];

const MODES: { id: Mode; label: string }[] = [
  { id: "DAY",            label: "DAY" },
  { id: "NIGHT",          label: "NIGHT" },
  { id: "NVG",            label: "NVG" },
  { id: "DAY_AND_NVG",    label: "DAY & NVG" },
  { id: "DAY_AND_NIGHT",  label: "DAY & NIGHT" },
];

interface Defaults {
  airbase: string;
  squadron: string;
  fltCmdr: string;
  sqdnCmdr: string;
  // A/C type used as the seed for every new row. Editable here so a
  // CH-47 squadron can change the default once instead of typing it
  // into every sortie line.
  acType: string;
}

const STORAGE_PREFIX  = "rjaf.flightProgram.";
const DEFAULTS_KEY    = "rjaf.flightProgram.defaults";

/**
 * Compose the factory defaults from live squadron data + Squadron Defaults
 * (Monthly Report page). This way a fresh install at NO.5 SQDN flying
 * UH-60AIL gets the right airbase / squadron name / airframe baked in
 * without the operator having to type them — instead of the old behaviour
 * which hard-coded NO.8's KING ABDULLAH II AIRBASE / NO.8 SQDN / UH-60M.
 *
 * The operator can still override any of these from the in-page Defaults
 * dialog; the localStorage layer (DEFAULTS_KEY) wins over the squadron
 * record. Pre-existing NO.8 saves continue to load unchanged.
 */
const factoryDefaultsFor = (
  squadron: { name?: string; base?: string; number?: string } | null | undefined,
): Defaults => {
  const sqd = loadSquadronDefaults(squadron?.number);
  return {
    airbase:  squadron?.base ?? "",
    squadron: squadron?.name ?? "",
    fltCmdr:  "",
    sqdnCmdr: "",
    acType:   sqd.primaryAirframe || "UH-60M",
  };
};

const loadDefaults = (
  squadron: { name?: string; base?: string; number?: string } | null | undefined,
): Defaults => {
  const factory = factoryDefaultsFor(squadron);
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return { ...factory };
    return { ...factory, ...(JSON.parse(raw) as Partial<Defaults>) };
  } catch {
    return { ...factory };
  }
};
const saveDefaults = (d: Defaults) => localStorage.setItem(DEFAULTS_KEY, JSON.stringify(d));

const emptyProgram = (date: string, defaults: Defaults): ScheduleProgram => ({
  date,
  mode: "DAY_AND_NVG",
  airbase:        defaults.airbase,
  squadron:       defaults.squadron,
  dayRows:        [emptyProgramRow("D",   defaults.acType)],
  nightRows:      [emptyProgramRow("NVG", defaults.acType)],
  mainBriefer:    "",
  briefTime:      "",
  dayOps:         "",
  nightOps:       "",
  lecture:        "",
  capte:          "",
  nightBrief:     "",
  reportingTime:  "",
  acNeededDay:    { main: "", stby: "" },
  acNeededNight:  { main: "", stby: "" },
  fltCmdr:        defaults.fltCmdr,
  sqdnCmdr:       defaults.sqdnCmdr,
});

const loadProgram = (date: string, defaults: Defaults): ScheduleProgram => {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + date);
    if (!raw) return emptyProgram(date, defaults);
    const parsed = JSON.parse(raw) as Partial<ScheduleProgram>;
    return { ...emptyProgram(date, defaults), ...parsed };
  } catch {
    return emptyProgram(date, defaults);
  }
};

const saveProgram = (p: ScheduleProgram) =>
  localStorage.setItem(STORAGE_PREFIX + p.date, JSON.stringify(p));

// Build the legacy compact-row payload that the schedule-share diff
// machinery still uses. The full sheet travels alongside it as
// `program` so the receiver sees the actual paper.
function programToShareRows(p: ScheduleProgram) {
  const rows: ScheduleProgramRow[] = [...p.dayRows, ...p.nightRows];
  return rows
    .filter(r => r.acType.trim() || r.pilot.trim() || r.msnDuty.trim() || r.toTime.trim())
    .map((r, i) => ({
      id:       `R-${i}`,
      ac:       `${r.acType}${r.dn ? ` ${r.dn}` : ""}`.trim(),
      config:   r.configuration,
      route:    r.route ?? "",
      crew:     [r.pilot, r.coPilot].filter(Boolean),
      mission:  r.msnDuty,
      takeoff:  r.toTime || r.atcTakeoff,
      land:     r.atcLanding,
      fuel:     r.fuel,
    }));
}

export default function FlightProgram() {
  const { t, lang, dir, rankOf } = useI18n();
  const pilotsQ = usePilots();
  const PILOTS  = pilotsQ.data;
  const { user, squadron } = useAuth();
  const { toast } = useToast();
  const submit = useSubmitSchedule();
  const registry = useRegisteredPCs();

  // Access — squadron ops officer, squadron commander, and flight
  // commander on the HQ dashboard may open this page. The flight
  // commander's recipient picker is reshaped to the bound squadron
  // commander only (see `targets` below).
  // Schedule sharing is strictly between Flight Commanders and their
  // related Squadron Commander. Every other tier (wing / base / HQ) and
  // the Ops Pilot's PC are intentionally excluded.
  // v1.1.63: schedule authoring (and the page itself) is open to the
  // three squadron-internal roles that participate in schedule
  // sharing — Flight Cmdr, Squadron Cmdr, and Ops Pilot. Wing / Base /
  // HQ never compose or receive flight schedules.
  const canAccess =
    user?.role === "ops"
    || (user?.role === "commander" && (user?.scope === "flight" || user?.scope === "squadron"));
  const canPrint = canAccess;
  const isFlightCmdr = user?.role === "commander" && user?.scope === "flight";

  const todayIso = new Date().toISOString().slice(0, 10);
  const [defaults, setDefaults]       = useState<Defaults>(() => loadDefaults(squadron));
  const [date, setDate]               = useState<string>(todayIso);
  const [prog, setProg]               = useState<ScheduleProgram>(() => loadProgram(todayIso, loadDefaults(squadron)));
  const [savedFlash, setSavedFlash]   = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);
  const [showSubmit, setShowSubmit]   = useState(false);
  const [submitTo, setSubmitTo]       = useState("");
  // v1.1.41: Flight Cmdr may temporarily unlock the bound recipient and
  // pick a specific PC (e.g. the Sqn Cmdr PC explicitly, instead of the
  // bound Ops PC). The bound binding is preserved — only the picker is
  // expanded for THIS submit.
  const [unlockRecipient, setUnlockRecipient] = useState(false);

  // When the date changes, swap to that day's program (or a fresh one).
  useEffect(() => { setProg(loadProgram(date, defaults)); }, [date, defaults]);

  const pilotOptions = useMemo(
    () => PILOTS.map(p => ({ value: p.name, label: `${rankOf(p)} ${p.name}` })),
    [PILOTS],
  );

  // PCs that can receive a flight schedule. The squadron sends to its
  // monitoring Wing PC, but ops officers also share peer-to-peer for
  // visibility — so we list every registered PC that is not us. The
  // Flight Commander PC is scoped to its bound squadron — but the
  // squadron has TWO physical PCs (Ops and Sqn Cmdr) that both need to
  // be addressable. v1.1.57: expand the lock to include both peer PCs
  // of the bound squadron so flight commanders can pick either one
  // from the dropdown (defaults to the bound PC, but switchable).
  const flightBinding = isFlightCmdr ? getFlightBinding() : null;
  const isSquadronCmdr = user?.role === "commander" && user?.scope === "squadron";
  // Squadron base name extracted from the bound PC id. Bound id is
  // either the bare squadron name (Ops PC, e.g. "NO.8") or a
  // SQDNCMD:<sqn>#<suffix> form (Sqn Cmdr PC). Either way, the base is
  // the squadron name itself — that's the join key that lets us pull
  // both peer PCs out of the registry.
  const boundSquadronBase = useMemo<string | null>(() => {
    if (!flightBinding?.pcId) return null;
    const id = flightBinding.pcId;
    if (id.startsWith("SQDNCMD:")) {
      const after = id.slice("SQDNCMD:".length);
      const hashIdx = after.indexOf("#");
      return hashIdx < 0 ? after : after.slice(0, hashIdx);
    }
    if (!id.includes(":")) return id; // Ops PC bare-name id
    return null;
  }, [flightBinding?.pcId]);
  const targets = useMemo(
    () => {
      const all = registry.data.filter(p => !p.isSelf);
      // Flight Commander → scoped to all PCs of the bound squadron.
      // That means the bare-name Ops PC ("NO.8") AND any Sqn Cmdr PC
      // for the same squadron ("SQDNCMD:NO.8#<suffix>"). Both surfaces
      // need to be selectable so the operator can pick whichever desk
      // is staffed at the time.
      if (isFlightCmdr && boundSquadronBase) {
        const opsId = boundSquadronBase;
        const sqdnPrefix = `SQDNCMD:${boundSquadronBase}`;
        return all.filter(p =>
          p.id === opsId
          || p.id === sqdnPrefix
          || p.id.startsWith(`${sqdnPrefix}#`),
        );
      }
      // v1.1.64 — Squadron Commander targets:
      //   • Flight Commander PCs — return / share a program with a flight
      //   • The squadron's Ops Pilot PC — publish to the always-on desk
      //   • Wing Commander PCs — submit up the chain for Wing approval;
      //     Wing-approved schedules then auto-flow to Base + HQ as
      //     read-only finals (see canViewFinalSchedules).
      // Base / HQ are read-only viewers, never direct recipients.
      if (isSquadronCmdr) {
        return all.filter(p => p.tier === "flight" || p.tier === "squadron" || p.tier === "wing");
      }
      // v1.1.100 — Ops Pilot targets: Flight Cmdr ONLY. The org-chart
      // rule is non-negotiable: Ops never talks to Sqn / Wing / Base
      // directly. Schedule Chain enforces the same rule; FlightProgram
      // must match so an operator can't bypass the chain by submitting
      // straight from the daily-sheet editor.
      // v1.1.102 — widened with id-prefix fallback. `rowToPc` already
      // decodes a FLIGHT: id prefix to tier="flight", but if any row
      // slips through with a stale tier column (legacy writes, local
      // fallback entries written before the prefix scheme), the id
      // prefix is the authoritative signal. Belt-and-suspenders so Ops
      // never sees an empty Flight-Cmdr dropdown when a Flight Cmdr PC
      // IS actually in the registry — the exact symptom reported at
      // NO.8 SQDN on 23-Apr.
      if (user?.role === "ops") {
        return all.filter(p =>
          p.tier === "flight"
          || p.id.startsWith("FLIGHT:"),
        );
      }
      return all;
    },
    [registry.data, isFlightCmdr, isSquadronCmdr, flightBinding?.pcId, user?.role],
  );
  // v1.1.38: forgiving fallback. When the strict tier filter yields zero
  // PCs (the Sqn Cmdr saw "— pick a registered PC —" and nothing else
  // because every Flight PC in his registry was tagged with the legacy
  // tier="squadron" and got filtered out), expose every non-self PC the
  // registry knows about so the operator can ship the schedule anyway.
  const targetsFallback = useMemo(
    () => registry.data.filter(p => !p.isSelf),
    [registry.data],
  );
  const usingFallbackTargets = targets.length === 0 && targetsFallback.length > 0;
  const effectiveTargets = usingFallbackTargets ? targetsFallback : targets;
  const selectedTarget = effectiveTargets.find(p => p.id === submitTo);

  // Auto-pick the bound squadron commander for flight commanders so the
  // operator never has to confirm a recipient — Submit just sends.
  useEffect(() => {
    if (isFlightCmdr && flightBinding && submitTo !== flightBinding.pcId) {
      setSubmitTo(flightBinding.pcId);
    }
  }, [isFlightCmdr, flightBinding?.pcId, submitTo]);

  const update = (next: ScheduleProgram) => setProg(next);
  const updateField = <K extends keyof ScheduleProgram>(k: K, v: ScheduleProgram[K]) =>
    setProg(p => ({ ...p, [k]: v }));

  const doSave = () => {
    saveProgram(prog);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1400);
  };

  const doSubmit = async () => {
    if (!selectedTarget) {
      toast({ title: "Pick a PC to share with", variant: "destructive" });
      return;
    }
    const rows = programToShareRows(prog);
    if (rows.length === 0) {
      toast({ title: "Add at least one sortie row first", variant: "destructive" });
      return;
    }
    saveProgram(prog);
    const myPcId = getLocalPcId() || (squadron?.name ?? user?.username ?? "self");
    const myName = squadron?.name ?? user?.displayName ?? "Local PC";
    await submit.mutateAsync({
      date: prog.date,
      originSquadronId:   myPcId,
      originSquadronName: myName,
      rows,
      targetPcId:   selectedTarget.id,
      targetPcName: selectedTarget.squadronName,
      targetTier:   (selectedTarget.tier === "flight" ? "flight"
                    : selectedTarget.tier === "wing"   ? "wing"
                    : "squadron"),
      submittedBy:  user?.username ?? "ops",
      program:      prog,
    });
    toast({ title: `Schedule shared with ${selectedTarget.squadronName}` });
    setShowSubmit(false);
    setSubmitTo("");
  };

  // v1.1.63 — schedule sharing is squadron-internal: Flight Cmdr,
  // Squadron Cmdr, and Ops Pilot only. Wing / Base / HQ never see the
  // page or its inbox. Composer authoring stays restricted to the two
  // commander scopes; Ops Pilot uses the inbox panel below to act on
  // shares addressed to the ops desk.
  const canSeeShareInbox =
    user?.role === "super_admin"
    || user?.role === "ops"
    || (user?.role === "commander" && (user?.scope === "flight" || user?.scope === "squadron"));

  if (!canAccess) {
    return (
      <div className="p-6 space-y-4" dir={dir}>
        {canSeeShareInbox && <FlightProgramShareInbox />}
        <div className="rounded-md border border-border bg-card p-6 max-w-xl">
          <div className="text-sm font-semibold mb-1">{t("nav_flight_program")}</div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {canSeeShareInbox
              ? (lang === "ar"
                  ? "تأليف برنامج طيران جديد متاح فقط لقائد السرب وقائد الرحلة. الإجراءات على البرامج الواردة متاحة لضابط العمليات أعلاه."
                  : "Authoring a new flight program is available only to the squadron and flight commanders. Actions on incoming programs are available to the ops pilot above.")
              : (lang === "ar"
                  ? "هذه الصفحة متاحة فقط لضابط عمليات السرب وقائد السرب وقائد الرحلة."
                  : "This page is available only to the squadron ops pilot, the squadron commander, and the flight commander.")}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir={dir}>
      <FlightProgramShareInbox />
      {/* Toolbar — hidden on print. Date + mode + Save + Print + Submit + Defaults. */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <DateInput
          value={date}
          onChange={(v) => setDate(v || todayIso)}
          className="px-2 py-1.5 rounded-md bg-input border border-border text-sm tabular-nums"
          data-testid="input-fp-date"
        />
        <div className="inline-flex rounded-md border border-border overflow-hidden">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => updateField("mode", m.id)}
              className={`px-3 py-1.5 text-xs font-medium ${
                prog.mode === m.id
                  ? "bg-primary text-primary-foreground"
                  : "bg-secondary/40 hover:bg-secondary"
              }`}
              data-testid={`button-mode-${m.id}`}
            >
              {m.label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="outline" onClick={doSave} data-testid="button-save-program">
          <Save className="h-3.5 w-3.5 me-1" />
          {savedFlash ? t("saved") : t("save")}
        </Button>
        <Button
          size="sm"
          onClick={() => setShowSubmit(v => !v)}
          data-testid="button-submit-program"
          className="bg-emerald-600 hover:bg-emerald-700 text-white"
        >
          <Send className="h-3.5 w-3.5 me-1" />
          Submit
        </Button>
        {canPrint && (
          <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="button-print-program">
            <Printer className="h-3.5 w-3.5 me-1" />
            {t("print")}
          </Button>
        )}
        <Button size="sm" variant="outline" onClick={() => setShowDefaults((v) => !v)} data-testid="button-fp-defaults">
          <Settings className="h-3.5 w-3.5 me-1" />
          Defaults
        </Button>
      </div>

      {/* Submit panel — sits right next to the toolbar so the operator
          picks the recipient PC and sends the schedule for sharing. */}
      {showSubmit && (
        <div className="no-print border border-emerald-600/40 bg-emerald-500/5 rounded-md p-3 text-sm space-y-2" data-testid="submit-panel">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-xs">Share this flight schedule with another PC</div>
            <button
              onClick={() => setShowSubmit(false)}
              className="text-muted-foreground hover:text-foreground"
              aria-label="Close"
              data-testid="button-close-submit"
            >
              <CloseIcon className="h-4 w-4" />
            </button>
          </div>
          <div className="grid sm:grid-cols-3 gap-2">
            <label className="sm:col-span-2 flex flex-col gap-1">
              <span className="text-[11px] text-muted-foreground">
                {isFlightCmdr && flightBinding && !unlockRecipient
                  ? "Recipient (bound Squadron — Ops + Cmdr will both see it)"
                  : "Recipient PC"}
              </span>
              {isFlightCmdr && flightBinding && !unlockRecipient ? (
                <div
                  className="px-2 py-1.5 rounded-md bg-secondary/40 border border-border text-sm font-medium flex items-center justify-between gap-2"
                  data-testid="bound-recipient"
                >
                  <span className="truncate">{flightBinding.pcName}</span>
                  <button
                    type="button"
                    onClick={() => { setUnlockRecipient(true); setSubmitTo(""); }}
                    className="text-[11px] text-amber-300 hover:text-amber-200 underline whitespace-nowrap"
                    data-testid="button-unlock-recipient"
                  >
                    Change…
                  </button>
                </div>
              ) : (
                <>
                  <select
                    value={submitTo}
                    onChange={(e) => setSubmitTo(e.target.value)}
                    className="px-2 py-1.5 rounded-md bg-input border border-border text-sm"
                    data-testid="select-submit-target"
                  >
                    <option value="">— pick a registered PC —</option>
                    {effectiveTargets.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.deviceName || p.squadronName} · {p.tier}{p.online ? " · online" : " · offline"}
                      </option>
                    ))}
                  </select>
                  {usingFallbackTargets && (
                    <span className="text-[10px] text-amber-300">
                      No PC matched the strict tier filter — showing every PC in the registry ({effectiveTargets.length}). Pick the right one manually.
                    </span>
                  )}
                  {effectiveTargets.length === 0 && (
                    <span className="text-[10px] text-amber-300">
                      Registry is empty on this PC. Sign in once on the recipient PC with internet so this PC can see it.
                    </span>
                  )}
                  {/* v1.1.102 — Ops diagnostic panel. When Ops sees zero
                      Flight Cmdr PCs but the registry DOES contain other
                      PCs, surface that list so the operator can tell the
                      difference between "nobody online" and "Flight Cmdr
                      PC heartbeat didn't land". Root-cause hint included:
                      usually the Flight Cmdr needs to sign in once with
                      the app open so the registry row publishes. */}
                  {user?.role === "ops"
                    && effectiveTargets.length === 0
                    && registry.data.filter(p => !p.isSelf).length > 0 && (
                    <div className="text-[10px] text-amber-300 space-y-0.5 mt-1 p-2 rounded-md bg-amber-500/10 border border-amber-500/30">
                      <div className="font-semibold">
                        No Flight Commander PC found in the registry.
                      </div>
                      <div>
                        {registry.data.filter(p => !p.isSelf).length} other PC(s) are online, but none is a Flight Cmdr:
                      </div>
                      <ul className="pl-3 list-disc">
                        {registry.data.filter(p => !p.isSelf).slice(0, 8).map(p => (
                          <li key={p.id}>
                            <code>{p.id}</code> — tier <code>{p.tier}</code>
                          </li>
                        ))}
                      </ul>
                      <div className="text-muted-foreground">
                        Ask the Flight Cmdr to sign in on the app with internet on. Their PC registers its row within 30s.
                      </div>
                    </div>
                  )}
                </>
              )}
            </label>
            <div className="flex items-end">
              <Button
                onClick={doSubmit}
                disabled={!selectedTarget || submit.isPending}
                className="w-full"
                data-testid="button-confirm-submit"
              >
                <Send className="h-3.5 w-3.5 me-1" /> Send
              </Button>
            </div>
          </div>
          <div className="text-[11px] text-muted-foreground">
            The recipient sees the same RJAF flight schedule paper in their Schedule Sharing inbox.
            They can approve, edit and resend, or print.
          </div>
        </div>
      )}

      {/* Defaults panel — A/C type included so it's editable per-squadron. */}
      {showDefaults && (
        <div className="no-print border border-border rounded-md p-3 bg-secondary/30 grid md:grid-cols-2 gap-3 text-sm" data-testid="defaults-panel">
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">Airbase (default)</span>
            <input value={defaults.airbase} onChange={(e) => setDefaults((d) => ({ ...d, airbase: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border" data-testid="input-default-airbase" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">Squadron (default)</span>
            <input value={defaults.squadron} onChange={(e) => setDefaults((d) => ({ ...d, squadron: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border" data-testid="input-default-squadron" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">A/C Type (default)</span>
            <input value={defaults.acType} onChange={(e) => setDefaults((d) => ({ ...d, acType: e.target.value }))}
              placeholder="e.g. UH-60M, CH-47D, AH-1F"
              className="px-2 py-1.5 rounded-md bg-input border border-border" data-testid="input-default-actype" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">FLT.CMDR (default)</span>
            <input value={defaults.fltCmdr} onChange={(e) => setDefaults((d) => ({ ...d, fltCmdr: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border" data-testid="input-default-fltcmdr" />
          </label>
          <label className="flex flex-col gap-1">
            <span className="font-semibold text-xs">SQDN.CMDR (default)</span>
            <input value={defaults.sqdnCmdr} onChange={(e) => setDefaults((d) => ({ ...d, sqdnCmdr: e.target.value }))}
              className="px-2 py-1.5 rounded-md bg-input border border-border" data-testid="input-default-sqdncmdr" />
          </label>
          <div className="md:col-span-2 flex gap-2 items-center">
            <Button
              size="sm"
              onClick={() => {
                saveDefaults(defaults);
                setProg((p) => ({
                  ...p,
                  airbase:  p.airbase  || defaults.airbase,
                  squadron: p.squadron || defaults.squadron,
                  fltCmdr:  p.fltCmdr  || defaults.fltCmdr,
                  sqdnCmdr: p.sqdnCmdr || defaults.sqdnCmdr,
                  // Backfill blank acType cells with the new default.
                  dayRows:   p.dayRows.map(r   => r.acType ? r : { ...r, acType: defaults.acType }),
                  nightRows: p.nightRows.map(r => r.acType ? r : { ...r, acType: defaults.acType }),
                }));
                setShowDefaults(false);
              }}
              data-testid="button-save-defaults"
            >
              Save defaults
            </Button>
            <span className="text-xs text-muted-foreground">
              Applied to new days automatically. Existing days keep their values unless blank.
            </span>
          </div>
        </div>
      )}

      {/* The printable RJAF flight schedule paper. Same component is
          rendered on the receiving PCs (Schedule Sharing) so the paper
          stays identical pixel-for-pixel. */}
      <FlightScheduleSheet
        prog={prog}
        onChange={update}
        pilotOptions={pilotOptions}
      />

      {/* Print styles — only the sheet is visible on paper. */}
      <style>{`
        @media print {
          @page { size: A4 landscape; margin: 8mm; }
          body * { visibility: hidden; }
          #flight-program-sheet, #flight-program-sheet * { visibility: visible; }
          #flight-program-sheet { position: absolute; inset: 0; width: 100%; border: none; }
          .no-print { display: none !important; }
          input, select { border: none !important; }
        }
      `}</style>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────
   v1.1.61 Flight Program — Incoming/Sent share panel
   ────────────────────────────────────────────────────────────────────
   The Flight Schedule (paper) page used to be a composer-only surface:
   you authored a sheet and pressed Submit. Acting on returned edits or
   cleaning up bad sheets meant switching to the Schedule Chain page.
   This compact panel surfaces every program-style share that touches
   this PC (incoming + sent) right at the top of the Flight Schedule
   page so Approve / Reject / Delete / Print can be done without
   leaving the page. It is a deliberate mirror of the action set on
   ScheduleChain.tsx — same mutations, same RLS authority. */
function FlightProgramShareInbox() {
  const { user } = useAuth();
  const { rankOf } = useI18n();
  // v1.1.70 — `makePcMatcher` returns a plain `(id) => boolean` predicate
  // (see lib/cross-pc.ts:1789). The previous call site invoked it with no
  // argument and then accessed `.matchesMe(...)` on the result, which is
  // undefined: the moment any program-style share appeared in the inbox
  // the filter callbacks crashed with "matcher.matchesMe is not a
  // function" and the inbox silently rendered nothing. Now mirrors
  // ScheduleChain.tsx exactly.
  const me = getLocalPcId();
  const matchesMe = useMemo(() => makePcMatcher(me), [me]);
  // v1.1.70 — `useScheduleShares` requires the PC id so the query key is
  // scoped per-PC and RLS-driven invalidation hits the right cache. The
  // older zero-arg call defaulted `forPcId` to `undefined`, which made
  // every PC share the same query slot and corrupted invalidation
  // boundaries between Squadron / Flight / Wing PCs.
  const { data: shares = [] } = useScheduleShares(me);
  const decide = useDecideSchedule();
  const deleteShare = useDeleteScheduleShare();
  const { toast } = useToast();
  // v1.1.68 — let Ops Pilot (and any viewer of this inbox) actually
  // OPEN an incoming or sent flight schedule paper inline, instead of
  // only being offered Approve / Reject / Delete buttons. Without this
  // the inbox is a blind decision: you have no way to read the
  // schedule before stamping it.
  const { data: PILOTS = [] } = usePilots();
  const pilotOptions = useMemo(
    () => PILOTS.map(p => ({ value: p.name, label: `${rankOf(p)} ${p.name}` })),
    [PILOTS],
  );
  const [viewingId, setViewingId] = useState<string | null>(null);
  // Only program-style (paper sheet) shares belong on this page; the
  // compact-rows shares stay on Schedule Chain so we don't double up.
  const programShares = useMemo(
    () => shares.filter(s => !!s.program),
    [shares],
  );
  // v1.1.101 — the previous incoming filter excluded every share where
  // originSquadronId matched me, which meant a Flight Cmdr (or any tier)
  // who ORIGINATED a schedule and then got it returned by Ops/downstream
  // via Edit or Reject never saw it in Incoming — it fell into the Sent
  // card which has no Approve / Reject / Edit controls, so the returned
  // sheet sat there with "no options, nothing" (operator's exact words).
  // Schedule Chain (ScheduleChain.tsx:358-359) already had the correct
  // partition — incoming = current-holder, sent = origin-but-NOT-current.
  // Mirror that here so the bug cannot recur on any tier (Flight, Sqn,
  // Wing, Base, HQ) once we scale to 15-20 squadrons.
  const incoming = useMemo(
    () => programShares.filter(s => matchesMe(s.currentPcId)),
    [programShares, matchesMe],
  );
  const sent = useMemo(
    () => programShares.filter(s =>
      matchesMe(s.originSquadronId)
      && !matchesMe(s.currentPcId)
      && !s.originatorDismissedAt,
    ),
    [programShares, matchesMe],
  );
  const wireTier: "flight" | "squadron" | "wing" | "base" =
    user?.scope === "wing" ? "wing"
    : user?.scope === "base" ? "base"
    : user?.scope === "flight" ? "flight"
    : "squadron";

  if (incoming.length === 0 && sent.length === 0) return null;

  return (
    <div className="no-print space-y-2">
      {incoming.length > 0 && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/5 p-3 space-y-2">
          <div className="text-xs font-semibold text-amber-200">
            Incoming flight programs awaiting your action ({incoming.length})
          </div>
          {incoming.map(share => {
            const isOpen = viewingId === share.id;
            return (
              <div key={share.id} className="border border-border bg-background/50 rounded">
                <div className="flex items-center justify-between gap-2 p-2">
                  <div className="text-xs">
                    <div className="font-semibold">{share.date}</div>
                    <div className="text-[11px] text-muted-foreground">
                      From {share.originSquadronName} · {share.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {/* v1.1.68 — View toggles the read-only flight schedule
                        paper open inline so the operator can actually read
                        what they're about to approve / reject. */}
                    <button
                      onClick={() => setViewingId(isOpen ? null : share.id)}
                      className="px-2 py-1 rounded bg-sky-500/20 border border-sky-400/40 text-sky-100 text-[11px] font-semibold inline-flex items-center gap-1"
                      data-testid={`fp-view-${share.id}`}
                    >
                      {isOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {isOpen ? "Hide" : "View"}
                    </button>
                    <button
                      onClick={async () => {
                        await decide.mutateAsync({ id: share.id, action: "approve", by: user?.username ?? "ops", tier: wireTier });
                        toast({ title: "Approved" });
                      }}
                      className="px-2 py-1 rounded bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 text-[11px] font-semibold inline-flex items-center gap-1"
                      data-testid={`fp-approve-${share.id}`}
                    >
                      <Check className="h-3 w-3" /> Approve
                    </button>
                    <button
                      onClick={async () => {
                        await decide.mutateAsync({ id: share.id, action: "reject", by: user?.username ?? "ops", tier: wireTier });
                        toast({ title: "Rejected" });
                      }}
                      className="px-2 py-1 rounded bg-rose-500/20 border border-rose-400/40 text-rose-100 text-[11px] font-semibold inline-flex items-center gap-1"
                      data-testid={`fp-reject-${share.id}`}
                    >
                      <X className="h-3 w-3" /> Reject
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("Delete this flight schedule from EVERY PC?\n\nThis is permanent. Originator, reviewers, approvers — everyone loses their copy. Cannot be undone.")) return;
                        await deleteShare.mutateAsync({ id: share.id });
                        toast({ title: "Schedule deleted from every PC" });
                      }}
                      className="px-2 py-1 rounded bg-rose-700/30 border border-rose-500/60 text-rose-50 text-[11px] font-semibold inline-flex items-center gap-1"
                      data-testid={`fp-delete-${share.id}`}
                      title="Permanent delete — removes this schedule from every PC in the chain"
                    >
                      <Trash2 className="h-3 w-3" /> Delete
                    </button>
                  </div>
                </div>
                {isOpen && share.program && (
                  <div className="border-t border-border p-2 bg-background/40">
                    <FlightScheduleSheet
                      prog={share.editedProgram ?? share.program}
                      pilotOptions={pilotOptions}
                      approvedAt={share.approvedAt}
                      approvedBy={share.approvedBy}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      {sent.length > 0 && (
        <div className="rounded-md border border-border bg-secondary/20 p-3 space-y-2">
          <div className="text-xs font-semibold text-muted-foreground">
            Flight programs you sent ({sent.length})
          </div>
          {sent.map(share => {
            const isOpen = viewingId === share.id;
            return (
              <div key={share.id} className="border border-border bg-background/50 rounded">
                <div className="flex items-center justify-between gap-2 p-2">
                  <div className="text-xs">
                    <div className="font-semibold">{share.date}</div>
                    <div className="text-[11px] text-muted-foreground">
                      Now at {share.currentPcName ?? "—"} · {share.status}
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <button
                      onClick={() => setViewingId(isOpen ? null : share.id)}
                      className="px-2 py-1 rounded bg-sky-500/20 border border-sky-400/40 text-sky-100 text-[11px] font-semibold inline-flex items-center gap-1"
                      data-testid={`fp-sent-view-${share.id}`}
                    >
                      {isOpen ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
                      {isOpen ? "Hide" : "View"}
                    </button>
                    <button
                      onClick={async () => {
                        if (!window.confirm("Delete this flight schedule from EVERY PC?\n\nThis is permanent. Originator, reviewers, approvers — everyone loses their copy. Cannot be undone.")) return;
                        await deleteShare.mutateAsync({ id: share.id });
                        toast({ title: "Schedule deleted from every PC" });
                      }}
                      className="px-2 py-1 rounded bg-rose-700/30 border border-rose-500/60 text-rose-50 text-[11px] font-semibold inline-flex items-center gap-1"
                      data-testid={`fp-sent-delete-${share.id}`}
                      title="Permanent delete — removes this schedule from every PC in the chain"
                    >
                      <Trash2 className="h-3 w-3" /> Delete everywhere
                    </button>
                  </div>
                </div>
                {isOpen && share.program && (
                  <div className="border-t border-border p-2 bg-background/40">
                    <FlightScheduleSheet
                      prog={share.editedProgram ?? share.program}
                      pilotOptions={pilotOptions}
                      approvedAt={share.approvedAt}
                      approvedBy={share.approvedBy}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
