import { useEffect, useState } from "react";
import { Card, PageHead } from "@/components/Layout";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { supabase, supabaseConfigured } from "@/lib/supabase";

interface AuditRow {
  ts: string;
  user: string;
  action: string;
  target: string;
}

const SEED: AuditRow[] = [
  { ts: "2026-04-17 08:14:32", user: "ops.lead", action: "Login", target: "—" },
  { ts: "2026-04-17 08:21:09", user: "ops.lead", action: "Add Sortie", target: "S10092" },
  { ts: "2026-04-17 09:02:11", user: "deputy.k", action: "Edit Pilot", target: "P003" },
  { ts: "2026-04-17 09:18:45", user: "ops.lead", action: "Mark Unavailable", target: "P006" },
  { ts: "2026-04-17 10:33:02", user: "ops.lead", action: "Publish NOTAM", target: "N0004" },
  { ts: "2026-04-17 11:01:55", user: "admin", action: "Reset Password", target: "deputy.k" },
];

export default function AuditLog() {
  const { t } = useI18n();
  const { fingerprint } = useAuth();
  const [rows, setRows] = useState<AuditRow[]>(supabaseConfigured ? [] : SEED);
  const [loading, setLoading] = useState(supabaseConfigured);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!supabase) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("audit_log")
        .select("occurred_at, actor, type, detail")
        .order("occurred_at", { ascending: false })
        .limit(200);
      if (cancelled) return;
      if (error) { setError(error.message); setLoading(false); return; }
      setRows((data ?? []).map(r => ({
        ts: new Date(r.occurred_at as string).toISOString().replace("T", " ").slice(0, 19),
        user: (r.actor as string | null) ?? "system",
        action: r.type as string,
        target: typeof r.detail === "object" && r.detail
          ? Object.entries(r.detail as Record<string, unknown>).map(([k, v]) => `${k}=${String(v)}`).join(" ")
          : "—",
      })));
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div>
      <PageHead title={t("nav_audit")} subtitle={supabaseConfigured ? "Live from server · with PC fingerprint" : "Demo data · connect Supabase for live history"} />
      {error && <div className="mb-3 text-xs text-rose-300">{error}</div>}
      <Card className="!p-0 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-secondary/50 text-xs uppercase tracking-wider text-muted-foreground">
            <tr><th className="px-3 py-2 text-left">Timestamp</th><th className="px-3 py-2 text-left">User</th><th className="px-3 py-2 text-left">Action</th><th className="px-3 py-2 text-left">Target</th><th className="px-3 py-2 text-left">Fingerprint</th></tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Loading…</td></tr>}
            {!loading && rows.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No audit events yet.</td></tr>}
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
