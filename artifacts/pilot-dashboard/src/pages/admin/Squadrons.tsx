import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { squadrons as initial, pilots } from "@/lib/mockData";
import type { Squadron } from "@/lib/types";
import { Plane } from "lucide-react";

export default function Squadrons() {
  const { t, lang } = useI18n();
  const [list, setList] = useState<Squadron[]>(initial);

  function toggle(id: string) {
    setList(l => l.map(s => s.id === id ? { ...s, enabled: !s.enabled } : s));
  }

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><Plane className="h-5 w-5" />{t("squadrons")}</h2>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("squadron")}</th>
                  <th className="text-start py-2 px-3">{t("base")}</th>
                  <th className="text-start py-2 px-3">{t("wing")}</th>
                  <th className="text-end py-2 px-3">{t("pilotCount")}</th>
                  <th className="text-start py-2 px-3">{t("keyHolder")}</th>
                  <th className="text-start py-2 px-3">{t("status")}</th>
                  <th className="text-end py-2 px-3"></th>
                </tr>
              </thead>
              <tbody>
                {list.map(s => {
                  const count = pilots.filter(p => p.squadronId === s.id).length;
                  return (
                    <tr key={s.id} className="border-b border-border/60" data-testid={`row-sqn-${s.id}`}>
                      <td className="py-2 px-3 font-medium">{lang === "ar" ? s.nameAr : s.name} <span className="text-muted-foreground text-xs">({s.code})</span></td>
                      <td className="py-2 px-3">{lang === "ar" ? s.baseAr : s.base}</td>
                      <td className="py-2 px-3">{lang === "ar" ? s.wingAr : s.wing}</td>
                      <td className="py-2 px-3 text-end tabular-nums">{count}</td>
                      <td className="py-2 px-3">{s.keyHolder ?? "—"}</td>
                      <td className="py-2 px-3">
                        <span className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${s.enabled ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" : "bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300"}`}>
                          {s.enabled ? t("enabled") : t("disabled")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-end">
                        <Button size="sm" variant="outline" onClick={() => toggle(s.id)} data-testid={`button-toggle-${s.id}`}>
                          {s.enabled ? t("disable") : t("enable")}
                        </Button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
