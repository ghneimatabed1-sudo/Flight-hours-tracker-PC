import { useMemo, useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { auditLog } from "@/lib/mockData";
import { fmtDateTime } from "@/lib/format";
import { ListChecks, Search } from "lucide-react";

export default function AuditLog() {
  const { t, lang } = useI18n();
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.toLowerCase().trim();
    if (!s) return auditLog;
    return auditLog.filter(a =>
      a.user.toLowerCase().includes(s) ||
      a.action.toLowerCase().includes(s) ||
      a.target.toLowerCase().includes(s) ||
      a.role.toLowerCase().includes(s) ||
      a.ip.includes(s)
    );
  }, [q]);

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-bold flex items-center gap-2"><ListChecks className="h-5 w-5" />{t("auditLog")}</h2>
      <div className="relative max-w-md">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input value={q} onChange={e => setQ(e.target.value)} placeholder={t("search")} className="ps-9" data-testid="input-search" />
      </div>
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("timestamp")}</th>
                  <th className="text-start py-2 px-3">{t("user")}</th>
                  <th className="text-start py-2 px-3">{t("action")}</th>
                  <th className="text-start py-2 px-3">{t("target")}</th>
                  <th className="text-start py-2 px-3">{t("ip")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">{t("noResults")}</td></tr>
                )}
                {filtered.map(a => (
                  <tr key={a.id} className="border-b border-border/60" data-testid={`row-audit-${a.id}`}>
                    <td className="py-2 px-3 tabular-nums whitespace-nowrap">{fmtDateTime(a.timestamp, lang)}</td>
                    <td className="py-2 px-3"><span className="font-mono text-xs">{a.user}</span> <span className="ms-1 text-xs text-muted-foreground">[{a.role}]</span></td>
                    <td className="py-2 px-3">{a.action}</td>
                    <td className="py-2 px-3">{a.target}</td>
                    <td className="py-2 px-3 font-mono text-xs">{a.ip}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
