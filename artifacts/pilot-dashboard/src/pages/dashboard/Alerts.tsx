import { Link } from "wouter";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { pilots, squadrons } from "@/lib/mockData";
import { currencyStatus, fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { AlertTriangle } from "lucide-react";

export default function Alerts() {
  const { t, lang } = useI18n();
  const { user } = useAuth();
  if (!user) return null;
  const myIds = new Set(user.squadronIds);

  const items: Array<{ pilotId: string; pilot: string; sqn: string; type: string; date: string; status: "expired" | "warning" }> = [];
  for (const p of pilots) {
    if (!myIds.has(p.squadronId)) continue;
    const sqn = squadrons.find(s => s.id === p.squadronId);
    if (!sqn) continue;
    const checks: Array<[string, string]> = [
      [t("dayCurrency"), p.dayCurrencyDate],
      [t("nightCurrency"), p.nightCurrencyDate],
      [t("irtCurrency"), p.irtCurrencyDate],
      [t("medicalCurrency"), p.medicalCurrencyDate],
    ];
    for (const [type, date] of checks) {
      const s = currencyStatus(date);
      if (s !== "current") {
        items.push({
          pilotId: p.id,
          pilot: lang === "ar" ? p.fullNameAr : p.fullName,
          sqn: lang === "ar" ? sqn.nameAr : sqn.code,
          type, date, status: s,
        });
      }
    }
  }
  items.sort((a, b) => {
    if (a.status !== b.status) return a.status === "expired" ? -1 : 1;
    return new Date(a.date).getTime() - new Date(b.date).getTime();
  });

  const expired = items.filter(i => i.status === "expired");
  const warning = items.filter(i => i.status === "warning");

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><AlertTriangle className="h-5 w-5 text-amber-500" />{t("alerts")}</h2>

      <Section title={`${t("expired")} (${expired.length})`} items={expired} t={t} />
      <Section title={`${t("expiringSoon")} (${warning.length})`} items={warning} t={t} />
    </div>
  );
}

function Section({ title, items, t }: { title: string; items: Array<{ pilotId: string; pilot: string; sqn: string; type: string; date: string; status: "expired" | "warning" }>; t: (k: never) => string }) {
  const { lang } = useI18n();
  return (
    <Card>
      <CardHeader><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="p-4 text-sm text-muted-foreground">—</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground text-xs">
                  <th className="text-start py-2 px-3">{t("pilot" as never)}</th>
                  <th className="text-start py-2 px-3">{t("squadron" as never)}</th>
                  <th className="text-start py-2 px-3">{t("currencies" as never)}</th>
                  <th className="text-start py-2 px-3">{t("status" as never)}</th>
                  <th className="py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {items.map((i, idx) => (
                  <tr key={idx} className="border-b border-border/60" data-testid={`row-alert-${idx}`}>
                    <td className="py-2 px-3 font-medium">{i.pilot}</td>
                    <td className="py-2 px-3">{i.sqn}</td>
                    <td className="py-2 px-3">{i.type} · <span className="tabular-nums">{fmtDate(i.date, lang)}</span></td>
                    <td className="py-2 px-3"><StatusBadge status={i.status} /></td>
                    <td className="py-2 px-3 text-end">
                      <Link href={`/dashboard/pilot/${i.pilotId}`}>
                        <Button size="sm" variant="outline" data-testid={`button-view-alert-${idx}`}>{t("viewDetails" as never)}</Button>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
