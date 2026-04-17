import { useEffect, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots, useCreateSortie } from "@/lib/squadron-data";
import { Plane } from "lucide-react";

export default function AddSortie() {
  const { t } = useI18n();
  const { data: PILOTS } = usePilots();
  const create = useCreateSortie();
  const [form, setForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    acType: "UH-60M", acNumber: "",
    pilot: PILOTS[0]?.id ?? "", coPilot: PILOTS[1]?.id ?? "",
    sortieType: "Training", name: "NAV",
    day1: 0, day2: 0, dayDual: 0,
    night1: 0, night2: 0, nightDual: 0,
    nvg: 0, sim: 0, actual: 0,
  });
  useEffect(() => {
    if (!form.pilot && PILOTS[0]) setForm(f => ({ ...f, pilot: PILOTS[0].id, coPilot: PILOTS[1]?.id ?? PILOTS[0].id }));
  }, [PILOTS, form.pilot]);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(f => ({ ...f, [k]: v }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    try {
      await create.mutateAsync({
        date: form.date, acType: form.acType, acNumber: form.acNumber,
        pilotId: form.pilot, coPilotId: form.coPilot,
        sortieType: form.sortieType, name: form.name,
        day1: form.day1, day2: form.day2, dayDual: form.dayDual,
        night1: form.night1, night2: form.night2, nightDual: form.nightDual,
        nvg: form.nvg, sim: form.sim, actual: form.actual,
      });
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (ex) {
      setErr(ex instanceof Error ? ex.message : "Save failed");
    }
  };

  return (
    <div>
      <PageHead title={t("nav_addsortie")} subtitle="New flight entry · auto-syncs to Supabase" />
      <form onSubmit={submit} className="grid lg:grid-cols-3 gap-4">
        <Card className="space-y-3 lg:col-span-2">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <Field label={t("date")} type="date" value={form.date} onChange={v => set("date", v)} />
            <Select label={t("acType")} value={form.acType} onChange={v => set("acType", v)} opts={["UH-60M", "UH-60L", "UH-60AIL", "AS332"]} />
            <Field label={t("acNumber")} value={form.acNumber} onChange={v => set("acNumber", v)} placeholder="e.g. 832" />
            <Select label={t("pilot")} value={form.pilot} onChange={v => set("pilot", v)} opts={PILOTS.map(p => ({ value: p.id, label: `${p.rank} ${p.name}` }))} />
            <Select label={t("coPilot")} value={form.coPilot} onChange={v => set("coPilot", v)} opts={PILOTS.map(p => ({ value: p.id, label: `${p.rank} ${p.name}` }))} />
            <Select label={t("sortieType")} value={form.sortieType} onChange={v => set("sortieType", v)} opts={["Training", "Mission", "Check Ride", "FCF", "Transport"]} />
            <Field label={t("sortieName")} value={form.name} onChange={v => set("name", v)} className="md:col-span-3" />
          </div>

          <div className="border-t border-border pt-3">
            <div className="title-line mb-2">Day</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("day1")} type="number" value={form.day1} onChange={v => set("day1", +v)} />
              <Field label={t("day2")} type="number" value={form.day2} onChange={v => set("day2", +v)} />
              <Field label={t("dayDual")} type="number" value={form.dayDual} onChange={v => set("dayDual", +v)} />
            </div>
          </div>
          <div>
            <div className="title-line mb-2">Night</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("night1")} type="number" value={form.night1} onChange={v => set("night1", +v)} />
              <Field label={t("night2")} type="number" value={form.night2} onChange={v => set("night2", +v)} />
              <Field label={t("nightDual")} type="number" value={form.nightDual} onChange={v => set("nightDual", +v)} />
            </div>
          </div>
          <div>
            <div className="title-line mb-2">Other</div>
            <div className="grid grid-cols-3 gap-3">
              <Field label={t("nvg")} type="number" value={form.nvg} onChange={v => set("nvg", +v)} className="text-rose-300" />
              <Field label={t("sim")} type="number" value={form.sim} onChange={v => set("sim", +v)} />
              <Field label={t("actual")} type="number" value={form.actual} onChange={v => set("actual", +v)} />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2">
            <button className="px-4 py-2 rounded-md bg-primary text-primary-foreground font-medium hover:opacity-90 inline-flex items-center gap-2">
              <Plane className="h-4 w-4" /> {t("submit")}
            </button>
            {saved && <span className="text-emerald-300 text-sm">✔ Saved · queued for sync</span>}
            {err && <span className="text-rose-300 text-sm">{err}</span>}
          </div>
        </Card>

        <Card>
          <div className="text-sm font-semibold mb-2">Summary</div>
          <Row k="Day total" v={(form.day1 + form.day2 + form.dayDual).toFixed(1)} />
          <Row k="Night total" v={(form.night1 + form.night2 + form.nightDual).toFixed(1)} />
          <Row k="NVG" v={form.nvg.toFixed(1)} accent="text-rose-300" />
          <Row k="Sim" v={form.sim.toFixed(1)} />
          <Row k="Actual" v={form.actual.toFixed(1)} bold />
          <div className="text-[11px] text-muted-foreground mt-3">{t("bigPlaceholder")}</div>
        </Card>
      </form>
    </div>
  );
}

type FieldProps = {
  label: string;
  value: string | number;
  onChange: (v: string) => void;
  type?: string;
  className?: string;
  placeholder?: string;
};
function Field({ label, value, onChange, type = "text", className = "", placeholder }: FieldProps) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-muted-foreground">{label}</span>
      <input type={type} value={value} placeholder={placeholder}
        onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm font-mono" />
    </label>
  );
}
type SelectOpt = string | { value: string; label: string };
type SelectProps = { label: string; value: string; onChange: (v: string) => void; opts: SelectOpt[] };
function Select({ label, value, onChange, opts }: SelectProps) {
  const items = opts.map(o => typeof o === "string" ? { value: o, label: o } : o);
  return (
    <label className="block">
      <span className="text-xs text-muted-foreground">{label}</span>
      <select value={value} onChange={e => onChange(e.target.value)}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm">
        {items.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}
type RowProps = { k: string; v: string | number; accent?: string; bold?: boolean };
function Row({ k, v, accent = "", bold }: RowProps) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5 border-b border-border last:border-b-0">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono ${accent} ${bold ? "font-semibold text-base" : ""}`}>{v}</span>
    </div>
  );
}
