import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useDutyWeek } from "@/lib/squadron-data";

export default function DutyWeek() {
  const { t } = useI18n();
  const { data: DUTY_WEEK } = useDutyWeek();
  return (
    <div>
      <PageHead title={t("nav_duty")} subtitle="Main Duty · Standby · RCM per day" />
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2 text-left">Day</th>
              <th className="px-3 py-2 text-left">Main Duty</th>
              <th className="px-3 py-2 text-left">Standby</th>
              <th className="px-3 py-2 text-left">RCM</th>
            </tr>
          </thead>
          <tbody>
            {DUTY_WEEK.map(d => (
              <tr key={d.day} className="border-t border-border row-hover">
                <td className="px-3 py-2 font-semibold">{d.day}</td>
                <td className="px-3 py-2">{d.mainDuty}</td>
                <td className="px-3 py-2">{d.standby}</td>
                <td className="px-3 py-2">{d.rcm}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
