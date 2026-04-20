import { useEffect, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";
import { Eye, EyeOff } from "lucide-react";

const TABS = ["day", "night", "irt", "medical", "sim"] as const;

const HIDE_KEY = "rjaf.currency.hiddenPilots";
function loadHidden(): Set<string> {
  try {
    const raw = localStorage.getItem(HIDE_KEY);
    if (!raw) return new Set();
    const arr = JSON.parse(raw) as unknown;
    return new Set(Array.isArray(arr) ? (arr as string[]) : []);
  } catch { return new Set(); }
}
function saveHidden(s: Set<string>) {
  localStorage.setItem(HIDE_KEY, JSON.stringify(Array.from(s)));
}

function statusOf(d: string) {
  if (!d) return { cls: "status-warn", lbl: "—", days: 0 };
  // Compare LOCAL midnight to LOCAL midnight so a date entered as
  // "today" is never accidentally counted as "yesterday" because of a
  // timezone offset (e.g. Jordan UTC+3 vs the JS Date UTC parser).
  const parts = d.split("-").map(Number);
  if (parts.length !== 3 || parts.some(isNaN)) return { cls: "status-warn", lbl: "—", days: 0 };
  const expiry = new Date(parts[0], parts[1] - 1, parts[2]).getTime();
  const now = new Date(); const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.round((expiry - today) / 86400000);
  if (days < 0)  return { cls: "status-bad",  lbl: `EXPIRED ${-days}d ago`, days };
  if (days === 0) return { cls: "status-warn", lbl: "Expires today", days };
  if (days < 30) return { cls: "status-warn", lbl: `${days}d left`, days };
  return { cls: "status-ok", lbl: `${days}d left`, days };
}

export default function Currency() {
  const { t } = useI18n();
  const [tab, setTab] = useState<typeof TABS[number]>("day");
  const pilotsQ = usePilots();
  const { data: PILOTS } = pilotsQ;
  const [hiddenPilots, setHiddenPilots] = useState<Set<string>>(() => loadHidden());
  const [showHidden, setShowHidden] = useState(false);

  useEffect(() => { saveHidden(hiddenPilots); }, [hiddenPilots]);

  const togglePilot = (id: string) => {
    setHiddenPilots(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Action list only — surfaces pilots whose currency for the selected tab
  // is already EXPIRED (days < 0) or about to expire within the next 10 days
  // (0 ≤ days < 10). Pilots flagged "not applicable" for this currency
  // (`hiddenCurrencies`) are excluded entirely because they have nothing to
  // renew. Per-PC manually hidden pilots are excluded unless "Show hidden"
  // is toggled. Earliest expiry first (most negative = most overdue first).
  const rows = PILOTS
    .filter(p => showHidden || !hiddenPilots.has(p.id))
    .map(p => ({ p, hidden: p.hiddenCurrencies?.includes(tab) ?? false, pilotHidden: hiddenPilots.has(p.id), s: statusOf(p.expiry[tab]) }))
    .filter(({ hidden, p, s }) => !hidden && p.expiry[tab] && s.days < 10)
    .sort((a, b) => a.s.days - b.s.days);

  return (
    <div>
      <PageHead title={t("nav_currency")} subtitle="Pilots whose selected currency is EXPIRED or expires within 10 days. Date shown is when the currency expires. Earliest first." actions={
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowHidden(v => !v)}
            className={`px-3 py-1.5 rounded-md text-xs flex items-center gap-1 ${showHidden ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"}`}
            data-testid="button-show-hidden"
          >
            {showHidden ? <EyeOff className="h-3 w-3" /> : <Eye className="h-3 w-3" />}
            {showHidden ? "Showing hidden" : `Hidden (${hiddenPilots.size})`}
          </button>
        </div>
      } />
      <DataUnavailableBanner queries={[pilotsQ]} testId="banner-currency-unavailable" />
      <div className="flex gap-1 mb-3">
        {TABS.map(k => (
          <button key={k} onClick={() => setTab(k)} className={`px-4 py-2 rounded-md text-sm ${tab === k ? "bg-card border border-border text-foreground" : "text-muted-foreground hover:text-foreground"}`}>
            {k.toUpperCase()}
          </button>
        ))}
      </div>
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">{t("name")}</th>
              <th className="px-3 py-2 text-left">Unit</th>
              <th className="px-3 py-2 text-left">{t("expiry")}</th>
              <th className="px-3 py-2 text-left">{t("status")}</th>
              <th className="px-3 py-2 text-right w-10"></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-xs text-muted-foreground" data-testid="empty-currency">
                  {pilotsQ.isError ? "—" : t("no_records")}
                </td>
              </tr>
            )}
            {rows.map(({ p, s, hidden, pilotHidden }) => (
              <tr key={p.id} className={`border-t border-border row-hover ${hidden || pilotHidden ? "opacity-50" : ""}`}>
                <td className="px-3 py-2">{p.rank} {p.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.unit}</td>
                <td className="px-3 py-2 font-mono">{hidden ? "—" : p.expiry[tab]}</td>
                <td className="px-3 py-2">
                  {hidden
                    ? <span className="inline-flex items-center rounded px-2 py-0.5 text-xs bg-secondary text-muted-foreground border border-border">{t("notApplicable")}</span>
                    : <><span className={`status-dot ${s.cls} mr-2`}></span><span className={s.cls === "status-bad" ? "text-rose-300" : s.cls === "status-warn" ? "text-amber-300" : "text-emerald-300"}>{s.lbl}</span></>
                  }
                </td>
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
      </Card>
    </div>
  );
}
