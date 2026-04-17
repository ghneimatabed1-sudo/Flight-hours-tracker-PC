import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabaseConfigured } from "@/lib/supabase";
import { useAuditLog } from "@/lib/squadron-data";
import { DataUnavailableBanner } from "@/components/DataUnavailableBanner";

export default function AuditLog() {
  const { t } = useI18n();
  const { fingerprint } = useAuth();
  const auditQ = useAuditLog();
  const { data: rows, isLoading } = auditQ;

  return (
    <div>
      <PageHead title={t("nav_audit")} subtitle={supabaseConfigured ? "Live from server · with PC fingerprint" : "Demo data · connect Supabase for live history"} />
      <DataUnavailableBanner queries={[auditQ]} testId="banner-audit-unavailable" />
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Timestamp</th><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-left">Fingerprint</th></tr>
          </thead>
          <tbody>
            {isLoading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!isLoading && rows.length === 0 && (
              <tr>
                <td colSpan={5} className="px-3 py-6 text-center text-muted-foreground" data-testid="empty-audit">
                  {auditQ.isError ? "—" : "No audit events yet."}
                </td>
              </tr>
            )}
            {rows.map((e, i) => (
              <tr key={i} className="border-t border-border row-hover">
                <td className="px-3 py-2 font-mono">{e.ts}</td>
                <td className="px-3 py-2">{e.user}</td>
                <td className="px-3 py-2">{e.action}</td>
                <td className="px-3 py-2 font-mono text-muted-foreground">{e.target}</td>
                <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">{fingerprint}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
