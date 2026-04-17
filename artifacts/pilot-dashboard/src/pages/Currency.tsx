import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS } from "@/lib/mock";

const TABS = ["day", "night", "irt", "medical", "sim"] as const;

function statusOf(d: string) {
  const days = Math.floor((+new Date(d) - Date.now()) / 86400000);
  if (days < 0) return { cls: "status-bad", lbl: `EXPIRED ${-days}d`, days };
  if (days < 30) return { cls: "status-warn", lbl: `${days}d`, days };
  return { cls: "status-ok", lbl: `${days}d`, days };
}

export default function Currency() {
  const { t } = useI18n();
  const [tab, setTab] = useState<typeof TABS[number]>("day");
  const [unit, setUnit] = useState<"All" | "SQDN" | "Attached">("All");

  const rows = PILOTS
    .filter(p => unit === "All" || (unit === "SQDN" ? p.unit === "SQDN" : p.unit !== "SQDN"))
    .map(p => ({ p, s: statusOf(p.expiry[tab]) }))
    .sort((a, b) => a.s.days - b.s.days);

  return (
    <div>
      <PageHead title={t("nav_currency")} subtitle="Sorted by expiry · color-coded" actions={
        <div className="flex items-center gap-2">
          {(["All", "SQDN", "Attached"] as const).map(u => (
            <button key={u} onClick={() => setUnit(u)} className={`px-3 py-1.5 rounded-md text-xs ${unit === u ? "bg-primary text-primary-foreground" : "bg-secondary border border-border"}`}>{u}</button>
          ))}
        </div>
      } />
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
            </tr>
          </thead>
          <tbody>
            {rows.map(({ p, s }) => (
              <tr key={p.id} className="border-t border-border row-hover">
                <td className="px-3 py-2">{p.rank} {p.name}</td>
                <td className="px-3 py-2 text-muted-foreground">{p.unit}</td>
                <td className="px-3 py-2 font-mono">{p.expiry[tab]}</td>
                <td className="px-3 py-2"><span className={`status-dot ${s.cls} mr-2`}></span><span className={s.cls === "status-bad" ? "text-rose-300" : s.cls === "status-warn" ? "text-amber-300" : "text-emerald-300"}>{s.lbl}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
