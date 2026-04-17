import { Link, useRoute } from "wouter";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { pilots, squadrons } from "@/lib/mockData";
import { pilotWorstStatus, fmtDate } from "@/lib/format";
import { StatusBadge } from "@/components/StatusBadge";
import { ChevronLeft, Eye, Plane, Calendar, Award } from "lucide-react";

export default function PilotDetail() {
  const { t, lang, dir } = useI18n();
  const { user } = useAuth();
  const [, params] = useRoute("/dashboard/pilot/:id");
  const id = params?.id;
  const pilot = pilots.find(p => p.id === id);
  const squadron = pilot ? squadrons.find(s => s.id === pilot.squadronId) : null;

  if (!user) return null;
  if (!pilot || !squadron || !user.squadronIds.includes(pilot.squadronId)) {
    return <div className="text-center py-12 text-muted-foreground">{t("noResults")}</div>;
  }

  const currencies = [
    { label: t("dayCurrency"), date: pilot.dayCurrencyDate },
    { label: t("nightCurrency"), date: pilot.nightCurrencyDate },
    { label: t("irtCurrency"), date: pilot.irtCurrencyDate },
    { label: t("medicalCurrency"), date: pilot.medicalCurrencyDate },
  ];

  return (
    <div className="space-y-4">
      <Link href="/dashboard/pilots" className="text-xs inline-flex items-center text-muted-foreground hover:text-foreground">
        <ChevronLeft className={`h-3 w-3 me-1 ${dir === "rtl" ? "rotate-180" : ""}`} />{t("back")}
      </Link>

      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h2 className="text-2xl font-bold">{lang === "ar" ? pilot.fullNameAr : pilot.fullName}</h2>
          <p className="text-sm text-muted-foreground font-mono">{pilot.callSign} · {lang === "ar" ? squadron.nameAr : squadron.name}</p>
        </div>
        <div className="flex gap-2">
          <StatusBadge status={pilotWorstStatus(pilot)} />
          <Badge variant="outline" className="gap-1"><Eye className="h-3 w-3" />{t("readOnly")}</Badge>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Plane className="h-3 w-3" />{t("monthlyHours")}</div>
            <div className="text-2xl font-bold tabular-nums">{pilot.monthlyHours.toFixed(1)}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Award className="h-3 w-3" />{t("grandTotal")}</div>
            <div className="text-2xl font-bold tabular-nums">{pilot.grandTotalHours}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />{t("nvgTotal")}</div>
            <div className="text-2xl font-bold tabular-nums">{pilot.nvgTotalHours}</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle className="text-base">{t("currencies")}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid sm:grid-cols-2 gap-3">
            {currencies.map(c => {
              const target = new Date(c.date).getTime();
              const diff = Math.floor((target - Date.now()) / 86400000);
              const status: "current" | "warning" | "expired" = diff < 0 ? "expired" : diff <= 30 ? "warning" : "current";
              return (
                <div key={c.label} className="flex items-center justify-between rounded-md border p-3">
                  <div>
                    <div className="text-xs text-muted-foreground">{c.label}</div>
                    <div className="font-medium tabular-nums">{fmtDate(c.date, lang)}</div>
                  </div>
                  <StatusBadge status={status} />
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      <Link href={`/dashboard/squadron/${pilot.squadronId}`}>
        <Button variant="outline" data-testid="button-squadron">{t("squadronView")}: {lang === "ar" ? squadron.nameAr : squadron.name}</Button>
      </Link>
    </div>
  );
}
