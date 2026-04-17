import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS } from "@/lib/mock";

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

function rng(seed: number) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

export default function Leaves() {
  const { t } = useI18n();
  const r = rng(13);
  const data = PILOTS.map(p => {
    const months = MONTHS.map(() => Math.floor(r() * 8));
    const total = months.reduce((a, b) => a + b, 0);
    return { p, months, total };
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
