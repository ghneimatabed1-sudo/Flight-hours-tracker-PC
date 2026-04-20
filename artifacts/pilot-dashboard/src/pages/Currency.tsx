import { useEffect, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";
import { Eye, EyeOff } from "lucide-react";
import type { CurrencyKey } from "@/lib/mock";

// Single matrix view for the squadron ops officer. Shows every active
// pilot in one row with all six currencies (Day, Night, NVG, IRT, Medical,
// Simulator) as columns. Each cell is the EXPIRY date — color-coded by how
// soon it expires. Single source of truth: `pilots.expiry` on the live
// pilots table; the same field that the mobile app reads and that the
// pilot edit dialog writes. No separate currency table exists.
const COLS: { k: CurrencyKey; label: string }[] = [
  { k: "day",     label: "Day"       },
  { k: "night",   label: "Night"     },
  { k: "nvg",     label: "NVG"       },
  { k: "irt",     label: "IRT"       },
  { k: "medical", label: "Medical"   },
  { k: "sim",     label: "Simulator" },
];

// Per-PC manual hide of pilots (e.g. transferred or on long leave). Kept
// local so each station can groom its own roll-up without affecting the
// shared squadron data.
const HIDE_PILOTS_KEY = "rjaf.currency.hiddenPilots";
function loadHiddenPilots(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDE_PILOTS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch { return new Set(); }
}
function saveHiddenPilots(s: Set<string>) {
  localStorage.setItem(HIDE_PILOTS_KEY, JSON.stringify(Array.from(s)));
}

// Per-PC hide of an entire currency column (e.g. a unit that has no
// simulator program will hide the Sim column on its station). Local-only.
const HIDE_COLS_KEY = "rjaf.currency.hiddenCols";
function loadHiddenCols(): Set<CurrencyKey> {
  try {
    const raw = localStorage.getItem(HIDE_COLS_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as CurrencyKey[]) : []);
  } catch { return new Set(); }
}
function saveHiddenCols(s: Set<CurrencyKey>) {
  localStorage.setItem(HIDE_COLS_KEY, JSON.stringify(Array.from(s)));
}

function statusOf(d: string) {
  if (!d) return { cls: "status-warn", lbl: "—", days: 0, empty: true };
  // Compare LOCAL midnight to LOCAL midnight so a date entered as "today"
  // is never accidentally counted as "yesterday" because of a timezone
  // offset (e.g. Jordan UTC+3 vs the JS Date UTC parser).
  const parts = d.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return { cls: "status-warn", lbl: "—", days: 0, empty: true };
  const expiry = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((expiry - today) / 86400000);
  if (days < 0)   return { cls: "status-bad",  lbl: `EXPIRED ${-days}d`, days, empty: false };
  if (days === 0) return { cls: "status-warn", lbl: "Expires today",     days, empty: false };
  if (days < 30)  return { cls: "status-warn", lbl: `${days}d left`,     days, empty: false };
  return                  { cls: "status-ok",  lbl: `${days}d left`,     days, empty: false };
}

function cellTextClass(s: ReturnType<typeof statusOf>) {
  if (s.empty) return "text-muted-foreground";
  if (s.cls === "status-bad")  return "text-rose-300";
  if (s.cls === "status-warn") return "text-amber-300";
  return "text-emerald-300";
}

