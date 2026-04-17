import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS, SIX_MONTH_TASKS } from "@/lib/mock";

function rng(seed: number) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

export default function Cycle() {
  const { t } = useI18n();
  const r = rng(7);
  return (
    <div>
      <PageHead title={t("nav_cycle")} subtitle="Training task tracker — 6-month cycle" />
      <Card className="!p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-secondary/50 uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left sticky left-0 bg-secondary/80">Pilot</th>
              {SIX_MONTH_TASKS.map(t => <th key={t} className="px-2 py-2">{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {PILOTS.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2 sticky left-0 bg-card">{p.rank} {p.name}</td>
                {SIX_MONTH_TASKS.map(task => {
                  const v = r();
                  const done = v > 0.4;
                  const partial = !done && v > 0.2;
                  return (
                    <td key={task} className="px-2 py-2 text-center">
                      <span className={`status-dot ${done ? "status-ok" : partial ? "status-warn" : "status-bad"}`}></span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
