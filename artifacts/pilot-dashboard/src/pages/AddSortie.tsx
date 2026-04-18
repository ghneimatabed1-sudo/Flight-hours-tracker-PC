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

// Re-creates the look of the legacy "ADD SORTIES" Access form (image 1):
// a single compact row of inputs, a list of all entries below, and inline
// Edit/Delete controls. Per-seat position (1st/2nd PLT) + "Count as
// Captain" toggles drive the credited bucket via deriveSortieBuckets.

const SORTIE_TYPES = [
  "MSN DAY", "MSN NIGHT", "MSN NVG",
  "TRG DAY", "TRG NIGHT", "TRG NVG",
  "NAV", "NAV DAY", "NAV NIGHT",
  "FCF", "ACADEMIC", "EMER", "INSTR",
  "CHECK RIDE", "TRANSPORT", "SAR", "MEDEVAC",
  "Other…",
];

type Condition = "Day" | "Night" | "NVG";
type SeatPos = "1st" | "2nd";

interface FormState {
  id: string | null;
  date: string;
  acType: string;
  acNumber: string;
  pilot: string;
  coPilot: string;
  pilotPosition: SeatPos;
  coPilotPosition: SeatPos;
  pilotIsCaptain: boolean;
  coPilotIsCaptain: boolean;
  sortieType: string;
  sortieTypeOther: string;
  msnDuty: string;
  condition: Condition;
  dual: boolean;
  time: string; // keep as string for free typing, parse on submit
  sim: string;
  actual: string;
  remarks: string;
}

