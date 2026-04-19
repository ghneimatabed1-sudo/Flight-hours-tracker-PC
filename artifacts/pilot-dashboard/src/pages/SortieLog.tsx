import { useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots, useSorties, useUpdateSortie, useDeleteSortie, useRestoreSortie } from "@/lib/squadron-data";
import { useAuth } from "@/lib/auth";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";
import { SortieDiffDialog } from "@/components/SortieDiffDialog";
import { showUndo } from "@/lib/undo-store";
import { useToast } from "@/hooks/use-toast";
import { Search, Filter, Pencil, Trash2, Lock, Unlock } from "lucide-react";
import type { Pilot, Sortie } from "@/lib/mock";
import { useFrozenAccess } from "@/lib/monthly-close";

export default function SortieLog() {
  const { t } = useI18n();
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [type, setType] = useState("All");
  const [editing, setEditing] = useState<Sortie | null>(null);
  const [deleting, setDeleting] = useState<Sortie | null>(null);
  // Stage of the diff/undo flow once the inline edit form has been
  // submitted: holds the proposed `after` so the change-summary dialog
  // can render the before/after comparison before commit.
  const [pendingEdit, setPendingEdit] = useState<{ before: Sortie; after: Sortie } | null>(null);
  const pilotsQ = usePilots();
  const sortiesQ = useSorties();
  const { data: PILOTS } = pilotsQ;
  const { data: SORTIES } = sortiesQ;
  const updateMut = useUpdateSortie();
  const deleteMut = useDeleteSortie();
  const restoreMut = useRestoreSortie();
  const { toast } = useToast();
  const frozen = useFrozenAccess();

  const lockedMessage =
    "Hours older than 12 months are frozen. Ask the super admin to authorize this PC from Settings.";
  const tryEdit = (s: Sortie) => {
    if (!frozen.canEdit(s.date)) {
      toast({ title: "Frozen records", description: lockedMessage, variant: "destructive" });
      return;
    }
    setEditing(s);
  };
  const tryDelete = (s: Sortie) => {
    if (!frozen.canEdit(s.date)) {
      toast({ title: "Frozen records", description: lockedMessage, variant: "destructive" });
      return;
    }
    setDeleting(s);
  };

  const pilotMap = useMemo(() => Object.fromEntries(PILOTS.map(p => [p.id, p.name])), [PILOTS]);
  const types = useMemo(() => ["All", ...Array.from(new Set(SORTIES.map(s => s.sortieType)))], [SORTIES]);
  const nameOf = (id: string, ext?: { name: string; squadron: string }) => ext ? `${ext.name}${ext.squadron ? ` (${ext.squadron})` : ""}` : (pilotMap[id] || "");

  const rows = SORTIES
    .filter(s => type === "All" || s.sortieType === type)
    .filter(s => !q || (nameOf(s.pilotId, s.pilotExternal) + " " + nameOf(s.coPilotId, s.coPilotExternal) + " " + s.acNumber + " " + s.name).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));

  const snapshotPilots = (s: Sortie): Pilot[] => {
    const ids = [s.pilotId, s.coPilotId].filter(Boolean);
    return ids
      .map(id => PILOTS.find(p => p.id === id))
      .filter((p): p is Pilot => !!p)
      .map(p => structuredClone(p));
  };

  const registerUndo = (snapshot: { sortie: Sortie; pilots: Pilot[] }, label: string) => {
    showUndo({
      message: label,
      undo: async () => {
        try {
          await restoreMut.mutateAsync({
            sortie: snapshot.sortie,
            pilots: snapshot.pilots,
            actor: user?.username,
            reason: "undo",
          });
          toast({ title: "Action undone" });
        } catch {
          toast({ title: "Undo failed", variant: "destructive" });
        }
      },
    });
  };

  const onConfirmDelete = async () => {
    if (!deleting) return;
    const snapshot = { sortie: deleting, pilots: snapshotPilots(deleting) };
    await deleteMut.mutateAsync({ id: deleting.id, date: deleting.date, actor: user?.username });
    setDeleting(null);
    registerUndo(snapshot, "Sortie deleted.");
  };

  const onConfirmEdit = async () => {
    if (!pendingEdit) return;
    const snapshot = { sortie: pendingEdit.before, pilots: snapshotPilots(pendingEdit.before) };
    await updateMut.mutateAsync({ sortie: pendingEdit.after, actor: user?.username });
    setPendingEdit(null);
    registerUndo(snapshot, "Sortie edited.");
  };

  return (
    <div>
      <PageHead title={t("nav_sortielog")} subtitle={`${rows.length} flights`} actions={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} className="pl-7 pr-2 py-1.5 rounded-md bg-input border border-border text-sm" />
          </div>
          <div className="relative">
            <Filter className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <select value={type} onChange={e => setType(e.target.value)} className="pl-7 pr-2 py-1.5 rounded-md bg-input border border-border text-sm">
              {types.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
        </div>
      } />

      <DataUnavailableBanner queries={[pilotsQ, sortiesQ]} testId="banner-sortielog-unavailable" />

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <Th>{t("date")}</Th><Th>{t("acType")}</Th><Th>{t("acNumber")}</Th>
                <Th>{t("pilot")}</Th><Th>{t("coPilot")}</Th><Th>{t("sortieType")}</Th><Th>{t("sortieName")}</Th>
                <Th right>D1</Th><Th right>D2</Th><Th right>DD</Th>
                <Th right>N1</Th><Th right>N2</Th><Th right>ND</Th>
                <Th right cls="text-rose-300">NVG</Th><Th right>Sim</Th><Th right>Actual</Th>
                <Th right>{t("actions")}</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={17} className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="empty-sorties">
                    {pilotsQ.isError || sortiesQ.isError ? "—" : t("no_records")}
                  </td>
                </tr>
              )}
              {rows.map(s => {
                const isFrozen = frozen.isFrozen(s.date);
                const canEdit = frozen.canEdit(s.date);
                const locked = isFrozen && !canEdit;
                return (
                <tr key={s.id} className={`border-t border-border row-hover ${locked ? "opacity-90" : ""}`} data-testid={`row-sortie-${s.id}`}>
                  <Td mono>
                    <span className="inline-flex items-center gap-1">
                      {s.date}
                      {locked && <Lock className="h-3 w-3 text-muted-foreground" aria-label="Frozen (older than 12 months)" />}
                      {isFrozen && canEdit && <Unlock className="h-3 w-3 text-amber-300" aria-label="Frozen — this PC is authorized to edit" />}
                    </span>
                  </Td>
                  <Td>{s.acType}</Td>
                  <Td mono>{s.acNumber}</Td>
                  <Td><SeatCell id={s.pilotId} ext={s.pilotExternal} nameMap={pilotMap} /></Td>
                  <Td><SeatCell id={s.coPilotId} ext={s.coPilotExternal} nameMap={pilotMap} /></Td>
                  <Td>{s.sortieType}</Td>
                  <Td>{s.name}</Td>
                  <Td mono right>{s.day1 || "—"}</Td>
                  <Td mono right>{s.day2 || "—"}</Td>
                  <Td mono right>{s.dayDual || "—"}</Td>
                  <Td mono right>{s.night1 || "—"}</Td>
                  <Td mono right>{s.night2 || "—"}</Td>
                  <Td mono right>{s.nightDual || "—"}</Td>
                  <Td mono right cls={s.nvg ? "text-rose-300" : ""}>{s.nvg || "—"}</Td>
                  <Td mono right>{s.sim || "—"}</Td>
                  <Td mono right>{s.actual}</Td>
                  <Td right>
                    <div className="inline-flex gap-1 items-center">
                      <button
                        onClick={() => tryEdit(s)}
                        disabled={locked}
                        className={`p-1 rounded ${locked ? "opacity-40 cursor-not-allowed" : "hover:bg-secondary"}`}
                        title={locked ? lockedMessage : t("edit")}
                        aria-disabled={locked}
                        data-testid={`button-edit-sortie-${s.id}`}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => tryDelete(s)}
                        disabled={locked}
                        className={`p-1 rounded ${locked ? "opacity-40 cursor-not-allowed" : "hover:bg-destructive/20 text-destructive"}`}
                        title={locked ? lockedMessage : t("delete")}
                        aria-disabled={locked}
                        data-testid={`button-delete-sortie-${s.id}`}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </Td>
                </tr>
              );})}
            </tbody>
          </table>
        </div>
      </Card>

      {editing && (
        <SortieEditDialog
          sortie={editing}
          pilots={PILOTS.map(p => ({ id: p.id, label: `${p.rank} ${p.name}` }))}
          busy={updateMut.isPending}
          onCancel={() => setEditing(null)}
          onSave={(next) => {
            // Defer to the change-summary dialog before committing.
            setPendingEdit({ before: editing, after: next });
            setEditing(null);
          }}
        />
      )}

      {pendingEdit && (
        <SortieDiffDialog
          mode="edit"
          before={pendingEdit.before}
          after={pendingEdit.after}
          onCancel={() => setPendingEdit(null)}
          onConfirm={onConfirmEdit}
          busy={updateMut.isPending}
          pilotName={(id) => pilotMap[id] || id}
        />
      )}

      {deleting && (
        <SortieDiffDialog
          mode="delete"
          before={deleting}
          onCancel={() => setDeleting(null)}
          onConfirm={onConfirmDelete}
          busy={deleteMut.isPending}
          pilotName={(id) => pilotMap[id] || id}
        />
      )}
    </div>
  );
}

