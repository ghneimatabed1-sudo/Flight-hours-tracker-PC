import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots, useLeaves } from "@/lib/squadron-data";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

export default function Leaves() {
  const { t } = useI18n();
  const { data: PILOTS } = usePilots();
  const { data: LEAVES } = useLeaves();
  const byId = new Map(LEAVES.map(l => [l.pilotId, l]));
  const data = PILOTS.map(p => {
    const lr = byId.get(p.id) ?? { months: Array(12).fill(0), total: 0 };
    return { p, months: lr.months, total: lr.total };
  });
  return (
    <div>
      <PageHead title={t("nav_leaves")} subtitle="Monthly leave days · yearly totals" />
      <Card className="!p-0 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 uppercase tracking-wider text-xs text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Pilot</th>
              {MONTHS.map(m => <th key={m} className="px-2 py-2 text-right">{m}</th>)}
              <th className="px-2 py-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {data.map(({ p, months, total }) => (
              <tr key={p.id} className="border-t border-border row-hover">
                <td className="px-3 py-2">{p.name}</td>
                {months.map((v, i) => <td key={i} className="px-2 py-2 text-right font-mono">{v || "·"}</td>)}
                <td className="px-2 py-2 text-right font-mono font-semibold gold-text">{total}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
