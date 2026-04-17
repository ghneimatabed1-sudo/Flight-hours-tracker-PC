import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots } from "@/lib/squadron-data";
import { Trophy } from "lucide-react";

const SORTS = [
  { k: "totalNvg", label: "NVG Total" },
  { k: "monthDay", label: "Monthly Day Hours" },
  { k: "monthNight", label: "Monthly Night Hours" },
  { k: "totalDay", label: "Grand Total" },
  { k: "totalCaptain", label: "Captain Hours" },
] as const;

export default function Rankings() {
  const { t } = useI18n();
  type SortKey = typeof SORTS[number]["k"];
  const [sortKey, setSortKey] = useState<SortKey>("totalNvg");
  const { data: PILOTS } = usePilots();
  const sorted = [...PILOTS].sort((a, b) => (b[sortKey] as number) - (a[sortKey] as number));
  return (
    <div>
      <PageHead title={t("nav_rankings")} actions={
        <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="px-3 py-1.5 rounded-md bg-input border border-border text-sm">
          {SORTS.map(s => <option key={s.k} value={s.k}>{s.label}</option>)}
        </select>
      } />
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">#</th>
              <th className="px-3 py-2 text-left">Pilot</th>
              <th className="px-3 py-2 text-right">Mo Day</th>
              <th className="px-3 py-2 text-right">Mo Night</th>
              <th className="px-3 py-2 text-right text-rose-300">Mo NVG</th>
              <th className="px-3 py-2 text-right">Total Day</th>
              <th className="px-3 py-2 text-right">Total Night</th>
              <th className="px-3 py-2 text-right text-rose-300">Total NVG</th>
              <th className="px-3 py-2 text-right">Captain</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id} className="border-t border-border row-hover">
                <td className="px-3 py-2 font-mono">{i + 1}{i === 0 && <Trophy className="inline h-3.5 w-3.5 ml-1 text-amber-400" />}</td>
                <td className="px-3 py-2">{p.rank} {p.name}</td>
                <td className="px-3 py-2 text-right font-mono">{p.monthDay}</td>
                <td className="px-3 py-2 text-right font-mono">{p.monthNight}</td>
                <td className="px-3 py-2 text-right font-mono text-rose-300">{p.monthNvg}</td>
                <td className="px-3 py-2 text-right font-mono">{p.totalDay}</td>
                <td className="px-3 py-2 text-right font-mono">{p.totalNight}</td>
                <td className="px-3 py-2 text-right font-mono text-rose-300">{p.totalNvg}</td>
                <td className="px-3 py-2 text-right font-mono">{p.totalCaptain}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
