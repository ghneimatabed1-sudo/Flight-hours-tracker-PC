import { useEffect, useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { Plus, Trash2, Save, Settings as Cog } from "lucide-react";

/**
 * Leaves (rebuilt)
 *
 * Two views:
 *   - MONTHLY: rows = pilots, cols = months of the selected year. Each cell
 *     is a count of leave-days the pilot took in that month, summed across
 *     every leave type. The right-hand "Total" column is the year total.
 *   - WEEKLY:  rows = pilots, cols = the 7 ISO-week buckets across the
 *     selected month. Same summing logic at the day-bucket level.
 *
 * Custom leave types: the operator can define their own labels (e.g.
 * "Annual", "Sick", "Hajj") with a color. Leaves are entered as records
 * { pilotId, typeId, from, to } and the table aggregates them.
 *
 * Storage:
 *   rjaf.leaves.types.v1   = LeaveType[]
 *   rjaf.leaves.entries.v1 = LeaveEntry[]
 *
 * The roster auto-populates the rows: every active pilot appears whether
 * or not they have leaves.
 */

const TYPES_KEY   = "rjaf.leaves.types.v1";
const ENTRIES_KEY = "rjaf.leaves.entries.v1";

const PALETTE = ["#22c55e","#f59e0b","#ef4444","#3b82f6","#a855f7","#06b6d4","#eab308","#ec4899"];

interface LeaveType { id: string; name: string; color: string; }
interface LeaveEntry { id: string; pilotId: string; typeId: string; from: string; to: string; note?: string; }

// Built-in leave types required by the squadron ops manual. Each carries
// a short single/double-letter code that's drawn into the per-day cell so
// commanders can read the type at a glance without hovering. Operators can
// still add fully custom types via the Types panel.
const DEFAULT_TYPES: LeaveType[] = [
  { id: "leave",         name: "Leave",         color: "#22c55e" },
  { id: "morning-leave", name: "Morning Leave", color: "#84cc16" },
  { id: "crew-rest",     name: "Crew Rest",     color: "#3b82f6" },
  { id: "outside-duty",  name: "Outside Duty",  color: "#a855f7" },
  { id: "sick",          name: "Sick",          color: "#ef4444" },
];

// Short cell-code per type. Falls back to first 2 letters of the name for
// custom types added by the operator.
const BUILTIN_CODES: Record<string, string> = {
  "leave": "L",
  "morning-leave": "ML",
  "crew-rest": "CR",
  "outside-duty": "OD",
  "sick": "S",
};
function codeFor(t: LeaveType): string {
  return BUILTIN_CODES[t.id] ?? t.name.replace(/[^A-Za-z\u0600-\u06FF]/g, "").slice(0, 2).toUpperCase();
}

function loadTypes(): LeaveType[] {
  try { const raw = localStorage.getItem(TYPES_KEY); if (raw) return JSON.parse(raw); } catch { /* */ }
  return DEFAULT_TYPES;
}
function loadEntries(): LeaveEntry[] {
  try { const raw = localStorage.getItem(ENTRIES_KEY); if (raw) return JSON.parse(raw); } catch { /* */ }
  return [];
}

function daysBetween(fromIso: string, toIso: string): Date[] {
  const out: Date[] = [];
  const a = new Date(fromIso + "T00:00:00");
  const b = new Date(toIso + "T00:00:00");
  if (isNaN(a.getTime()) || isNaN(b.getTime()) || b < a) return out;
  for (let d = new Date(a); d <= b; d.setDate(d.getDate() + 1)) out.push(new Date(d));
  return out;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function Leaves() {
  const { t } = useI18n();
  const pilotsQ = usePilots();
  const PILOTS = pilotsQ.data;

  const [types, setTypes]   = useState<LeaveType[]>(() => loadTypes());
  const [entries, setEntries] = useState<LeaveEntry[]>(() => loadEntries());
  useEffect(() => { localStorage.setItem(TYPES_KEY, JSON.stringify(types)); }, [types]);
  useEffect(() => { localStorage.setItem(ENTRIES_KEY, JSON.stringify(entries)); }, [entries]);

  const [view, setView] = useState<"monthly" | "weekly">("monthly");
  const today = new Date();
  const [year, setYear]   = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());
  const [showSettings, setShowSettings] = useState(false);

  // Aggregations: per (pilotId, bucket) we keep a Record<typeId, count> so
  // each cell can render every type that contributed, with its own color
  // and short code, instead of collapsing to a single number that hides
  // type information.
  type CellMap = Record<string, Record<string, number>>; // pilotId -> bucketIdx-> ... no, see below
  // We use number-array of-records for memo-friendliness.
  type Buckets = Record<string, number>[];
  const monthlyAgg = useMemo(() => {
    const m: Record<string, Buckets> = {};
    PILOTS.forEach(p => { m[p.id] = Array.from({ length: 12 }, () => ({})); });
    entries.forEach(e => {
      daysBetween(e.from, e.to).forEach(d => {
        if (d.getFullYear() !== year) return;
        const arr = m[e.pilotId]; if (!arr) return;
        const b = arr[d.getMonth()];
        b[e.typeId] = (b[e.typeId] ?? 0) + 1;
      });
    });
    return m;
  }, [entries, year, PILOTS]);

  const weeklyBuckets = useMemo(() => {
    // Buckets for the selected (year, month): days 1-7, 8-14, 15-21, 22-28, 29-end
    const last = new Date(year, month + 1, 0).getDate();
    const buckets: { label: string; start: number; end: number }[] = [];
    for (let s = 1; s <= last; s += 7) {
      const e = Math.min(s + 6, last);
      buckets.push({ label: `${s}–${e}`, start: s, end: e });
    }
    return buckets;
  }, [year, month]);

  const weeklyAgg = useMemo(() => {
    const m: Record<string, Buckets> = {};
    PILOTS.forEach(p => { m[p.id] = Array.from({ length: weeklyBuckets.length }, () => ({})); });
    entries.forEach(e => {
      daysBetween(e.from, e.to).forEach(d => {
        if (d.getFullYear() !== year || d.getMonth() !== month) return;
        const day = d.getDate();
        const idx = weeklyBuckets.findIndex(b => day >= b.start && day <= b.end);
        if (idx < 0) return;
        const arr = m[e.pilotId]; if (!arr) return;
        const b = arr[idx];
        b[e.typeId] = (b[e.typeId] ?? 0) + 1;
      });
    });
    return m;
  }, [entries, year, month, weeklyBuckets, PILOTS]);

  // Helpers for cell rendering + totals.
  function bucketTotal(b: Record<string, number>): number {
    return Object.values(b).reduce((a, n) => a + n, 0);
  }
  // Squadron-wide totals: per-bucket sum across every pilot, plus a
  // per-type breakdown for the grand-total row. Required by the ops manual
  // ("Totals view: per-pilot AND squadron-wide").
  const squadronBucketTotals = useMemo<number[]>(() => {
    const cols = view === "monthly" ? 12 : weeklyBuckets.length;
    const out = Array(cols).fill(0) as number[];
    const agg = view === "monthly" ? monthlyAgg : weeklyAgg;
    PILOTS.forEach(p => {
      const arr = agg[p.id]; if (!arr) return;
      arr.forEach((b, i) => { out[i] += bucketTotal(b); });
    });
    return out;
  }, [view, monthlyAgg, weeklyAgg, weeklyBuckets, PILOTS]);
  const squadronTypeTotals = useMemo<Record<string, number>>(() => {
    const out: Record<string, number> = {};
    const agg = view === "monthly" ? monthlyAgg : weeklyAgg;
    PILOTS.forEach(p => {
      (agg[p.id] ?? []).forEach(b => {
        Object.entries(b).forEach(([tid, n]) => { out[tid] = (out[tid] ?? 0) + n; });
      });
    });
    return out;
  }, [view, monthlyAgg, weeklyAgg, PILOTS]);

  // Per-pilot palette: dot color per type for the inline entry list.
  const typeById = useMemo(() => Object.fromEntries(types.map(t => [t.id, t])), [types]);

  // Row-level new-entry state
  const [draft, setDraft] = useState<{ pilotId: string; typeId: string; from: string; to: string }>({
    pilotId: PILOTS[0]?.id ?? "",
    typeId: types[0]?.id ?? "",
    from: new Date().toISOString().slice(0, 10),
    to:   new Date().toISOString().slice(0, 10),
  });
  useEffect(() => {
    setDraft(d => ({
      ...d,
      pilotId: d.pilotId || PILOTS[0]?.id || "",
      typeId:  d.typeId  || types[0]?.id  || "",
    }));
  }, [PILOTS, types]);

  function addEntry() {
    if (!draft.pilotId || !draft.typeId) return;
    setEntries(prev => [...prev, { id: crypto.randomUUID(), ...draft }]);
  }
  function removeEntry(id: string) {
    setEntries(prev => prev.filter(e => e.id !== id));
  }

  function addType() {
    const used = new Set(types.map(t => t.color));
    const next = PALETTE.find(c => !used.has(c)) ?? PALETTE[Math.floor(Math.random() * PALETTE.length)];
    setTypes(prev => [...prev, { id: crypto.randomUUID(), name: "New type", color: next }]);
  }
  function updateType(id: string, patch: Partial<LeaveType>) {
    setTypes(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }
  function removeType(id: string) {
    if (!confirm("Delete this leave type? Existing entries that use it will keep showing the raw type id.")) return;
    setTypes(prev => prev.filter(t => t.id !== id));
  }

  return (
    <div>
      <PageHead
        title={t("nav_leaves")}
        subtitle="Monthly / weekly · custom types · auto-populated from roster"
        actions={
          <div className="flex gap-2">
            <div className="inline-flex rounded-md border border-border overflow-hidden">
              <button
                onClick={() => setView("monthly")}
                className={`px-3 py-1.5 text-xs ${view === "monthly" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                data-testid="button-leaves-view-monthly"
              >Monthly</button>
              <button
                onClick={() => setView("weekly")}
                className={`px-3 py-1.5 text-xs ${view === "weekly" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}
                data-testid="button-leaves-view-weekly"
              >Weekly</button>
            </div>
            <Button size="sm" variant="outline" onClick={() => setShowSettings(s => !s)} data-testid="button-leaves-types">
              <Cog className="h-4 w-4 me-1" /> Types
            </Button>
          </div>
        }
      />

      <div className="flex flex-wrap items-center gap-2 mb-3">
        <label className="text-xs"><span className="text-muted-foreground me-1">Year</span>
          <input
            type="number"
            value={year}
            onChange={e => setYear(Number(e.target.value) || today.getFullYear())}
            className="w-24 px-2 py-1 rounded bg-input border border-border text-sm"
            data-testid="input-leaves-year"
          />
        </label>
        {view === "weekly" && (
          <label className="text-xs"><span className="text-muted-foreground me-1">Month</span>
            <select
              value={month}
              onChange={e => setMonth(Number(e.target.value))}
              className="px-2 py-1 rounded bg-input border border-border text-sm"
              data-testid="select-leaves-month"
            >
              {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
            </select>
          </label>
        )}
        <div className="ms-auto flex items-center gap-2 text-xs">
          {types.map(tp => (
            <span key={tp.id} className="inline-flex items-center gap-1">
              <span className="w-3 h-3 rounded-sm border border-border" style={{ background: tp.color }} />
              {tp.name}
            </span>
          ))}
        </div>
      </div>

      {showSettings && (
        <Card className="mb-3">
          <div className="text-sm font-semibold mb-2">Custom Leave Types</div>
          <div className="space-y-2">
            {types.map(tp => (
              <div key={tp.id} className="flex items-center gap-2">
                <input
                  type="color"
                  value={tp.color}
                  onChange={e => updateType(tp.id, { color: e.target.value })}
                  className="w-9 h-9 rounded border border-border bg-transparent"
                  data-testid={`input-type-color-${tp.id}`}
                />
                <input
                  value={tp.name}
                  onChange={e => updateType(tp.id, { name: e.target.value })}
                  className="flex-1 px-2 py-1.5 rounded bg-input border border-border text-sm"
                  data-testid={`input-type-name-${tp.id}`}
                />
                <button
                  onClick={() => removeType(tp.id)}
                  className="p-1.5 rounded hover:bg-destructive/20 text-destructive"
                  title="Delete type"
                  data-testid={`button-delete-type-${tp.id}`}
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            <Button size="sm" variant="outline" onClick={addType} data-testid="button-add-type">
              <Plus className="h-4 w-4 me-1" /> Add type
            </Button>
          </div>
        </Card>
      )}

      <Card className="mb-3">
        <div className="text-sm font-semibold mb-2">Add Leave</div>
        <div className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end">
          <label className="text-xs"><span className="text-muted-foreground">Pilot</span>
            <select
              value={draft.pilotId}
              onChange={e => setDraft(d => ({ ...d, pilotId: e.target.value }))}
              className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm"
              data-testid="select-leave-pilot"
            >
              {PILOTS.map(p => <option key={p.id} value={p.id}>{p.rank} {p.name}</option>)}
            </select>
          </label>
          <label className="text-xs"><span className="text-muted-foreground">Type</span>
            <select
              value={draft.typeId}
              onChange={e => setDraft(d => ({ ...d, typeId: e.target.value }))}
              className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm"
              data-testid="select-leave-type"
            >
              {types.map(tp => <option key={tp.id} value={tp.id}>{tp.name}</option>)}
            </select>
          </label>
          <label className="text-xs"><span className="text-muted-foreground">From</span>
            <input
              type="date"
              value={draft.from}
              onChange={e => setDraft(d => ({ ...d, from: e.target.value }))}
              className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm font-mono"
              data-testid="input-leave-from"
            />
          </label>
          <label className="text-xs"><span className="text-muted-foreground">To</span>
            <input
              type="date"
              value={draft.to}
              onChange={e => setDraft(d => ({ ...d, to: e.target.value }))}
              className="w-full mt-1 px-2 py-1.5 rounded bg-input border border-border text-sm font-mono"
              data-testid="input-leave-to"
            />
          </label>
          <Button onClick={addEntry} data-testid="button-add-leave">
            <Save className="h-4 w-4 me-1" /> Add
          </Button>
        </div>
      </Card>

      <Card className="!p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 uppercase tracking-wider text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Pilot</th>
              {view === "monthly"
                ? MONTHS.map(m => <th key={m} className="px-2 py-2 text-right">{m}</th>)
                : weeklyBuckets.map(b => <th key={b.label} className="px-2 py-2 text-right">{b.label}</th>)
              }
              <th className="px-2 py-2 text-right">Total</th>
              <th className="px-2 py-2 text-left">Entries</th>
            </tr>
          </thead>
          <tbody>
            {PILOTS.length === 0 && (
              <tr>
                <td colSpan={view === "monthly" ? MONTHS.length + 3 : weeklyBuckets.length + 3} className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="empty-leaves">
                  {pilotsQ.isError ? "—" : t("no_records")}
                </td>
              </tr>
            )}
            {PILOTS.map(p => {
              const arr = view === "monthly" ? monthlyAgg[p.id] : weeklyAgg[p.id];
              const total = (arr ?? []).reduce((a, b) => a + bucketTotal(b), 0);
              const pilotEntries = entries.filter(e => e.pilotId === p.id);
              return (
                <tr key={p.id} className="border-t border-border row-hover align-top">
                  <td className="px-3 py-2">{p.name}</td>
                  {(arr ?? []).map((bucket, i) => {
                    const codes = Object.entries(bucket);
                    if (codes.length === 0) {
                      return <td key={i} className="px-2 py-2 text-right font-mono text-muted-foreground/60">·</td>;
                    }
                    return (
                      <td key={i} className="px-1 py-1 align-middle">
                        <div className="flex flex-wrap gap-0.5 justify-end">
                          {codes.map(([tid, n]) => {
                            const tp = typeById[tid];
                            const c = tp?.color ?? "#888";
                            return (
                              <span
                                key={tid}
                                className="inline-flex items-center gap-0.5 text-[10px] font-mono rounded px-1 border"
                                style={{ borderColor: c, background: `${c}33`, color: "inherit" }}
                                title={`${tp?.name ?? tid}: ${n}`}
                                data-testid={`cell-leave-${p.id}-${i}-${tid}`}
                              >
                                <span className="font-semibold">{tp ? codeFor(tp) : tid.slice(0, 2).toUpperCase()}</span>
                                <span>{n}</span>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                    );
                  })}
                  <td className="px-2 py-2 text-right font-mono font-semibold gold-text">{total}</td>
                  <td className="px-2 py-2">
                    <div className="flex flex-wrap gap-1">
                      {pilotEntries.map(e => {
                        const tp = typeById[e.typeId];
                        const c = tp?.color ?? "#888";
                        return (
                          <span
                            key={e.id}
                            className="inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border"
                            style={{ borderColor: c, background: `${c}22`, color: "inherit" }}
                            title={`${tp?.name ?? e.typeId} · ${e.from} → ${e.to}`}
                            data-testid={`chip-leave-${e.id}`}
                          >
                            <span className="w-2 h-2 rounded-sm" style={{ background: c }} />
                            {e.from.slice(5)}–{e.to.slice(5)}
                            <button
                              onClick={() => removeEntry(e.id)}
                              className="opacity-60 hover:opacity-100"
                              data-testid={`button-remove-leave-${e.id}`}
                            ><Trash2 className="h-3 w-3" /></button>
                          </span>
                        );
                      })}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {/* Squadron-wide totals: per-column sum across every pilot plus
              the grand total. Per-type breakdown is shown beneath the
              grand total so commanders can see at a glance how many days
              the squadron lost to each leave type this period. */}
          {PILOTS.length > 0 && (
            <tfoot className="bg-secondary/30 border-t-2 border-border" data-testid="row-leaves-squadron-totals">
              <tr className="font-semibold">
                <td className="px-3 py-2 text-xs uppercase tracking-wider gold-text">Squadron total</td>
                {squadronBucketTotals.map((v, i) => (
                  <td key={i} className="px-2 py-2 text-right font-mono">{v || "·"}</td>
                ))}
                <td className="px-2 py-2 text-right font-mono font-bold gold-text" data-testid="text-squadron-grand-total">
                  {squadronBucketTotals.reduce((a, b) => a + b, 0)}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(squadronTypeTotals).map(([tid, n]) => {
                      const tp = typeById[tid];
                      const c = tp?.color ?? "#888";
                      return (
                        <span
                          key={tid}
                          className="inline-flex items-center gap-1 text-[11px] rounded px-1.5 py-0.5 border"
                          style={{ borderColor: c, background: `${c}22`, color: "inherit" }}
                          data-testid={`chip-squadron-${tid}`}
                        >
                          <span className="font-semibold">{tp ? codeFor(tp) : tid.slice(0, 2).toUpperCase()}</span>
                          {n}
                        </span>
                      );
                    })}
                  </div>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </Card>
    </div>
  );
}
