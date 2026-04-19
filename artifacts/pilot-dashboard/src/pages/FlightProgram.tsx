import { useEffect, useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Printer, Save, Settings, Send, X as CloseIcon } from "lucide-react";
import FlightScheduleSheet, { emptyProgramRow } from "@/components/FlightScheduleSheet";
import {
  type ScheduleProgram,
  type ScheduleProgramRow,
  useRegisteredPCs,
  useSubmitSchedule,
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
const FACTORY_DEFAULTS: Defaults = {
  airbase:  "KING ABDULLAH II AIRBASE",
  squadron: "NO.8 SQDN",
  fltCmdr:  "",
  sqdnCmdr: "",
  acType:   "UH-60M",
};

const loadDefaults = (): Defaults => {
  try {
    const raw = localStorage.getItem(DEFAULTS_KEY);
    if (!raw) return { ...FACTORY_DEFAULTS };
    return { ...FACTORY_DEFAULTS, ...(JSON.parse(raw) as Partial<Defaults>) };
  } catch {
    return { ...FACTORY_DEFAULTS };
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
      crew:     [r.pilot, r.coPilot].filter(Boolean),
      mission:  r.msnDuty,
      takeoff:  r.toTime || r.atcTakeoff,
      land:     r.atcLanding,
      fuel:     r.fuel,
    }));
}

export default function FlightProgram() {
  const { t, lang, dir } = useI18n();
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
  const canAccess =
    user?.role === "commander" &&
    (user?.scope === "flight" || user?.scope === "squadron");
  const canPrint = canAccess;
  const isFlightCmdr = user?.role === "commander" && user?.scope === "flight";

  const todayIso = new Date().toISOString().slice(0, 10);
  const [defaults, setDefaults]       = useState<Defaults>(() => loadDefaults());
  const [date, setDate]               = useState<string>(todayIso);
  const [prog, setProg]               = useState<ScheduleProgram>(() => loadProgram(todayIso, loadDefaults()));
  const [savedFlash, setSavedFlash]   = useState(false);
  const [showDefaults, setShowDefaults] = useState(false);
  const [showSubmit, setShowSubmit]   = useState(false);
  const [submitTo, setSubmitTo]       = useState("");

  // When the date changes, swap to that day's program (or a fresh one).
  useEffect(() => { setProg(loadProgram(date, defaults)); }, [date, defaults]);

  const pilotOptions = useMemo(
    () => PILOTS.map(p => ({ value: p.name, label: `${p.rank} ${p.name}` })),
    [PILOTS],
  );

  // PCs that can receive a flight schedule. The squadron sends to its
  // monitoring Wing PC, but ops officers also share peer-to-peer for
  // visibility — so we list every registered PC that is not us. The
  // Flight Commander PC is locked to its bound Squadron Commander only:
  // the picker shrinks to that single PC and is auto-selected.
  const flightBinding = isFlightCmdr ? getFlightBinding() : null;
  const isSquadronCmdr = user?.role === "commander" && user?.scope === "squadron";
  const targets = useMemo(
    () => {
      const all = registry.data.filter(p => !p.isSelf);
      // Flight Commander → locked to their bound Squadron Commander.
      if (isFlightCmdr && flightBinding) {
        return all.filter(p => p.id === flightBinding.pcId);
      }
      // Squadron Commander → only Wing Commander PCs are valid Submit
      // targets (squadron passes the program up the chain to wing, which
      // then auto-forwards to base on approval). Flight Commanders reach
      // the squadron via their own Submit, so they don't appear here.
      if (isSquadronCmdr) {
        return all.filter(p => p.tier === "wing");
      }
      return all;
    },
    [registry.data, isFlightCmdr, isSquadronCmdr, flightBinding?.pcId],
  );
  const selectedTarget = targets.find(p => p.id === submitTo);

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
      targetTier:   selectedTarget.tier as "squadron" | "wing" | "base",
      submittedBy:  user?.username ?? "ops",
      program:      prog,
    });
    toast({ title: `Schedule shared with ${selectedTarget.squadronName}` });
    setShowSubmit(false);
    setSubmitTo("");
  };

  if (!canAccess) {
    return (
      <div className="p-6" dir={dir}>
        <div className="rounded-md border border-border bg-card p-6 max-w-xl">
          <div className="text-sm font-semibold mb-1">{t("nav_flight_program")}</div>
          <div className="text-xs text-muted-foreground leading-relaxed">
            {lang === "ar"
              ? "هذه الصفحة متاحة فقط لضابط عمليات السرب وقائد السرب."
              : "This page is available only to the squadron ops officer and the squadron commander."}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3" dir={dir}>
      {/* Toolbar — hidden on print. Date + mode + Save + Print + Submit + Defaults. */}
      <div className="no-print flex items-center gap-2 flex-wrap">
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value || todayIso)}
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
                {isFlightCmdr && flightBinding ? "Recipient (bound Squadron Commander)" : "Recipient PC"}
              </span>
              {isFlightCmdr && flightBinding ? (
                <div
                  className="px-2 py-1.5 rounded-md bg-secondary/40 border border-border text-sm font-medium flex items-center justify-between"
                  data-testid="bound-recipient"
                >
                  <span>{flightBinding.pcName}</span>
                  <span className="text-[11px] text-muted-foreground">locked</span>
                </div>
              ) : (
                <select
                  value={submitTo}
                  onChange={(e) => setSubmitTo(e.target.value)}
                  className="px-2 py-1.5 rounded-md bg-input border border-border text-sm"
                  data-testid="select-submit-target"
                >
                  <option value="">— pick a registered PC —</option>
                  {targets.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.squadronName} · {p.tier}{p.online ? " · online" : " · offline"}
                    </option>
                  ))}
                </select>
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
