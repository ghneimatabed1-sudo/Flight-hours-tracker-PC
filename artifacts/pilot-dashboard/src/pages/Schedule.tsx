import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useSchedule } from "@/lib/squadron-data";

export default function Schedule() {
  const { t } = useI18n();
  const { data: MISSIONS } = useSchedule();
  return (
    <div>
      <PageHead title={t("nav_schedule")} subtitle="Daily flight schedule · RJAF format" />
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">A/C</th>
              <th className="px-3 py-2 text-left">Config</th>
              <th className="px-3 py-2 text-left">Crew</th>
              <th className="px-3 py-2 text-left">Mission</th>
              <th className="px-3 py-2 text-right">Takeoff</th>
              <th className="px-3 py-2 text-right">Land</th>
              <th className="px-3 py-2 text-right">Fuel</th>
            </tr>
          </thead>
          <tbody>
            {MISSIONS.map((m) => (
              <tr key={m.id} className="border-t border-border row-hover">
                <td className="px-3 py-2 font-mono">{m.ac}</td>
                <td className="px-3 py-2">{m.config}</td>
                <td className="px-3 py-2">{m.crew.join(" / ")}</td>
                <td className="px-3 py-2">{m.mission}</td>
                <td className="px-3 py-2 text-right font-mono">{m.takeoff}</td>
                <td className="px-3 py-2 text-right font-mono">{m.land}</td>
                <td className="px-3 py-2 text-right font-mono">{m.fuel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