function SeatCell({ id, ext, nameMap }: { id: string; ext?: { name: string; squadron: string }; nameMap: Record<string, string> }) {
  if (ext) {
    return (
      <span className="inline-flex items-center gap-1 text-amber-200" title="External pilot">
        <span className="text-[10px] px-1 rounded bg-amber-400/20 border border-amber-400/40 font-semibold">EXT</span>
        <span>{ext.name}{ext.squadron ? ` · ${ext.squadron}` : ""}</span>
      </span>
    );
  }
  return <>{nameMap[id] || id}</>;
}

function Th({ children, right, cls = "" }: { children: React.ReactNode; right?: boolean; cls?: string }) {
  return <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} font-medium ${cls}`}>{children}</th>;
}
function Td({ children, mono, right, cls = "" }: { children: React.ReactNode; mono?: boolean; right?: boolean; cls?: string }) {
  return <td className={`px-3 py-2 ${mono ? "font-mono" : ""} ${right ? "text-right" : ""} ${cls}`}>{children}</td>;
}

interface PilotOpt { id: string; label: string; }
interface SortieEditDialogProps {
  sortie: Sortie;
  pilots: PilotOpt[];
  busy?: boolean;
  onCancel: () => void;
  onSave: (next: Sortie) => void;
}
function SortieEditDialog({ sortie, pilots, busy, onCancel, onSave }: SortieEditDialogProps) {
  const { t } = useI18n();
  const [form, setForm] = useState<Sortie>(sortie);
  const set = <K extends keyof Sortie>(k: K, v: Sortie[K]) => setForm(f => ({ ...f, [k]: v }));
  const num = (v: string) => Number.isFinite(Number(v)) ? Number(v) : 0;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={onCancel}>
      <div className="bg-card border border-border rounded-lg shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-border">
          <div className="text-base font-semibold">{t("editSortieTitle")}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{sortie.id}</div>
        </div>
        <form
          onSubmit={(e) => { e.preventDefault(); onSave(form); }}
          className="p-4 space-y-3"
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <L label={t("date")}><input type="date" value={form.date} onChange={e => set("date", e.target.value)} className={I} data-testid="input-edit-date" /></L>
            <L label={t("acType")}>
              <select value={form.acType} onChange={e => set("acType", e.target.value)} className={I}>
                {["UH-60M", "UH-60L", "UH-60AIL", "AS332"].map(o => <option key={o}>{o}</option>)}
              </select>
            </L>
            <L label={t("acNumber")}><input value={form.acNumber} onChange={e => set("acNumber", e.target.value)} className={I} data-testid="input-edit-acnum" /></L>
            <L label={t("pilot")}>
              <select value={form.pilotId} onChange={e => set("pilotId", e.target.value)} className={I}>
                {pilots.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </L>
            <L label={t("coPilot")}>
              <select value={form.coPilotId} onChange={e => set("coPilotId", e.target.value)} className={I}>
                {pilots.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </L>
            <L label={t("sortieType")}>
              <select value={form.sortieType} onChange={e => set("sortieType", e.target.value)} className={I}>
                {["Training", "Mission", "Check Ride", "FCF", "Transport"].map(o => <option key={o}>{o}</option>)}
              </select>
            </L>
            <L label={t("sortieName")} className="md:col-span-3"><input value={form.name} onChange={e => set("name", e.target.value)} className={I} /></L>
          </div>
          <div className="border-t border-border pt-3">
            <div className="text-xs text-muted-foreground mb-1">{t("condition")}</div>
            <div className="flex items-center gap-2">
              {(["Day", "Night", "NVG"] as const).map(opt => (
                <button
                  type="button"
                  key={opt}
                  onClick={() => set("condition", opt)}
                  className={`px-3 py-1.5 rounded-md text-xs font-medium border ${
                    form.condition === opt
                      ? opt === "NVG" ? "bg-rose-500/20 border-rose-400 text-rose-200" : "bg-primary/20 border-primary text-primary"
                      : "bg-secondary border-border text-muted-foreground"
                  }`}
                >
                  {t(opt === "Day" ? "conditionDay" : opt === "Night" ? "conditionNight" : "conditionNVG")}
                </button>
              ))}
            </div>
          </div>
          <L label={t("remarks")}>
            <textarea value={form.remarks ?? ""} onChange={e => set("remarks", e.target.value)} rows={2} className={I + " resize-none"} />
          </L>
          <div className="grid grid-cols-3 gap-3 border-t border-border pt-3">
            {(["day1","day2","dayDual","night1","night2","nightDual","nvg","sim","actual"] as const).map(k => (
              <L key={k} label={t(k as never) ?? k}>
                <input type="number" step="0.1" value={form[k]} onChange={e => set(k, num(e.target.value))} className={I + " font-mono"} />
              </L>
            ))}
          </div>
          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            <button type="button" onClick={onCancel} className="px-4 py-2 rounded-md bg-secondary border border-border text-sm" data-testid="button-edit-cancel">{t("cancel")}</button>
            <button type="submit" disabled={busy} className="px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium disabled:opacity-50" data-testid="button-edit-save">
              {busy ? "…" : t("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

const I = "w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm";
function L({ label, children, className = "" }: { label: string; children: React.ReactNode; className?: string }) {
  return <label className={`block ${className}`}><span className="text-xs text-muted-foreground">{label}</span>{children}</label>;
}
