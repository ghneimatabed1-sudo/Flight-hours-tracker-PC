import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { SIX_MONTH_TASKS } from "@/lib/mock";
import { usePilots, useCurrencies } from "@/lib/squadron-data";
import { supabaseConfigured } from "@/lib/supabase";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";

function rng(seed: number) { let s = seed; return () => (s = (s * 9301 + 49297) % 233280) / 233280; }

export default function Cycle() {
  const { t } = useI18n();
  const pilotsQ = usePilots();
  const currQ = useCurrencies();
  const { data: PILOTS } = pilotsQ;
  const { data: CURR } = currQ;
  const lookup = new Map(CURR.map(c => [`${c.pilotId}|${c.task}`, c.status]));
  // In live mode, missing rows mean the pilot has not yet completed the task —
  // never invent a status. The pseudo-random demo statuses are only used when
  // Supabase is not configured so the offline preview looks populated.
  const demo = rng(7);
  const statusOf = (pid: string, task: string): "done" | "partial" | "missing" => {
    const live = lookup.get(`${pid}|${task}`);
    if (live) return live;
    if (supabaseConfigured) return "missing";
    const v = demo();
    return v > 0.4 ? "done" : v > 0.2 ? "partial" : "missing";
  };
  return (
    <div>
      <PageHead title={t("nav_cycle")} subtitle="Training task tracker — 6-month cycle" />
      <DataUnavailableBanner queries={[pilotsQ, currQ]} testId="banner-cycle-unavailable" />
      <Card className="!p-0 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-secondary/50 uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left sticky left-0 bg-secondary/80">Pilot</th>
              {SIX_MONTH_TASKS.map(t => <th key={t} className="px-2 py-2">{t}</th>)}
            </tr>
          </thead>
          <tbody>
            {PILOTS.length === 0 && (
              <tr>
                <td colSpan={SIX_MONTH_TASKS.length + 1} className="px-3 py-6 text-center text-muted-foreground" data-testid="empty-cycle">
                  {pilotsQ.isError || currQ.isError ? "—" : t("no_records")}
                </td>
              </tr>
            )}
            {PILOTS.map(p => (
              <tr key={p.id} className="border-t border-border">
                <td className="px-3 py-2 sticky left-0 bg-card">{p.rank} {p.name}</td>
                {SIX_MONTH_TASKS.map(task => {
                  const s = statusOf(p.id, task);
                  return (
                    <td key={task} className="px-2 py-2 text-center">
                      <span className={`status-dot ${s === "done" ? "status-ok" : s === "partial" ? "status-warn" : "status-bad"}`}></span>
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
