import { useMemo, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS, SORTIES } from "@/lib/mock";
import { Search, Filter } from "lucide-react";

export default function SortieLog() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const [type, setType] = useState("All");

  const pilotMap = useMemo(() => Object.fromEntries(PILOTS.map(p => [p.id, p.name])), []);
  const types = useMemo(() => ["All", ...Array.from(new Set(SORTIES.map(s => s.sortieType)))], []);

  const rows = SORTIES
    .filter(s => type === "All" || s.sortieType === type)
    .filter(s => !q || (pilotMap[s.pilotId] + " " + pilotMap[s.coPilotId] + " " + s.acNumber + " " + s.name).toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date));

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
              </tr>
            </thead>
            <tbody>
              {rows.map(s => (
                <tr key={s.id} className="border-t border-border row-hover">
                  <Td mono>{s.date}</Td>
                  <Td>{s.acType}</Td>
                  <Td mono>{s.acNumber}</Td>
                  <Td>{pilotMap[s.pilotId]}</Td>
                  <Td>{pilotMap[s.coPilotId]}</Td>
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
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Th({ children, right, cls = "" }: { children: React.ReactNode; right?: boolean; cls?: string }) {
  return <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} font-medium ${cls}`}>{children}</th>;
}
function Td({ children, mono, right, cls = "" }: { children: React.ReactNode; mono?: boolean; right?: boolean; cls?: string }) {
  return <td className={`px-3 py-2 ${mono ? "font-mono" : ""} ${right ? "text-right" : ""} ${cls}`}>{children}</td>;
}