export default function Currency() {
  const { t } = useI18n();
  const pilotsQ = usePilots();
  const { data: PILOTS } = pilotsQ;

  const [hiddenPilots, setHiddenPilots] = useState<Set<string>>(() => loadHiddenPilots());
  const [hiddenCols, setHiddenCols]     = useState<Set<CurrencyKey>>(() => loadHiddenCols());
  const [showHiddenPilots, setShowHiddenPilots] = useState(false);

  useEffect(() => { saveHiddenPilots(hiddenPilots); }, [hiddenPilots]);
  useEffect(() => { saveHiddenCols(hiddenCols);     }, [hiddenCols]);

  const togglePilot = (id: string) => {
    setHiddenPilots(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const toggleCol = (k: CurrencyKey) => {
    setHiddenCols(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  const visibleCols = COLS.filter(c => !hiddenCols.has(c.k));

  // Per-pilot row: how soon does THIS pilot's worst (visible) currency
  // expire? Drives row sort so the most-overdue pilot floats to the top.
  const rows = PILOTS
    .filter(p => showHiddenPilots || !hiddenPilots.has(p.id))
    .map(p => {
      const cells = visibleCols.map(c => {
        const naForPilot = p.hiddenCurrencies?.includes(c.k) ?? false;
        return { col: c, na: naForPilot, s: statusOf(p.expiry?.[c.k] ?? ""), date: p.expiry?.[c.k] ?? "" };
      });
      // Worst = smallest days value among non-NA, non-empty cells.
      const live = cells.filter(c => !c.na && !c.s.empty);
      const worstDays = live.length ? Math.min(...live.map(c => c.s.days)) : Number.POSITIVE_INFINITY;
      return { p, cells, worstDays, pilotHidden: hiddenPilots.has(p.id) };
    })
    .sort((a, b) => Number(a.pilotHidden) - Number(b.pilotHidden) || a.worstDays - b.worstDays);

  return (
    <div>
      <PageHead
        title={t("nav_currency")}
        subtitle="Each cell is when the currency EXPIRES. Color-coded · earliest expiry first. Hide columns or pilots that don't apply on this PC."
        actions={
          <button
            onClick={() => setShowHiddenPilots(v => !v)}
            className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-1 ${showHiddenPilots ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"}`}
            data-testid="button-show-hidden"
          >
            {showHiddenPilots ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showHiddenPilots ? "Showing hidden" : `Hidden (${hiddenPilots.size})`}
          </button>
        }
      />

      <DataUnavailableBanner queries={[pilotsQ]} testId="banner-currency-unavailable" />

      {/* Per-PC column visibility chips. Click to hide / show a currency
          column on this station only. State stays in localStorage. */}
      <div className="flex flex-wrap items-center gap-1.5 mb-3 text-xs">
        <span className="text-muted-foreground mr-1">Columns:</span>
        {COLS.map(c => {
          const on = !hiddenCols.has(c.k);
          return (
            <button
              key={c.k}
              onClick={() => toggleCol(c.k)}
              data-testid={`toggle-col-${c.k}`}
              className={`px-2.5 py-1 rounded-full border ${on
                ? "bg-primary/15 border-primary/40 text-foreground"
                : "bg-secondary/50 border-border text-muted-foreground line-through"}`}
            >
              {c.label}
            </button>
          );
        })}
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">{t("name")}</th>
                {visibleCols.map(c => (
                  <th key={c.k} className="px-3 py-2 text-left whitespace-nowrap">{c.label}</th>
                ))}
                <th className="px-3 py-2 text-right w-10"></th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={visibleCols.length + 2} className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="empty-currency">
                    {pilotsQ.isError ? "—" : t("no_records")}
                  </td>
                </tr>
              )}
              {rows.map(({ p, cells, pilotHidden }) => (
                <tr key={p.id} className={`border-t border-border row-hover ${pilotHidden ? "opacity-50" : ""}`}>
                  <td className="px-3 py-2 whitespace-nowrap">{p.rank} {p.name}</td>
                  {cells.map(({ col, na, s, date }) => (
                    <td key={col.k} className="px-3 py-2 whitespace-nowrap" data-testid={`cell-${p.id}-${col.k}`}>
                      {na ? (
                        <span className="inline-flex items-center rounded px-2 py-0.5 text-[11px] bg-secondary text-muted-foreground border border-border">
                          {t("notApplicable")}
                        </span>
                      ) : (
                        <div className="flex flex-col leading-tight">
                          <span className="font-mono text-xs">{date || "—"}</span>
                          <span className={`text-[10px] ${cellTextClass(s)}`}>{s.lbl}</span>
                        </div>
                      )}
                    </td>
                  ))}
                  <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => togglePilot(p.id)}
                      className="p-1 rounded hover:bg-secondary text-muted-foreground"
                      title={pilotHidden ? "Show on this PC" : "Hide from this PC"}
                      data-testid={`button-hide-pilot-${p.id}`}
                    >
                      {pilotHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
