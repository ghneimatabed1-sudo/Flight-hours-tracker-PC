import { useEffect, useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import {
  usePilots,
  useSorties,
  useCreateSortie,
  useUpdateSortie,
  useDeleteSortie,
  deriveSortieBuckets,
} from "@/lib/squadron-data";
import { useToast } from "@/hooks/use-toast";
import type { Sortie } from "@/lib/mock";
import { Plane, Pencil, Trash2, X } from "lucide-react";

// Simple Add Sortie form — mirrors the legacy mobile app's logic:
//   • One Position toggle: which seat is in 1st PLT (the other = 2nd PLT)
//   • One "Count as Captain" checkbox (only credited when 1st PLT)
//   • Day / Night condition + NVG checkbox (NVG disabled when Day)
//   • Single Time field + independent Dual hours
//   • Optional Instrument Flight section: SIM / Actual / ILS / VOR
//
// Hours always flow to the right pilot via per-seat pilotIsCaptain /
// coPilotIsCaptain flags consumed by lib/calculations.ts.

const SORTIE_TYPES = [
  "MSN DAY", "MSN NIGHT", "MSN NVG",
  "TRG DAY", "TRG NIGHT", "TRG NVG",
  "NAV", "NAV DAY", "NAV NIGHT",
  "FCF", "ACADEMIC", "EMER", "INSTR",
  "CHECK RIDE", "TRANSPORT", "SAR", "MEDEVAC",
  "Other…",
];

type Condition = "Day" | "Night";
// Each seat carries its own status — Pilot can be 1st PLT while Co-Pilot is
// in Dual instruction, etc. Captain flag is also per-seat: a Pilot logged as
// 2nd PLT can still claim CAP hours if he holds the captain qualification on
// the airframe. This matches the April 2026 ops rebuild where the old
// "single firstSeat toggle + single captain checkbox" was found to mis-credit
// hours whenever the two seats had different statuses (e.g. dual eval).
type SeatStatus = "1st" | "2nd" | "Dual";

interface SeatState {
  id: string;
  status: SeatStatus;
  captain: boolean;
}

interface FormState {
  id: string | null;
  date: string;
  acType: string;
  acNumber: string;
  pilot: SeatState;
  coPilot: SeatState;
  sortieType: string;
  sortieTypeOther: string;
  msnDuty: string;
  condition: Condition;
  nvg: boolean;                // valid only when Night — fully separate from Night currency
  time: string;
  dualHours: string;
  // Instrument Flight section
  instrumentFlight: boolean;
  ifSim: string;
  ifAct: string;
  ils: string;
  vor: string;
  remarks: string;
}

const blankSeat = (): SeatState => ({ id: "", status: "1st", captain: false });

const blankForm = (): FormState => ({
  id: null,
  date: new Date().toISOString().slice(0, 10),
  acType: "UH-60M",
  acNumber: "",
  pilot: { ...blankSeat(), status: "1st" },
  coPilot: { ...blankSeat(), status: "2nd" },
  sortieType: "TRG DAY",
  sortieTypeOther: "",
  msnDuty: "",
  condition: "Day",
  nvg: false,
  time: "",
  dualHours: "",
  instrumentFlight: false,
  ifSim: "",
  ifAct: "",
  ils: "",
  vor: "",
  remarks: "",
});

export default function AddSortie() {
  const { t } = useI18n();
  const { toast } = useToast();
  const { data: PILOTS } = usePilots();
  const { data: SORTIES } = useSorties();
  const create = useCreateSortie();
  const update = useUpdateSortie();
  const del = useDeleteSortie();

  const [form, setForm] = useState<FormState>(blankForm);
  const [confirmDel, setConfirmDel] = useState<Sortie | null>(null);

  // Seed pilot/co-pilot defaults once roster loads.
  useEffect(() => {
    if (!form.pilot.id && PILOTS[0]) {
      setForm(f => ({
        ...f,
        pilot: { ...f.pilot, id: PILOTS[0].id },
        coPilot: { ...f.coPilot, id: PILOTS[1]?.id ?? PILOTS[0].id },
      }));
    }
  }, [PILOTS, form.pilot.id]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));
  const setSeat = (which: "pilot" | "coPilot", patch: Partial<SeatState>) =>
    setForm(f => ({ ...f, [which]: { ...f[which], ...patch } }));

  const pilotOpts = useMemo(
    () => PILOTS.map(p => ({ value: p.id, label: `${p.rank} ${p.name}` })),
    [PILOTS],
  );
  const pilotById = (id: string) => PILOTS.find(p => p.id === id);

  const todaySorties = useMemo(() => {
    const list = SORTIES.filter(s => s.date === form.date);
    return [...list].sort((a, b) => (a.id < b.id ? 1 : -1));
  }, [SORTIES, form.date]);

  const totals = useMemo(() => {
    let s = 0, h = 0;
    for (const r of todaySorties) {
      s += 1;
      const t = Number(r.time) || Number(r.actual) ||
        Number(r.day1 || 0) + Number(r.day2 || 0) + Number(r.dayDual || 0) +
        Number(r.night1 || 0) + Number(r.night2 || 0) + Number(r.nightDual || 0) +
        Number(r.nvg || 0);
      h += Number.isFinite(t) ? t : 0;
    }
    return { s, h: +h.toFixed(1) };
  }, [todaySorties]);

  const resetForm = () =>
    setForm(f => ({
      ...blankForm(),
      date: f.date, acType: f.acType, acNumber: f.acNumber,
      pilot: f.pilot, coPilot: f.coPilot,
    }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const time = parseFloat(form.time || "0");
    const dual = parseFloat(form.dualHours || "0");
    if (!(time > 0) && !(dual > 0)) {
      toast({ title: "Hours required", description: "Enter Time and/or Dual hours.", variant: "destructive" });
      return;
    }
    if (form.pilot.id === form.coPilot.id && form.pilot.id) {
      toast({ title: "Pilot and Co-Pilot are the same", variant: "destructive" });
      return;
    }

    // The condition that drives bucketing: NVG overrides Night when checked.
    // Day/Night/NVG are independent currencies — the auto-bump in
    // squadron-data.ts only refreshes the matching expiry, never both.
    const cond: "Day" | "Night" | "NVG" =
      form.condition === "Day" ? "Day" : form.nvg ? "NVG" : "Night";

    // Per-seat status: each pilot independently flagged as 1st PLT, 2nd PLT,
    // or Dual. The sortie-level pilotPosition/coPilotPosition fields keep the
    // raw selection so reports can break down credit by seat. The legacy
    // "1st"/"2nd" enum is preserved by mapping Dual → "1st" on the canonical
    // pilotPosition (the seat that owns the captain flag), while the actual
    // dual flag controls bucket routing below.
    const pilotPosition: "1st" | "2nd" = form.pilot.status === "2nd" ? "2nd" : "1st";
    const coPilotPosition: "1st" | "2nd" = form.coPilot.status === "1st" ? "1st" : "2nd";

    // Captain credit is per-seat — a 2nd PLT can still hold CAP if qualified.
    const pilotIsCaptain = !!form.pilot.captain;
    const coPilotIsCaptain = !!form.coPilot.captain;

    // Bucket routing: the sortie-level Dual marker fires whenever EITHER seat
    // is in Dual status. Hours are split into a non-dual portion (`time`)
    // attributed to whichever seat is "1st" and a dual portion attributed to
    // the dual buckets — so a (Pilot=1st PLT, Co-Pilot=Dual) sortie correctly
    // accumulates flight + dual instruction hours on the same record.
    const eitherDual = form.pilot.status === "Dual" || form.coPilot.status === "Dual";
    // Single seat-aware routing pass — both seats' statuses route the same
    // flight time into their respective bucket. The legacy "extra dual hours"
    // input is folded into the dual bucket via a second pass with both seats
    // forced to Dual (covers the case where a sortie logged additional dual
    // instruction time beyond the primary block).
    const totalTime = time + dual;
    const merged = deriveSortieBuckets({
      time: totalTime,
      condition: cond,
      pilotStatus: form.pilot.status,
      coPilotStatus: form.coPilot.status,
    });

    const sortieType = form.sortieType === "Other…"
      ? form.sortieTypeOther.trim() || "OTHER"
      : form.sortieType;

    const ifSim = parseFloat(form.ifSim || "0") || 0;
    const ifAct = parseFloat(form.ifAct || "0") || 0;
    const payload: Omit<Sortie, "id"> = {
      date: form.date,
      acType: form.acType,
      acNumber: form.acNumber.trim(),
      pilotId: form.pilot.id,
      coPilotId: form.coPilot.id,
      sortieType,
      name: form.msnDuty.trim() || sortieType,
      condition: cond,
      remarks: form.remarks.trim() || undefined,
      day1: merged.day1, day2: merged.day2, dayDual: merged.dayDual,
      night1: merged.night1, night2: merged.night2, nightDual: merged.nightDual,
      nvg: merged.nvg,
      nvg1: merged.nvg1 || undefined,
      nvg2: merged.nvg2 || undefined,
      nvgDual: merged.nvgDual || undefined,
      sim: ifSim, // legacy `sim` = IF SIM hours
      actual: time + dual,
      time: time + dual,
      dual: dual > 0 || eitherDual,
      pilotPosition,
      coPilotPosition,
      pilotSeatStatus: form.pilot.status,
      coPilotSeatStatus: form.coPilot.status,
      pilotIsCaptain,
      coPilotIsCaptain,
      msnDuty: form.msnDuty.trim() || undefined,
      instrumentFlight: form.instrumentFlight,
      ifSim: form.instrumentFlight ? ifSim : undefined,
      ifAct: form.instrumentFlight ? ifAct : undefined,
      ils: form.instrumentFlight ? (parseInt(form.ils || "0") || 0) : undefined,
      vor: form.instrumentFlight ? (parseInt(form.vor || "0") || 0) : undefined,
    };
    try {
      if (form.id) {
        await update.mutateAsync({ sortie: { ...payload, id: form.id } as Sortie });
        toast({ title: "Sortie updated" });
      } else {
        await create.mutateAsync(payload);
        toast({ title: "Sortie added" });
      }
      resetForm();
    } catch {
      /* surfaced by global error toast */
    }
  };

  const loadForEdit = (s: Sortie) => {
    const cond: Condition = s.condition === "Day" ? "Day" : "Night";
    const nvg = s.condition === "NVG";
    // Prefer the authoritative seat-status fields written by the rebuilt
    // Add Sortie page. Only fall back to legacy reconstruction (pilotPosition
    // / coPilotPosition + dual flag) for historical records that pre-date
    // the per-seat schema. The legacy fallback can't tell which seat was the
    // instructor, so it marks the 2nd PLT seat as Dual by default — the ops
    // officer can flip it before re-saving.
    const pilotStatus: SeatStatus = s.pilotSeatStatus
      ?? (s.dual
        ? (s.pilotPosition === "2nd" ? "Dual" : "1st")
        : (s.pilotPosition === "2nd" ? "2nd" : "1st"));
    const coPilotStatus: SeatStatus = s.coPilotSeatStatus
      ?? (s.dual
        ? (s.coPilotPosition === "1st" ? "1st" : "Dual")
        : (s.coPilotPosition === "1st" ? "1st" : "2nd"));
    // For seat-aware records the single `time` field is the authoritative
    // flight duration; treat it as non-dual unless the legacy schema split
    // it across `time` + dual hours.
    const seatAware = !!(s.pilotSeatStatus || s.coPilotSeatStatus);
    const dualHours = seatAware ? 0 : (s.dual ? (s.dayDual + s.nightDual + (s.nvgDual ?? 0)) : 0);
    const nonDualHours = seatAware
      ? ((s.time ?? s.actual) || 0)
      : (((s.time ?? s.actual) || 0) - dualHours);
    setForm({
      id: s.id,
      date: s.date,
      acType: s.acType || "UH-60M",
      acNumber: s.acNumber || "",
      pilot: { id: s.pilotId, status: pilotStatus, captain: !!s.pilotIsCaptain },
      coPilot: { id: s.coPilotId, status: coPilotStatus, captain: !!s.coPilotIsCaptain },
      sortieType: SORTIE_TYPES.includes(s.sortieType) ? s.sortieType : "Other…",
      sortieTypeOther: SORTIE_TYPES.includes(s.sortieType) ? "" : s.sortieType,
      msnDuty: s.msnDuty ?? s.name ?? "",
      condition: cond,
      nvg,
      time: nonDualHours > 0 ? String(nonDualHours) : "",
      dualHours: dualHours > 0 ? String(dualHours) : "",
      instrumentFlight: !!s.instrumentFlight,
      ifSim: s.ifSim != null ? String(s.ifSim) : "",
      ifAct: s.ifAct != null ? String(s.ifAct) : "",
      ils: s.ils != null ? String(s.ils) : "",
      vor: s.vor != null ? String(s.vor) : "",
      remarks: s.remarks || "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const doDelete = async () => {
    if (!confirmDel) return;
    try {
      await del.mutateAsync({ id: confirmDel.id });
      toast({ title: "Sortie deleted" });
    } finally {
      setConfirmDel(null);
    }
  };

  const seatLabel = (id: string, ext?: { name: string }) => {
    if (ext?.name) return ext.name;
    const p = pilotById(id);
    return p ? `${p.rank} ${p.name}` : id || "—";
  };

  return (
    <div>
      <PageHead title={t("nav_addsortie")} subtitle="New flight entry · auto-syncs to Supabase" />

      <Card className="mb-4">
        <form onSubmit={submit} className="space-y-3" data-testid="form-add-sortie">
          {/* Row 1: flight info */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Mini label="Date" type="date" value={form.date} onChange={v => set("date", v)} />
            <MiniSelect label="A/C Type" value={form.acType} onChange={v => set("acType", v)} opts={["UH-60M", "UH-60L", "UH-60AIL", "AS332"]} />
            <Mini label="A/C No" value={form.acNumber} onChange={v => set("acNumber", v)} placeholder="e.g. 832" />
            <MiniSelect label="Sortie Type" value={form.sortieType} onChange={v => set("sortieType", v)} opts={SORTIE_TYPES} />
            <Mini label="Time (hrs)" type="number" step="0.1" value={form.time} onChange={v => set("time", v)} placeholder="0.0" />
            <Mini label="Dual (hrs)" type="number" step="0.1" value={form.dualHours} onChange={v => set("dualHours", v)} placeholder="0.0" />
          </div>

          {form.sortieType === "Other…" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Mini label="Custom sortie type" value={form.sortieTypeOther} onChange={v => set("sortieTypeOther", v)} placeholder="Type your own…" />
              <Mini label="MSN / Duty" value={form.msnDuty} onChange={v => set("msnDuty", v)} placeholder="Mission name / duty" />
            </div>
          )}
          {form.sortieType !== "Other…" && (
            <Mini label="MSN / Duty (optional)" value={form.msnDuty} onChange={v => set("msnDuty", v)} placeholder="Mission name / duty" />
          )}

          {/* Crew row — each seat carries its own pilot, status (1st/2nd/Dual)
              and captain flag. The two seats are fully independent. */}
          <div className="grid lg:grid-cols-2 gap-3">
            <SeatPanel
              label="Pilot"
              testIdPrefix="pilot"
              seat={form.pilot}
              opts={pilotOpts}
              onChange={patch => setSeat("pilot", patch)}
            />
            <SeatPanel
              label="Co-Pilot"
              testIdPrefix="copilot"
              seat={form.coPilot}
              opts={pilotOpts}
              onChange={patch => setSeat("coPilot", patch)}
            />
          </div>

          {/* Condition row */}
          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground font-semibold">Condition</div>
            <div className="flex gap-2" data-testid="condition-selector">
              <button
                type="button"
                onClick={() => { set("condition", "Day"); set("nvg", false); }}
                data-testid="button-condition-day"
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                  form.condition === "Day"
                    ? "bg-amber-400/20 border-amber-400 text-amber-200"
                    : "bg-secondary border-border text-muted-foreground"
                }`}
              >DAY</button>
              <button
                type="button"
                onClick={() => set("condition", "Night")}
                data-testid="button-condition-night"
                className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                  form.condition === "Night"
                    ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                    : "bg-secondary border-border text-muted-foreground"
                }`}
              >NIGHT</button>
            </div>
            <label
              className={`inline-flex items-center gap-1.5 text-xs cursor-pointer select-none px-3 py-1.5 rounded-md border ${
                form.condition === "Day"
                  ? "opacity-40 cursor-not-allowed border-border bg-secondary"
                  : form.nvg
                  ? "bg-rose-500/20 border-rose-400 text-rose-200"
                  : "bg-secondary border-border"
              }`}
              data-testid="toggle-nvg"
            >
              <input
                type="checkbox"
                checked={form.nvg}
                disabled={form.condition === "Day"}
                onChange={e => set("nvg", e.target.checked)}
                className="h-3.5 w-3.5 accent-rose-400"
              />
              <span className="font-semibold">NVG</span>
            </label>
            <div className="flex-1" />
            <div className="flex items-center gap-2">
              {form.id && (
                <button
                  type="button"
                  onClick={() => setForm(blankForm())}
                  className="px-3 py-2 rounded-md bg-secondary border border-border text-xs font-medium inline-flex items-center gap-1"
                  data-testid="button-cancel-edit"
                >
                  <X className="h-3.5 w-3.5" /> Cancel
                </button>
              )}
              <button
                disabled={create.isPending || update.isPending}
                className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-semibold inline-flex items-center gap-2 disabled:opacity-50"
                data-testid="button-submit-sortie"
              >
                <Plane className="h-4 w-4" />
                {form.id ? "Save changes" : "ADD"}
              </button>
            </div>
          </div>

          {/* Instrument Flight section */}
          <div className="border border-border rounded-md p-3 bg-sky-500/5">
            <label className="inline-flex items-center gap-2 cursor-pointer select-none mb-2" data-testid="toggle-instrument">
              <input
                type="checkbox"
                checked={form.instrumentFlight}
                onChange={e => set("instrumentFlight", e.target.checked)}
                className="h-4 w-4 accent-sky-400"
              />
              <span className="text-xs font-semibold uppercase tracking-wider">Instrument Flight</span>
            </label>
            {form.instrumentFlight && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <Mini label="SIM (hrs)"   type="number" step="0.1" value={form.ifSim} onChange={v => set("ifSim", v)} placeholder="0.0" />
                <Mini label="Actual (hrs)" type="number" step="0.1" value={form.ifAct} onChange={v => set("ifAct", v)} placeholder="0.0" />
                <Mini label="ILS approaches" type="number" step="1" value={form.ils} onChange={v => set("ils", v)} placeholder="0" />
                <Mini label="VOR approaches" type="number" step="1" value={form.vor} onChange={v => set("vor", v)} placeholder="0" />
              </div>
            )}
          </div>

          {/* Remarks */}
          <div>
            <label className="block">
              <span className="text-[11px] text-muted-foreground">Remarks</span>
              <textarea
                value={form.remarks}
                onChange={e => set("remarks", e.target.value)}
                placeholder="Notes (weather, aborts, maintenance, etc.)"
                rows={2}
                data-testid="input-remarks"
                className="w-full mt-1 px-3 py-1.5 rounded-md bg-input border border-border text-xs resize-none"
              />
            </label>
          </div>
        </form>
      </Card>

      {/* Sortie list */}
      <Card>
        <div className="flex items-center justify-between mb-2">
          <div className="text-sm font-semibold">QREG · {form.date} · {form.acType}</div>
          <div className="text-[11px] text-muted-foreground">All sorties for this date — click <span className="text-primary">edit</span> to load back into the form.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px] font-mono">
            <thead>
              <tr className="text-left text-muted-foreground border-b border-border">
                <th className="py-1.5 pr-2">DATE</th>
                <th className="pr-2">A/C</th>
                <th className="pr-2">PILOT</th>
                <th className="pr-2">CO-PILOT</th>
                <th className="pr-2">TYPE</th>
                <th className="pr-2">D/N</th>
                <th className="pr-2">DUAL</th>
                <th className="pr-2">IF</th>
                <th className="pr-2 text-right">TIME</th>
                <th className="pr-2 text-right">…</th>
              </tr>
            </thead>
            <tbody>
              {todaySorties.length === 0 && (
                <tr><td colSpan={10} className="py-3 text-center text-muted-foreground italic">No sorties logged on this date yet.</td></tr>
              )}
              {todaySorties.map(s => {
                const time = s.time ?? s.actual ?? (s.day1 + s.day2 + s.dayDual + s.night1 + s.night2 + s.nightDual + (s.nvg || 0));
                const dn = s.condition === "NVG" ? "NVG" : s.condition === "Night" ? "N" : "D";
                return (
                  <tr key={s.id} className={`border-b border-border/50 hover:bg-secondary/30 ${form.id === s.id ? "bg-primary/10" : ""}`} data-testid={`sortie-row-${s.id}`}>
                    <td className="py-1.5 pr-2">{s.date}</td>
                    <td className="pr-2">{s.acType} {s.acNumber}</td>
                    <td className="pr-2">{seatLabel(s.pilotId, s.pilotExternal)}{s.pilotIsCaptain ? <span className="ml-1 text-[9px] text-amber-300">CAPT</span> : null}</td>
                    <td className="pr-2">{seatLabel(s.coPilotId, s.coPilotExternal)}{s.coPilotIsCaptain ? <span className="ml-1 text-[9px] text-amber-300">CAPT</span> : null}</td>
                    <td className="pr-2">{s.sortieType}</td>
                    <td className="pr-2">{dn}</td>
                    <td className="pr-2">{s.dual ? "✓" : ""}</td>
                    <td className="pr-2">{s.instrumentFlight ? "✓" : ""}</td>
                    <td className="pr-2 text-right">{Number(time || 0).toFixed(1)}</td>
                    <td className="pr-2 text-right whitespace-nowrap">
                      <button onClick={() => loadForEdit(s)} className="px-1.5 py-0.5 rounded border border-border bg-secondary text-[10px] inline-flex items-center gap-0.5 mr-1" data-testid={`button-edit-${s.id}`}>
                        <Pencil className="h-3 w-3" /> Edit
                      </button>
                      <button onClick={() => setConfirmDel(s)} className="px-1.5 py-0.5 rounded border border-rose-400/40 bg-rose-500/10 text-rose-200 text-[10px] inline-flex items-center gap-0.5" data-testid={`button-delete-${s.id}`}>
                        <Trash2 className="h-3 w-3" /> Del
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            {todaySorties.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border font-semibold">
                  <td colSpan={8} className="py-2 text-right">ALL TOTALS</td>
                  <td className="pr-2 text-right">{totals.h.toFixed(1)} hrs · {totals.s} sorties</td>
                  <td />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {confirmDel && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={() => setConfirmDel(null)}>
          <div className="bg-card border border-border rounded-lg p-4 max-w-md w-full" onClick={e => e.stopPropagation()} data-testid="dialog-confirm-delete">
            <div className="font-semibold mb-1">Delete this sortie?</div>
            <div className="text-xs text-muted-foreground mb-3">
              {confirmDel.date} · {confirmDel.acType} {confirmDel.acNumber} · {confirmDel.sortieType}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setConfirmDel(null)} className="px-3 py-1.5 rounded-md bg-secondary border border-border text-xs">Cancel</button>
              <button onClick={doDelete} className="px-3 py-1.5 rounded-md bg-rose-600 text-white text-xs font-semibold" data-testid="button-confirm-delete">Delete</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────

type MiniProps = {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  placeholder?: string;
  step?: string;
};
function Mini({ label, value, onChange, type = "text", placeholder, step }: MiniProps) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <input
        type={type}
        step={step}
        value={value}
        placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full mt-0.5 px-2 py-1.5 rounded-md bg-input border border-border text-xs font-mono"
      />
    </label>
  );
}

interface SeatPanelProps {
  label: string;
  testIdPrefix: string;
  seat: SeatState;
  opts: { value: string; label: string }[];
  onChange: (patch: Partial<SeatState>) => void;
}

// Independent per-seat panel: pilot picker + status (1st PLT / 2nd PLT /
// Dual) + Captain checkbox. Each seat is fully independent — both seats can
// be 1st PLT (rare but legal on multi-instructor evals), both can be Dual
// during conversion training, etc. Captain credit is per-seat too.
function SeatPanel({ label, testIdPrefix, seat, opts, onChange }: SeatPanelProps) {
  const statuses: { v: SeatStatus; label: string; cls: string }[] = [
    { v: "1st", label: "1st PLT", cls: "bg-primary text-primary-foreground border-primary" },
    { v: "2nd", label: "2nd PLT", cls: "bg-sky-500/20 border-sky-400 text-sky-200" },
    { v: "Dual", label: "Dual", cls: "bg-violet-500/20 border-violet-400 text-violet-200" },
  ];
  return (
    <div className="border border-border rounded-md p-2.5 bg-secondary/20 space-y-2" data-testid={`seat-${testIdPrefix}`}>
      <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
      <select
        className="w-full px-2 py-1.5 rounded-md bg-input border border-border text-xs"
        value={seat.id}
        onChange={e => onChange({ id: e.target.value })}
        data-testid={`select-${testIdPrefix}`}
      >
        {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
      <div className="flex flex-wrap gap-1.5" data-testid={`status-${testIdPrefix}`}>
        {statuses.map(s => (
          <button
            key={s.v}
            type="button"
            onClick={() => onChange({ status: s.v })}
            data-testid={`button-status-${testIdPrefix}-${s.v.toLowerCase()}`}
            className={`flex-1 px-2 py-1.5 rounded-md text-[11px] font-semibold border transition-colors ${
              seat.status === s.v ? s.cls : "bg-secondary border-border text-muted-foreground hover:bg-secondary/80"
            }`}
          >{s.label}</button>
        ))}
      </div>
      <label className="inline-flex items-center gap-2 cursor-pointer select-none px-2 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] w-full" data-testid={`toggle-captain-${testIdPrefix}`}>
        <input
          type="checkbox"
          checked={seat.captain}
          onChange={e => onChange({ captain: e.target.checked })}
          className="h-3.5 w-3.5 accent-amber-400"
        />
        <span className="font-semibold text-amber-300">Count as Captain (CAP)</span>
      </label>
    </div>
  );
}

function MiniSelect({ label, value, onChange, opts }: { label: string; value: string; onChange: (v: string) => void; opts: string[] }) {
  return (
    <label className="block">
      <span className="text-[11px] text-muted-foreground">{label}</span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full mt-0.5 px-2 py-1.5 rounded-md bg-input border border-border text-xs"
      >
        {opts.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </label>
  );
}
