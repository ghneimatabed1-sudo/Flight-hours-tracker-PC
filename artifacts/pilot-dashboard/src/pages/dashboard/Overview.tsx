import { Link } from "wouter";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useDashPilots, useDashSquadrons } from "@/lib/dash-pilots";
import { resolveScopedIds, useSquadronScope } from "@/lib/squadron-scope";
import { pilotWorstStatus } from "@/lib/format";
import { ChevronRight, Lock, Plane, Users, AlertTriangle, Clock, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";

// Wing / Base / HQ commanders use this Overview as their landing pad.
// Squadron cards summarise the operator's authorized squadrons. Per-squadron
// connectivity badges were removed in task #336 along with the rest of the
// cross-PC mesh — every operator now reads the same LAN-backed squadron
// data, so there is nothing to indicate "online" for.

export default function CommanderOverview() {
  const { t, lang, dir } = useI18n();
  const { user } = useAuth();
  const squadrons = useDashSquadrons();
  const pilots = useDashPilots();
  const [scope] = useSquadronScope();
  if (!user) return null;

  // HQ / multi-squadron commanders pick a squadron (or "Combined") in
  // the topbar. resolveScopedIds collapses the choice against the
  // operator's authorized list so this page only renders the squadrons
  // they want to see right now.
  const myIds = new Set(resolveScopedIds(scope, user.squadronIds));
  const mySqns = squadrons.filter(s => myIds.has(s.id));
  const myPilots = pilots.filter(p => myIds.has(p.squadronId));
  const expired = myPilots.filter(p => { const s = pilotWorstStatus(p); return s === "expired" || s === "critical"; }).length;
  const warning = myPilots.filter(p => { const s = pilotWorstStatus(p); return s === "warning" || s === "expiringSoon"; }).length;

  const stats = [
    { icon: <Plane className="h-5 w-5" />, label: t("totalSquadrons"), value: mySqns.length },
    { icon: <Users className="h-5 w-5" />, label: t("totalPilots"), value: myPilots.length },
    { icon: <AlertTriangle className="h-5 w-5 text-red-500" />, label: t("expiredCurrencies"), value: expired },
    { icon: <Clock className="h-5 w-5 text-amber-500" />, label: t("expiringSoon"), value: warning },
  ];

  return (
    <div className="space-y-6 print-area">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="text-xl font-bold">{t("overview")}</h2>
        <div className="flex items-center gap-2 no-print">
          <Badge variant="outline" className="gap-1"><Lock className="h-3 w-3" />{t("readOnly")}</Badge>
          <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="button-print-overview">
            <Printer className="h-3.5 w-3.5 me-1" />{t("print")}
          </Button>
        </div>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <Card key={i}>
            <CardContent className="p-4 flex items-center gap-3">
              <div className="rounded-md bg-primary/10 text-primary p-2">{s.icon}</div>
              <div>
                <div className="text-xs text-muted-foreground">{s.label}</div>
                <div className="text-2xl font-bold tabular-nums">{s.value}</div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div>
        <h3 className="text-base font-semibold mb-3">{t("squadron")}</h3>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {mySqns.map(s => {
            const sp = pilots.filter(p => p.squadronId === s.id);
            const e = sp.filter(p => { const s = pilotWorstStatus(p); return s === "expired" || s === "critical"; }).length;
            const w = sp.filter(p => { const s = pilotWorstStatus(p); return s === "warning" || s === "expiringSoon"; }).length;
            const c = sp.length - e - w;
            return (
              <Link key={s.id} href={`/dashboard/squadron/${s.id}`}>
                <Card className="hover-elevate cursor-pointer transition" data-testid={`card-sqn-${s.id}`}>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-base flex items-center justify-between gap-2">
                      <span>{lang === "ar" ? s.nameAr : s.name}</span>
                      <ChevronRight className={`h-4 w-4 text-muted-foreground ${dir === "rtl" ? "rotate-180" : ""}`} />
                    </CardTitle>
                    <p className="text-xs text-muted-foreground">
                      {lang === "ar" ? s.baseAr : s.base} · {lang === "ar" ? s.wingAr : s.wing}
                    </p>
                  </CardHeader>
                  <CardContent>
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-2xl font-bold tabular-nums">{sp.length}</div>
                        <div className="text-xs text-muted-foreground">{t("pilotCount")}</div>
                      </div>
                      <div className="flex gap-1.5 text-xs">
                        <span className="flex flex-col items-center rounded bg-emerald-100 dark:bg-emerald-950 text-emerald-900 dark:text-emerald-200 px-2 py-1 min-w-12">
                          <span className="font-bold tabular-nums">{c}</span>
                          <span>{t("current")}</span>
                        </span>
                        <span className="flex flex-col items-center rounded bg-amber-100 dark:bg-amber-950 text-amber-900 dark:text-amber-200 px-2 py-1 min-w-12">
                          <span className="font-bold tabular-nums">{w}</span>
                          <span>{t("warning")}</span>
                        </span>
                        <span className="flex flex-col items-center rounded bg-red-100 dark:bg-red-950 text-red-900 dark:text-red-200 px-2 py-1 min-w-12">
                          <span className="font-bold tabular-nums">{e}</span>
                          <span>{t("expired")}</span>
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      </div>
    </div>
  );
}
