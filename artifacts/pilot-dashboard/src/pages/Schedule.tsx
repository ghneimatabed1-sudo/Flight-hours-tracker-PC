import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS } from "@/lib/mock";

const MISSIONS = [
  { ac: "UH-60M #832", config: "External cargo", crew: [PILOTS[0], PILOTS[3]], mission: "NAV / EMER", takeoff: "0700", land: "1030", fuel: "2200 lbs" },
  { ac: "UH-60M #841", config: "MEDEVAC", crew: [PILOTS[1], PILOTS[4]], mission: "MSN DAY", takeoff: "0900", land: "1130", fuel: "1800 lbs" },
  { ac: "UH-60AIL #756", config: "Standard", crew: [PILOTS[2], PILOTS[5]], mission: "IF / MTF", takeoff: "1300", land: "1545", fuel: "2000 lbs" },
  { ac: "UH-60M #819", config: "NVG ready", crew: [PILOTS[6], PILOTS[7]], mission: "MSN NVG", takeoff: "1900", land: "2230", fuel: "2400 lbs" },
];

export default function Schedule() {
  const { t } = useI18n();
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
            {MISSIONS.map((m, i) => (
              <tr key={i} className="border-t border-border row-hover">
                <td className="px-3 py-2 font-mono">{m.ac}</td>
                <td className="px-3 py-2">{m.config}</td>
                <td className="px-3 py-2">{m.crew.map(c => `${c.rank} ${c.name}`).join(" / ")}</td>
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
