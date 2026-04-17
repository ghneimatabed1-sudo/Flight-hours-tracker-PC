import { useRoute, Link } from "wouter";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { usePilots, useSorties } from "@/lib/squadron-data";
import { ArrowLeft } from "lucide-react";

const cats = [
  { k: "day", label: "Day" }, { k: "night", label: "Night" },
  { k: "irt", label: "IRT" }, { k: "medical", label: "Medical" }, { k: "sim", label: "Sim" },
] as const;

function statusInfo(dateStr: string) {
  const days = Math.floor((+new Date(dateStr) - Date.now()) / 86400000);
  if (days < 0) return { cls: "status-bad", label: `EXPIRED ${-days}d` };
  if (days < 30) return { cls: "status-warn", label: `${days}d` };
  return { cls: "status-ok", label: `${days}d` };
}

export default function PilotDetail() {
  const { t } = useI18n();
  const [, params] = useRoute<{ id: string }>("/pilot/:id");
  const { data: PILOTS } = usePilots();
  const { data: SORTIES } = useSorties();
  const p = PILOTS.find(x => x.id === params?.id);
  if (!p) return <div className="p-6">Pilot not found.</div>;
  const sorties = SORTIES.filter(s => s.pilotId === p.id || s.coPilotId === p.id).sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div>
      <PageHead title={`${p.rank} ${p.name}`} subtitle={`${p.arabicName} · ${p.id} · ${p.unit}`} actions={
        <Link href="/roster" className="text-xs px-3 py-1.5 rounded-md border border-border hover:bg-secondary inline-flex items-center gap-1"><ArrowLeft className="h-3.5 w-3.5" />Back</Link>
      } />

      <div className="grid lg:grid-cols-3 gap-4 mb-4">
        <Card>
          <div className="text-sm font-semibold mb-2">This Month</div>
          <Stat k="Day" v={p.monthDay} /><Stat k="Night" v={p.monthNight} /><Stat k="NVG" v={p.monthNvg} accent="text-rose-300" /><Stat k="Sim" v={p.monthSim} /><Stat k="Captain" v={p.monthCaptain} />
        </Card>
        <Card>
          <div className="text-sm font-semibold mb-2">Grand Totals</div>
          <Stat k="Day" v={p.totalDay} /><Stat k="Night" v={p.totalNight} /><Stat k="NVG" v={p.totalNvg} accent="text-rose-300" /><Stat k="Sim" v={p.totalSim} /><Stat k="Captain" v={p.totalCaptain} />
        </Card>
        <Card>
          <div className="text-sm font-semibold mb-2">Currencies</div>
          {cats.map(c => {
            const s = statusInfo(p.expiry[c.k]);
            return (
              <div key={c.k} className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0 text-sm">
                <span>{c.label}</span>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs text-muted-foreground">{p.expiry[c.k]}</span>
                  <span className={`status-dot ${s.cls}`}></span>
                  <span className="text-xs w-20 text-right">{s.label}</span>
                </div>
              </div>
            );
          })}
        </Card>
      </div>

      <Card className="!p-0 overflow-hidden">
        <div className="px-4 py-2 border-b border-border text-sm font-semibold">Sortie History ({sorties.length})</div>
        <div className="overflow-x-auto max-h-[60vh]">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground sticky top-0">
              <tr>
                <th className="px-3 py-2 text-left">{t("date")}</th>
                <th className="px-3 py-2 text-left">A/C</th>
                <th className="px-3 py-2 text-left">Type</th>
                <th className="px-3 py-2 text-left">Name</th>
                <th className="px-3 py-2 text-right">Day</th>
                <th className="px-3 py-2 text-right">Night</th>
                <th className="px-3 py-2 text-right text-rose-300">NVG</th>
                <th className="px-3 py-2 text-right">Actual</th>
              </tr>
            </thead>
            <tbody>
              {sorties.map(s => (
                <tr key={s.id} className="border-t border-border row-hover">
                  <td className="px-3 py-2 font-mono">{s.date}</td>
                  <td className="px-3 py-2">{s.acType} <span className="text-muted-foreground">#{s.acNumber}</span></td>
                  <td className="px-3 py-2">{s.sortieType}</td>
                  <td className="px-3 py-2">{s.name}</td>
                  <td className="px-3 py-2 text-right font-mono">{(s.day1 + s.day2 + s.dayDual).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono">{(s.night1 + s.night2 + s.nightDual).toFixed(1)}</td>
                  <td className="px-3 py-2 text-right font-mono text-rose-300">{s.nvg || "—"}</td>
                  <td className="px-3 py-2 text-right font-mono">{s.actual}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function Stat({ k, v, accent = "" }: { k: string; v: number; accent?: string }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-border last:border-b-0 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={`font-mono ${accent}`}>{v}</span>
    </div>
  );
}
