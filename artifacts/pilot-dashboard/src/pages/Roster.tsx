import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots, useUpdatePilot, useCreatePilot, useDeletePilot, type Pilot } from "@/lib/squadron-data";
import { Link } from "wouter";
import { Plus, Search, Pencil, Trash2, X, Loader2, FileDown } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";

export default function Roster() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [importedOnly, setImportedOnly] = useState(false);
  const pilotsQ = usePilots();
  const { data: PILOTS, isLoading, isFetching } = pilotsQ;
  const updatePilot = useUpdatePilot();
  const createPilot = useCreatePilot();
  const deletePilot = useDeletePilot();
  const [editing, setEditing] = useState<Pilot | null>(null);
  const [adding, setAdding] = useState<Pilot | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Pilot | null>(null);
  const [err, setErr] = useState("");

  const blankPilot = (): Pilot => {
    const nextId = (() => {
      const nums = PILOTS.map(p => parseInt(p.id.replace(/\D/g, ""), 10)).filter(n => !isNaN(n));
      const max = nums.length ? Math.max(...nums) : 0;
      return `P${String(max + 1).padStart(3, "0")}`;
    })();
    return {
      id: nextId,
      name: "",
      arabicName: "",
      militaryNumber: "",
      rank: "",
      phone: "",
      address: "",
      unit: "SQDN",
      openingDay: 0,
      openingNight: 0,
      openingNvg: 0,
      doctorNote: "",
      monthDay: 0,
      monthNight: 0,
      monthNvg: 0,
      monthSim: 0,
      monthCaptain: 0,
      totalDay: 0,
      totalNight: 0,
      totalNvg: 0,
      totalSim: 0,
      totalCaptain: 0,
      expiry: { day: "", night: "", nvg: "", irt: "", medical: "", sim: "" },
      available: true,
      qualifications: [],
      lastSimDate: "",
    };
  };

  const list = PILOTS
    .filter(p => !importedOnly || p.imported)
    .filter(p => !q || (p.name + p.arabicName + p.id).toLowerCase().includes(q.toLowerCase()));
  const importedCount = PILOTS.filter(p => p.imported).length;

  const onSave = async (next: Pilot) => {
    setErr("");
    try {
      await updatePilot.mutateAsync(next);
      setEditing(null);
    } catch (e) {
      setErr((e as Error).message || "Update failed");
    }
  };

  const onCreate = async (next: Pilot) => {
    setErr("");
    try {
      await createPilot.mutateAsync(next);
      setAdding(null);
    } catch (e) {
      setErr((e as Error).message || "Create failed");
    }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    setErr("");
    try {
      await deletePilot.mutateAsync(confirmDelete.id);
      setConfirmDelete(null);
    } catch (e) {
      setErr((e as Error).message || "Delete failed");
    }
  };

  return (
    <div>
      <PageHead title={t("nav_roster")} subtitle={`${list.length} / ${PILOTS.length} pilots${isFetching && !isLoading ? " · " + t("syncing") : ""}`} actions={
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setImportedOnly(v => !v)}
            disabled={importedCount === 0}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border ${importedOnly ? "bg-primary text-primary-foreground border-primary" : "bg-secondary text-foreground border-border"} disabled:opacity-40 disabled:cursor-not-allowed`}
            title={importedCount === 0 ? t("noImportedYet") : ""}
            data-testid="toggle-imported-only"
          >
            <FileDown className="h-3.5 w-3.5" /> {t("importedOnly")} ({importedCount})
          </button>
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} className="pl-7 pr-2 py-1.5 rounded-md bg-input border border-border text-sm" />
          </div>
          <button
            onClick={() => setAdding(blankPilot())}
            data-testid="button-add-pilot"
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90"
          >
            <Plus className="h-4 w-4" /> {t("add")}
          </button>
        </div>
      } />
      {err && <div className="mb-3 text-xs text-destructive bg-destructive/10 border border-destructive/30 rounded-md px-3 py-2">{err}</div>}
      <DataUnavailableBanner queries={[pilotsQ]} testId="banner-roster-unavailable" />
      {isLoading && PILOTS.length === 0 && (
        <div className="flex items-center justify-center py-12 text-sm text-muted-foreground" data-testid="loading-pilots">
          <Loader2 className="h-4 w-4 me-2 animate-spin" /> {t("loading")}
        </div>
      )}
      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("militaryNumber")}</th>
                <th className="px-3 py-2 text-left">{t("rank")}</th>
                <th className="px-3 py-2 text-left">{t("name")}</th>
                <th className="px-3 py-2 text-left">{t("arabicName")}</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">{t("phone")}</th>
                <th className="px-3 py-2 text-right">{t("openingDay")}</th>
                <th className="px-3 py-2 text-right">{t("openingNight")}</th>
                <th className="px-3 py-2 text-right">{t("openingNvg")}</th>
                <th className="px-3 py-2 text-left">{t("doctorNote")}</th>
                <th className="px-3 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 && !isLoading && (
                <tr>
                  <td colSpan={11} className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="empty-pilots">
                    {pilotsQ.isError ? "—" : t("no_records")}
                  </td>
                </tr>
              )}
              {list.map((p: Pilot) => (
                <tr key={p.id} className="border-t border-border row-hover">
                  <td className="px-3 py-2 font-mono">{p.militaryNumber || p.id}</td>
                  <td className="px-3 py-2">{p.rank}</td>
                  <td className="px-3 py-2"><Link href={`/pilot/${p.id}`} className="hover:text-primary">{p.name}</Link></td>
                  <td className="px-3 py-2 text-right rtl:text-left">{p.arabicName}</td>
                  <td className="px-3 py-2"><span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">{p.unit}</span></td>
                  <td className="px-3 py-2 font-mono">{p.phone}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingDay}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingNight}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingNvg}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.doctorNote || "—"}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap">
                    <button onClick={() => setEditing(p)} className="p-1.5 rounded hover:bg-secondary" title={t("edit")} data-testid={`button-edit-${p.id}`}>
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button onClick={() => setConfirmDelete(p)} className="p-1.5 rounded hover:bg-destructive/20 text-destructive" title={t("delete")} data-testid={`button-delete-${p.id}`}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <PilotEditDialog
          pilot={editing}
          onClose={() => setEditing(null)}
          onSave={onSave}
          saving={updatePilot.isPending}
        />
      )}

      {adding && (
        <PilotEditDialog
          pilot={adding}
          onClose={() => setAdding(null)}
          onSave={onCreate}
          saving={createPilot.isPending}
          isNew
        />
      )}

      {confirmDelete && (
        <ConfirmDialog
          title={t("delete") + " " + confirmDelete.name + "?"}
          message={`This will remove pilot ${confirmDelete.id} (${confirmDelete.name}). This action cannot be undone.`}
          confirmLabel={t("delete")}
          onCancel={() => setConfirmDelete(null)}
          onConfirm={onDelete}
          busy={deletePilot.isPending}
          danger
        />
      )}
    </div>
  );
}

function PilotEditDialog({ pilot, onClose, onSave, saving, isNew }: { pilot: Pilot; onClose: () => void; onSave: (p: Pilot) => void; saving: boolean; isNew?: boolean }) {
  const { t } = useI18n();
  const [p, setP] = useState<Pilot>(pilot);
  // Functional updater — without this, rapid keystrokes can read a stale `p`
  // closure when React batches updates inside Electron's renderer, making
  // the field appear "frozen" after the first character. Reported by ops.
  const set = <K extends keyof Pilot>(k: K, v: Pilot[K]) => setP(prev => ({ ...prev, [k]: v }));
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave(p);
  };
  return (
    // NOTE: no backdrop-blur. Chromium's backdrop-filter on Windows w/ HW
    // accel can intermittently swallow keyboard events from inputs sitting
    // *behind* it (the inputs render in their own compositor layer). Pure
    // black/60 is just as visible and never breaks input.
    <div className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4" onClick={onClose} data-testid="overlay-pilot-edit">
      <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-4 border-b border-border">
          <div className="text-base font-semibold gold-grad">{isNew ? t("add") : t("edit")} — {p.id}</div>
          <button onClick={onClose} className="p-1 rounded hover:bg-secondary"><X className="h-4 w-4" /></button>
        </div>
        <form onSubmit={submit} className="p-4 space-y-3" data-testid="form-edit-pilot">
          <div className="grid grid-cols-2 gap-3">
            {isNew && (
              <Field label="ID" value={p.id} onChange={v => set("id", v)} testId="input-id" autoFocus />
            )}
            <Field label={t("callSign")} value={p.callSign || ""} onChange={v => set("callSign", v)} testId="input-callSign" autoFocus={!isNew} />
            <Field label={t("flightName")} value={p.flightName || ""} onChange={v => set("flightName", v)} testId="input-flightName" />
            <Field label={t("name")} value={p.name} onChange={v => set("name", v)} testId="input-name" />
            <Field label={t("arabicName")} value={p.arabicName} onChange={v => set("arabicName", v)} testId="input-arabicName" />
            <Field label={t("militaryNumber")} value={p.militaryNumber || ""} onChange={v => set("militaryNumber", v)} testId="input-militaryNumber" />
            <Field label={t("rank")} value={p.rank} onChange={v => set("rank", v)} testId="input-rank" />
            <Field label={t("phone")} value={p.phone} onChange={v => set("phone", v)} testId="input-phone" />
            <label className="block text-xs col-span-2">
              <span className="text-muted-foreground">Unit</span>
              <select value={p.unit} onChange={e => set("unit", e.target.value as Pilot["unit"])} className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm" data-testid="select-unit">
                <option value="SQDN">SQDN</option>
                <option value="HQ Attached">HQ Attached</option>
                <option value="UH-60M">UH-60M</option>
                <option value="UH-60AIL">UH-60AIL</option>
                <option value="Both">Both</option>
                <option value="RCN">RCN</option>
                <option value="Other">Other</option>
              </select>
            </label>
            <Field label={t("address")} value={p.address || ""} onChange={v => set("address", v)} testId="input-address" />
            <Field label={t("doctorNote")} value={p.doctorNote || ""} onChange={v => set("doctorNote", v)} testId="input-doctorNote" />
            <label className="block text-xs col-span-2">
              <span className="text-muted-foreground">{t("qualifications")}</span>
              <input
                type="text"
                value={(p.qualifications || []).join(", ")}
                onChange={e => {
                  const tags = e.target.value
                    .split(",")
                    .map(s => s.trim().toUpperCase())
                    .filter(Boolean);
                  set("qualifications", Array.from(new Set(tags)));
                }}
                placeholder="MTP, QHI, IP"
                data-testid="input-qualifications"
                className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm font-mono tracking-wider"
              />
              <span className="block mt-1 text-[10px] text-muted-foreground">{t("qualificationsHelp")}</span>
            </label>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <NumField label={t("openingDay")} value={p.openingDay} onChange={v => set("openingDay", v)} testId="input-openingDay" />
            <NumField label={t("openingNight")} value={p.openingNight} onChange={v => set("openingNight", v)} testId="input-openingNight" />
            <NumField label={t("openingNvg")} value={p.openingNvg} onChange={v => set("openingNvg", v)} testId="input-openingNvg" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
            <div className="col-span-3">
              <div className="text-xs text-muted-foreground font-semibold uppercase tracking-wider">Currency Expiry Dates</div>
              <div className="text-[11px] text-amber-300 mt-1">
                Enter the date each currency <strong>EXPIRES</strong> (runs out) — NOT the date the check was performed.
                A date in the past will show as EXPIRED in red.
              </div>
            </div>
            <Field label="Day expires on"     value={p.expiry.day}     onChange={v => set("expiry", { ...p.expiry, day: v })}     type="date" testId="input-expDay" />
            <Field label="Night expires on"   value={p.expiry.night}   onChange={v => set("expiry", { ...p.expiry, night: v })}   type="date" testId="input-expNight" />
            <Field label="NVG expires on"     value={p.expiry.nvg}     onChange={v => set("expiry", { ...p.expiry, nvg: v })}     type="date" testId="input-expNvg" />
            <Field label="IRT expires on"     value={p.expiry.irt}     onChange={v => set("expiry", { ...p.expiry, irt: v })}     type="date" testId="input-expIrt" />
            <Field label="Medical expires on" value={p.expiry.medical} onChange={v => set("expiry", { ...p.expiry, medical: v })} type="date" testId="input-expMedical" />
            <Field label="Sim expires on"     value={p.expiry.sim}     onChange={v => set("expiry", { ...p.expiry, sim: v })}     type="date" testId="input-expSim" />
          </div>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border">
            <label className="block text-xs col-span-3 sm:col-span-1">
              <span className="text-muted-foreground">{t("lastSimDate")}</span>
              <input
                type="date"
                value={p.lastSimDate || ""}
                onChange={e => set("lastSimDate", e.target.value)}
                data-testid="input-lastSimDate"
                className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm font-mono"
              />
            </label>
            <div className="col-span-3 sm:col-span-2 text-[11px] text-muted-foreground self-end pb-2">
              {t("lastSimDateHelp")} · <span className="italic">{t("lastSimDateVisibility")}</span>
            </div>
          </div>
          <div className="flex items-center justify-end gap-2 pt-3 border-t border-border">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-md bg-secondary border border-border text-sm">{t("cancel")}</button>
            <button type="submit" disabled={saving} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50" data-testid="button-save-pilot">
              {saving ? t("syncing") : t("save_changes")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ label, value, onChange, type = "text", testId, autoFocus }: { label: string; value: string; onChange: (v: string) => void; type?: string; testId?: string; autoFocus?: boolean }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        data-testid={testId}
        autoComplete="off"
        autoFocus={autoFocus}
        className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
      />
    </label>
  );
}

function NumField({ label, value, onChange, testId }: { label: string; value: number; onChange: (v: number) => void; testId?: string }) {
  return (
    <label className="block text-xs">
      <span className="text-muted-foreground">{label}</span>
      <input type="number" step="0.1" value={value} onChange={e => onChange(parseFloat(e.target.value) || 0)} data-testid={testId} className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm font-mono" />
    </label>
  );
}

