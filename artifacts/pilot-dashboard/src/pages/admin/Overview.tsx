import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Plane, Users, AlertTriangle, KeyRound, Printer } from "lucide-react";
import { squadrons, pilots, licenseKeys } from "@/lib/mockData";
import { pilotWorstStatus } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { Button } from "@/components/ui/button";
import { FrozenAccessPanel } from "@/components/FrozenAccessPanel";
import { useAuth } from "@/lib/auth";

export default function AdminOverview() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  const enabledSquadrons = squadrons.filter(s => s.enabled);
  const expired = pilots.filter(p => { const s = pilotWorstStatus(p); return s === "expired" || s === "critical"; }).length;
  const warning = pilots.filter(p => { const s = pilotWorstStatus(p); return s === "warning" || s === "expiringSoon"; }).length;
  const activeKeys = licenseKeys.filter(k => k.status !== "revoked").length;

  const stats = [
    { icon: <Plane className="h-5 w-5" />, label: t("totalSquadrons"), value: `${enabledSquadrons.length}/${squadrons.length}` },
    { icon: <Users className="h-5 w-5" />, label: t("totalPilots"), value: pilots.length },
    { icon: <AlertTriangle className="h-5 w-5 text-red-500" />, label: t("expiredCurrencies"), value: expired },
    { icon: <KeyRound className="h-5 w-5" />, label: t("licenseKeys"), value: `${activeKeys}/${licenseKeys.length}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="text-xl font-bold">{t("systemOverview")}</h2>
        <Button size="sm" variant="outline" onClick={() => window.print()} data-testid="button-print-admin-overview" className="no-print">
          <Printer className="h-3.5 w-3.5 me-1" />{t("print")}
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map((s, i) => (
          <Card key={i} data-testid={`stat-${i}`}>
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

      <Card>
        <CardHeader>
          <CardTitle>{t("squadronStatus")}</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-start">
                <tr className="border-b border-border text-muted-foreground">
                  <th className="text-start py-2 px-2">{t("squadron")}</th>
                  <th className="text-start py-2 px-2">{t("base")}</th>
                  <th className="text-start py-2 px-2">{t("wing")}</th>
                  <th className="text-end py-2 px-2">{t("pilotCount")}</th>
                  <th className="text-end py-2 px-2">{t("expired")}</th>
                  <th className="text-end py-2 px-2">{t("expiringSoon")}</th>
                  <th className="text-start py-2 px-2">{t("status")}</th>
                </tr>
              </thead>
              <tbody>
                {squadrons.map(s => {
                  const sp = pilots.filter(p => p.squadronId === s.id);
                  const e = sp.filter(p => { const s = pilotWorstStatus(p); return s === "expired" || s === "critical"; }).length;
                  const w = sp.filter(p => { const s = pilotWorstStatus(p); return s === "warning" || s === "expiringSoon"; }).length;
                  return (
                    <tr key={s.id} className="border-b border-border/60 hover:bg-accent/40" data-testid={`row-sqn-${s.id}`}>
                      <td className="py-2 px-2 font-medium">{lang === "ar" ? s.nameAr : s.name}</td>
                      <td className="py-2 px-2">{lang === "ar" ? s.baseAr : s.base}</td>
                      <td className="py-2 px-2">{lang === "ar" ? s.wingAr : s.wing}</td>
                      <td className="py-2 px-2 text-end tabular-nums">{sp.length}</td>
                      <td className="py-2 px-2 text-end tabular-nums">{e > 0 ? <StatusBadge status="expired" /> : "—"}</td>
                      <td className="py-2 px-2 text-end tabular-nums">{w > 0 ? <span className="font-medium">{w}</span> : "—"}</td>
                      <td className="py-2 px-2">{s.enabled ? <span className="text-emerald-600">●</span> : <span className="text-muted-foreground">○</span>} <span className="ms-1 text-xs">{s.enabled ? t("enabled") : t("disabled")}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground mt-2">{warning} {t("expiringSoon")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4">
          <FrozenAccessPanel actor={user?.username ?? "super.admin"} />
        </CardContent>
      </Card>
    </div>
  );
}
