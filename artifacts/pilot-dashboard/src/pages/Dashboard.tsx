import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS, SORTIES } from "@/lib/mock";
import { Link } from "wouter";
import { Plane, MoonStar, Eye, Cpu, Users, Calendar, AlertTriangle, ChevronRight } from "lucide-react";

function statusOf(dateStr: string): "ok" | "warn" | "bad" {
  const days = Math.floor((+new Date(dateStr) - Date.now()) / 86400000);
  if (days < 0) return "bad";
  if (days < 30) return "warn";
  return "ok";
}

export default function Dashboard() {
  const { t } = useI18n();
  const monthDay = +PILOTS.reduce((a, p) => a + p.monthDay, 0).toFixed(1);
  const monthNight = +PILOTS.reduce((a, p) => a + p.monthNight, 0).toFixed(1);
  const monthNvg = +PILOTS.reduce((a, p) => a + p.monthNvg, 0).toFixed(1);
  const monthSim = +PILOTS.reduce((a, p) => a + p.monthSim, 0).toFixed(1);
  const sortiesMonth = SORTIES.filter(s => new Date(s.date).getMonth() === new Date().getMonth()).length;
  const avail = PILOTS.filter(p => p.available).length;

  const expiring = PILOTS.flatMap(p => {
    const items: { pilot: string; type: string; date: string; status: "warn" | "bad" }[] = [];
    (["day", "night", "irt", "medical", "sim"] as const).forEach(c => {
      const s = statusOf(p.expiry[c]);
      if (s !== "ok") items.push({ pilot: p.name, type: c.toUpperCase(), date: p.expiry[c], status: s });
    });
    return items;
  }).sort((a, b) => +new Date(a.date) - +new Date(b.date));

  return (
    <div>
      <PageHead title={t("nav_dashboard")} subtitle={t("monthlyTotals")} actions={
        <Link href="/sortie-add" className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
          <Plane className="h-4 w-4" /> {t("addSortie")}
        </Link>
      } />

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
        <Stat label={t("dayHrs")} value={monthDay} icon={<Plane className="h-4 w-4" />} />
        <Stat label={t("nightHrs")} value={monthNight} icon={<MoonStar className="h-4 w-4" />} />
        <Stat label={t("nvgHrs")} value={monthNvg} icon={<Eye className="h-4 w-4" />} accent="text-rose-300" />
        <Stat label={t("simHrs")} value={monthSim} icon={<Cpu className="h-4 w-4" />} />
        <Stat label={t("sortiesMonth")} value={sortiesMonth} icon={<Calendar className="h-4 w-4" />} />
        <Stat label={t("pilotsAvail")} value={`${avail}/${PILOTS.length}`} icon={<Users className="h-4 w-4" />} />
      </div>

      {/* Expiry alerts */}
      <Card className="mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-400" />
            <h3 className="text-sm font-semibold">{t("expiringAlert")}</h3>
            <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-300">{expiring.length}</span>
          </div>
          <Link href="/expired" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">{t("viewAll")} <ChevronRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-2 max-h-72 overflow-y-auto">
          {expiring.slice(0, 18).map((e, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 rounded-md bg-secondary/40 border border-border">
              <div className="text-sm">{e.pilot} <span className="text-[11px] text-muted-foreground">· {e.type}</span></div>
              <div className="flex items-center gap-2">
                <span className={`status-dot ${e.status === "bad" ? "status-bad" : "status-warn"}`}></span>
                <span className="text-[11px] font-mono text-muted-foreground">{e.date}</span>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* Pilots status grid */}
      <Card>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">{t("nav_roster")}</h3>
          <Link href="/roster" className="text-xs text-muted-foreground hover:text-foreground inline-flex items-center gap-1">{t("viewAll")} <ChevronRight className="h-3.5 w-3.5" /></Link>
        </div>
        <div className="grid sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-3">
          {PILOTS.map(p => {
            const worst = (["day", "night", "irt", "medical", "sim"] as const)
              .map(c => statusOf(p.expiry[c]))
              .reduce((acc, s) => (acc === "bad" || s === "bad" ? "bad" : (acc === "warn" || s === "warn" ? "warn" : "ok")), "ok" as "ok" | "warn" | "bad");
            return (
              <Link key={p.id} href={`/pilot/${p.id}`} className="panel p-3 row-hover block">
                <div className="flex items-center justify-between">
                  <div className="leading-tight min-w-0">
                    <div className="text-sm font-semibold truncate">{p.rank} {p.name}</div>
                    <div className="text-[11px] text-muted-foreground truncate">{p.unit} · {p.id}</div>
                  </div>
                  <span className={`status-dot ${worst === "bad" ? "status-bad" : worst === "warn" ? "status-warn" : "status-ok"}`}></span>
                </div>
                <div className="mt-2 grid grid-cols-3 gap-1 text-[11px] text-muted-foreground">
                  <div>D: <span className="text-foreground font-mono">{p.monthDay}</span></div>
                  <div>N: <span className="text-foreground font-mono">{p.monthNight}</span></div>
                  <div>NVG: <span className="text-rose-300 font-mono">{p.monthNvg}</span></div>
                </div>
              </Link>
            );
          })}
        </div>
      </Card>
    </div>
  );
}

function Stat({ label, value, icon, accent = "" }: { label: string; value: string | number; icon: React.ReactNode; accent?: string }) {
  return (
    <div className="panel p-3">
      <div className="flex items-center justify-between text-muted-foreground">
        <span className="text-[11px] uppercase tracking-wider">{label}</span>
        <span className={accent}>{icon}</span>
      </div>
      <div className={`mt-1 text-2xl font-semibold font-mono ${accent || ""}`}>{value}</div>
    </div>
  );
}