const blankForm = (): FormState => ({
  id: null,
  date: new Date().toISOString().slice(0, 10),
  acType: "UH-60M",
  acNumber: "",
  pilot: "",
  coPilot: "",
  pilotPosition: "1st",
  coPilotPosition: "2nd",
  pilotIsCaptain: true,
  coPilotIsCaptain: false,
  sortieType: "TRG DAY",
  sortieTypeOther: "",
  msnDuty: "",
  condition: "Day",
  dual: false,
  time: "",
  sim: "",
  actual: "",
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
    if (!form.pilot && PILOTS[0]) {
      setForm(f => ({
        ...f,
        pilot: PILOTS[0].id,
        coPilot: PILOTS[1]?.id ?? PILOTS[0].id,
      }));
    }
  }, [PILOTS, form.pilot]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const pilotOpts = useMemo(
    () => PILOTS.map(p => ({ value: p.id, label: `${p.rank} ${p.name}` })),
    [PILOTS],
  );
  const pilotById = (id: string) => PILOTS.find(p => p.id === id);

  // Today's sorties (and the row currently being edited) — matches the old
  // form's scoped table.
  const todaySorties = useMemo(() => {
    const list = SORTIES.filter(s => s.date === form.date);
    return [...list].sort((a, b) => (a.id < b.id ? 1 : -1));
  }, [SORTIES, form.date]);

  const totals = useMemo(() => {
    let s = 0, h = 0;
    for (const r of todaySorties) {
      s += 1;
      const t =
        Number(r.actual) ||
        Number(r.day1 || 0) + Number(r.day2 || 0) + Number(r.dayDual || 0) +
        Number(r.night1 || 0) + Number(r.night2 || 0) + Number(r.nightDual || 0);
      h += Number.isFinite(t) ? t : 0;
    }
    return { s, h: +h.toFixed(1) };
  }, [todaySorties]);

  const resetForm = () => setForm(f => ({ ...blankForm(), date: f.date, acType: f.acType, acNumber: f.acNumber, pilot: f.pilot, coPilot: f.coPilot }));

  const submit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const time = parseFloat(form.time || "0");
    if (!(time > 0) && !form.sim && !form.actual) {
      toast({ title: "Time required", description: "Enter Time, Sim, or Actual hours.", variant: "destructive" });
      return;
    }
    if (form.pilot === form.coPilot && form.pilot) {
      toast({ title: "Pilot and Co-Pilot are the same", variant: "destructive" });
      return;
    }
    const buckets = deriveSortieBuckets({
      time,
      condition: form.condition,
      pilotPosition: form.pilotPosition,
      dual: form.dual,
    });
    const sortieType = form.sortieType === "Other…" ? form.sortieTypeOther.trim() || "OTHER" : form.sortieType;
    const payload: Omit<Sortie, "id"> = {
      date: form.date,
      acType: form.acType,
      acNumber: form.acNumber.trim(),
      pilotId: form.pilot,
      coPilotId: form.coPilot,
      sortieType,
      name: form.msnDuty.trim() || sortieType,
      condition: form.condition,
      remarks: form.remarks.trim() || undefined,
      day1: buckets.day1, day2: buckets.day2, dayDual: buckets.dayDual,
      night1: buckets.night1, night2: buckets.night2, nightDual: buckets.nightDual,
      nvg: buckets.nvg,
      sim: parseFloat(form.sim || "0") || 0,
      actual: parseFloat(form.actual || String(buckets.actual)) || buckets.actual,
      time,
      dual: form.dual,
      pilotPosition: form.pilotPosition,
      coPilotPosition: form.coPilotPosition,
      pilotIsCaptain: form.pilotIsCaptain,
      coPilotIsCaptain: form.coPilotIsCaptain,
      msnDuty: form.msnDuty.trim() || undefined,
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
    setForm({
      id: s.id,
      date: s.date,
      acType: s.acType || "UH-60M",
      acNumber: s.acNumber || "",
      pilot: s.pilotId,
      coPilot: s.coPilotId,
      pilotPosition: s.pilotPosition ?? "1st",
      coPilotPosition: s.coPilotPosition ?? "2nd",
      pilotIsCaptain: s.pilotIsCaptain ?? true,
      coPilotIsCaptain: s.coPilotIsCaptain ?? false,
      sortieType: SORTIE_TYPES.includes(s.sortieType) ? s.sortieType : "Other…",
      sortieTypeOther: SORTIE_TYPES.includes(s.sortieType) ? "" : s.sortieType,
      msnDuty: s.msnDuty ?? s.name ?? "",
      condition: (s.condition as Condition) || "Day",
      dual: !!s.dual,
      time: String(s.time ?? s.actual ?? ""),
      sim: String(s.sim || ""),
      actual: String(s.actual || ""),
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

      {/* Compact entry form (mirrors the legacy Add Sorties dialog) */}
      <Card className="mb-4">
        <form onSubmit={submit} className="space-y-3" data-testid="form-add-sortie">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2">
            <Mini label="Date" type="date" value={form.date} onChange={v => set("date", v)} />
            <MiniSelect label="A/C Type" value={form.acType} onChange={v => set("acType", v)} opts={["UH-60M", "UH-60L", "UH-60AIL", "AS332"]} />
            <Mini label="A/C No" value={form.acNumber} onChange={v => set("acNumber", v)} placeholder="e.g. 832" />
            <MiniSelect
              label="Sortie Type"
              value={form.sortieType}
              onChange={v => set("sortieType", v)}
              opts={SORTIE_TYPES}
            />
            <Mini label="Time" type="number" step="0.1" value={form.time} onChange={v => set("time", v)} placeholder="0.0" />
            <Mini label="Sim" type="number" step="0.1" value={form.sim} onChange={v => set("sim", v)} placeholder="0.0" />
          </div>

          {form.sortieType === "Other…" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <Mini label="Custom sortie type" value={form.sortieTypeOther} onChange={v => set("sortieTypeOther", v)} placeholder="Type your own…" />
              <Mini label="MSN / Duty" value={form.msnDuty} onChange={v => set("msnDuty", v)} placeholder="Mission name / duty" />
            </div>
          )}
          {form.sortieType !== "Other…" && (
            <div>
              <Mini label="MSN / Duty (optional)" value={form.msnDuty} onChange={v => set("msnDuty", v)} placeholder="Mission name / duty" />
            </div>
          )}

          {/* Crew row with per-seat position + captain toggle */}
          <div className="grid lg:grid-cols-2 gap-3">
            <SeatBlock
              label="Pilot"
              pilotId={form.pilot}
              onPilot={v => set("pilot", v)}
              position={form.pilotPosition}
              onPosition={v => set("pilotPosition", v)}
              captain={form.pilotIsCaptain}
              onCaptain={v => set("pilotIsCaptain", v)}
              opts={pilotOpts}
              testIdPrefix="pilot"
            />
            <SeatBlock
              label="Co-Pilot"
              pilotId={form.coPilot}
              onPilot={v => set("coPilot", v)}
              position={form.coPilotPosition}
              onPosition={v => set("coPilotPosition", v)}
              captain={form.coPilotIsCaptain}
              onCaptain={v => set("coPilotIsCaptain", v)}
              opts={pilotOpts}
              testIdPrefix="copilot"
            />
          </div>

          {/* Condition + DUAL + Actual + ADD */}
          <div className="flex flex-wrap items-end gap-3 border-t border-border pt-3">
            <div className="flex items-center gap-2" data-testid="condition-selector">
              {(["Day", "Night", "NVG"] as const).map(opt => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => set("condition", opt)}
                  data-testid={`button-condition-${opt}`}
                  className={`px-3 py-1.5 rounded-md text-xs font-semibold border transition-colors ${
                    form.condition === opt
                      ? opt === "NVG"
                        ? "bg-rose-500/20 border-rose-400 text-rose-200"
                        : opt === "Night"
                        ? "bg-indigo-500/20 border-indigo-400 text-indigo-200"
                        : "bg-amber-400/20 border-amber-400 text-amber-200"
                      : "bg-secondary border-border text-muted-foreground hover:bg-secondary/80"
                  }`}
                >
                  {opt === "Night" ? "NITE" : opt.toUpperCase()}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-1.5 text-xs cursor-pointer select-none" data-testid="toggle-dual">
              <input type="checkbox" checked={form.dual} onChange={e => set("dual", e.target.checked)} className="h-3.5 w-3.5 accent-primary" />
              <span className="font-semibold">DUAL</span>
            </label>
            <div className="w-32">
              <Mini label="Actual" type="number" step="0.1" value={form.actual} onChange={v => set("actual", v)} placeholder="auto" />
            </div>
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

          {/* Remarks (optional) */}
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

      {/* Sortie list table (today's flights) */}
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
                <th className="pr-2">A/C TYPE</th>
                <th className="pr-2">A/C NO.</th>
                <th className="pr-2">PILOT</th>
                <th className="pr-2">CO-PILOT</th>
                <th className="pr-2">SORTIE TYPE</th>
                <th className="pr-2">MSN/DUTY</th>
                <th className="pr-2">D/N</th>
                <th className="pr-2">DUAL</th>
                <th className="pr-2 text-right">TIME</th>
                <th className="pr-2 text-right">SIM</th>
                <th className="pr-2 text-right">ACT</th>
                <th className="pr-2 text-right">…</th>
              </tr>
            </thead>
            <tbody>
              {todaySorties.length === 0 && (
                <tr><td colSpan={13} className="py-3 text-center text-muted-foreground italic">No sorties logged on this date yet.</td></tr>
              )}
              {todaySorties.map(s => {
                const time = s.time ?? s.actual ?? (s.day1 + s.day2 + s.dayDual + s.night1 + s.night2 + s.nightDual);
                const dn = s.condition === "NVG" ? "NVG" : s.condition === "Night" ? "N" : "D";
                return (
                  <tr key={s.id} className={`border-b border-border/50 hover:bg-secondary/30 ${form.id === s.id ? "bg-primary/10" : ""}`} data-testid={`sortie-row-${s.id}`}>
                    <td className="py-1.5 pr-2">{s.date}</td>
                    <td className="pr-2">{s.acType}</td>
                    <td className="pr-2">{s.acNumber}</td>
                    <td className="pr-2">{seatLabel(s.pilotId, s.pilotExternal)}{s.pilotIsCaptain ? <span className="ml-1 text-[9px] text-amber-300">CAPT</span> : null}</td>
                    <td className="pr-2">{seatLabel(s.coPilotId, s.coPilotExternal)}{s.coPilotIsCaptain ? <span className="ml-1 text-[9px] text-amber-300">CAPT</span> : null}</td>
                    <td className="pr-2">{s.sortieType}</td>
                    <td className="pr-2 text-muted-foreground">{s.msnDuty || s.name || "—"}</td>
                    <td className="pr-2">{dn}</td>
                    <td className="pr-2">{s.dual ? "✓" : ""}</td>
                    <td className="pr-2 text-right">{Number(time || 0).toFixed(1)}</td>
                    <td className="pr-2 text-right">{Number(s.sim || 0).toFixed(1)}</td>
                    <td className="pr-2 text-right">{Number(s.actual || 0).toFixed(1)}</td>
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
                  <td colSpan={9} className="py-2 text-right">ALL TOTALS</td>
                  <td className="pr-2 text-right">S {totals.s}</td>
                  <td className="pr-2 text-right">H {totals.h.toFixed(1)}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </Card>

      {/* Delete confirmation modal */}
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

// ── Components ──────────────────────────────────────────────────────────

interface SeatProps {
  label: string;
  pilotId: string;
  onPilot: (v: string) => void;
  position: SeatPos;
  onPosition: (v: SeatPos) => void;
  captain: boolean;
  onCaptain: (v: boolean) => void;
  opts: { value: string; label: string }[];
  testIdPrefix: string;
}
function SeatBlock({ label, pilotId, onPilot, position, onPosition, captain, onCaptain, opts, testIdPrefix }: SeatProps) {
  return (
    <div className="border border-border rounded-md p-2 bg-secondary/20" data-testid={`seat-${testIdPrefix}`}>
      <div className="flex items-center justify-between mb-1.5">
        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</div>
        <label className="inline-flex items-center gap-1 text-[10px] cursor-pointer select-none">
          <input type="checkbox" checked={captain} onChange={e => onCaptain(e.target.checked)} className="h-3 w-3 accent-amber-400" data-testid={`toggle-captain-${testIdPrefix}`} />
          <span className="text-amber-300 font-semibold">Count as Captain</span>
        </label>
      </div>
      <div className="grid grid-cols-3 gap-2">
        <select
          className="col-span-2 px-2 py-1.5 rounded-md bg-input border border-border text-xs"
          value={pilotId}
          onChange={e => onPilot(e.target.value)}
          data-testid={`select-${testIdPrefix}`}
        >
          {opts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <select
          className="px-2 py-1.5 rounded-md bg-input border border-border text-xs"
          value={position}
          onChange={e => onPosition(e.target.value as SeatPos)}
          data-testid={`select-position-${testIdPrefix}`}
        >
          <option value="1st">1st PLT</option>
          <option value="2nd">2nd PLT</option>
        </select>
      </div>
    </div>
  );
}

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
