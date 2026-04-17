import { useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { PILOTS, Pilot } from "@/lib/mock";
import { Link } from "wouter";
import { Plus, Search, Pencil, Trash2 } from "lucide-react";

export default function Roster() {
  const { t } = useI18n();
  const [q, setQ] = useState("");
  const list = PILOTS.filter(p => !q || (p.name + p.arabicName + p.id).toLowerCase().includes(q.toLowerCase()));
  return (
    <div>
      <PageHead title={t("nav_roster")} subtitle={`${PILOTS.length} pilots`} actions={
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="h-3.5 w-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} className="pl-7 pr-2 py-1.5 rounded-md bg-input border border-border text-sm" />
          </div>
          <button className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:opacity-90">
            <Plus className="h-4 w-4" /> {t("add")}
          </button>
        </div>
      } />
      <Card className="!p-0 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left">ID</th>
                <th className="px-3 py-2 text-left">{t("rank")}</th>
                <th className="px-3 py-2 text-left">{t("name")}</th>
                <th className="px-3 py-2 text-left">{t("arabicName")}</th>
                <th className="px-3 py-2 text-left">Unit</th>
                <th className="px-3 py-2 text-left">{t("phone")}</th>
                <th className="px-3 py-2 text-right">{t("openingDay")}</th>
                <th className="px-3 py-2 text-right">{t("openingNight")}</th>
                <th className="px-3 py-2 text-right">{t("openingNvg")}</th>
                <th className="px-3 py-2 text-left">{t("doctorNote")}</th>
                <th className="px-3 py-2 text-right">{t("actions")}</th>
              </tr>
            </thead>
            <tbody>
              {list.map((p: Pilot) => (
                <tr key={p.id} className="border-t border-border row-hover">
                  <td className="px-3 py-2 font-mono">{p.id}</td>
                  <td className="px-3 py-2">{p.rank}</td>
                  <td className="px-3 py-2"><Link href={`/pilot/${p.id}`} className="hover:text-primary">{p.name}</Link></td>
                  <td className="px-3 py-2 text-right rtl:text-left">{p.arabicName}</td>
                  <td className="px-3 py-2"><span className="text-[11px] px-2 py-0.5 rounded-full bg-secondary border border-border">{p.unit}</span></td>
                  <td className="px-3 py-2 font-mono">{p.phone}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingDay}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingNight}</td>
                  <td className="px-3 py-2 text-right font-mono">{p.openingNvg}</td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">{p.doctorNote || "—"}</td>
                  <td className="px-3 py-2 text-right">
                    <button className="p-1.5 rounded hover:bg-secondary" title={t("edit")}><Pencil className="h-3.5 w-3.5" /></button>
                    <button className="p-1.5 rounded hover:bg-destructive/20 text-destructive" title={t("delete")}><Trash2 className="h-3.5 w-3.5" /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
