// "About this PC" Settings panel.
//
// Mounted on the Settings page (`Settings.tsx`) for super_admin
// operators only. Polls `/api/internal/about` (or `/api/aggregate/about`
// on aggregator profiles) every 60 seconds and surfaces the small
// handful of facts a super_admin needs when reporting an issue:
//
//   * install profile (hub / aggregator-wing / aggregator-base / viewer)
//   * hostname
//   * api-server version + build time
//   * process uptime
//   * database name
//   * active peer-token count (hub) OR peer-squadron count (aggregator)
//   * last backup age + last backup-verify age (with health dots)
//   * node.js version
//
// Each row uses a colored dot (ok / warn / fail / unknown) so the
// operator can scan for trouble at a glance without having to
// interpret raw numbers.

import { useEffect, useState } from "react";
import {
  fetchInternalAboutThisPc,
  type AboutThisPcReport,
} from "@/lib/internal-migration";
import { useI18n } from "@/lib/i18n";
import { Card } from "@/components/Layout";
import { Server } from "lucide-react";

const POLL_MS = 60_000;

type DotSeverity = "ok" | "warn" | "fail" | "unknown";

function dotClass(s: DotSeverity): string {
  switch (s) {
    case "ok":
      return "bg-emerald-400";
    case "warn":
      return "bg-amber-400";
    case "fail":
      return "bg-red-500";
    default:
      return "bg-zinc-500";
  }
}

function fmtUptime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${ss}s`;
  return `${ss}s`;
}

function fmtAgeShort(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function lastBackupSeverity(seconds: number | null | undefined): DotSeverity {
  if (seconds == null) return "unknown";
  const days = seconds / 86400;
  if (days > 7) return "fail";
  if (days > 2) return "warn";
  return "ok";
}

function lastBackupVerifySeverity(
  v: { ageSeconds: number; ok: boolean } | null | undefined,
): DotSeverity {
  if (!v) return "warn";
  if (!v.ok) return "fail";
  const days = v.ageSeconds / 86400;
  if (days > 120) return "warn";
  return "ok";
}

function fmtBuildTime(s: string | null | undefined): string {
  if (!s) return "—";
  // ISO timestamp; render in the user's locale, short form.
  const t = new Date(s);
  if (Number.isNaN(t.getTime())) return s;
  return t.toLocaleString();
}

interface RowProps {
  label: string;
  value: React.ReactNode;
  severity?: DotSeverity;
  testId?: string;
}

function Row({ label, value, severity = "ok", testId }: RowProps) {
  return (
    <div
      className="flex items-center justify-between gap-3 py-1 text-sm"
      data-testid={testId}
    >
      <span className="flex items-center gap-2 text-muted-foreground min-w-0">
        <span
          className={`inline-block h-2 w-2 rounded-full shrink-0 ${dotClass(severity)}`}
          aria-hidden="true"
        />
        <span className="truncate">{label}</span>
      </span>
      <span
        className="font-mono text-xs text-foreground break-all text-end"
        data-testid={testId ? `${testId}-value` : undefined}
      >
        {value}
      </span>
    </div>
  );
}

export default function AboutThisPc(): React.ReactElement {
  const { t } = useI18n();
  const [report, setReport] = useState<AboutThisPcReport | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastPolledAt, setLastPolledAt] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;

    async function load() {
      try {
        const r = await fetchInternalAboutThisPc();
        if (cancelled) return;
        if (r) {
          setReport(r);
          setError(null);
        } else {
          setError("about_unreachable");
        }
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) {
          setLoaded(true);
          setLastPolledAt(new Date().toISOString());
        }
      }
    }

    void load();
    timer = setInterval(load, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, []);

  return (
    <Card
      className="lg:col-span-2 space-y-3"
      data-testid="about-this-pc-card"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold flex items-center gap-2">
          <Server className="h-4 w-4 text-primary" />
          {t("about_this_pc_title")}
        </div>
        {lastPolledAt && (
          <span
            className="text-[11px] text-muted-foreground"
            data-testid="about-last-polled"
          >
            {t("about_last_polled")}: {new Date(lastPolledAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <p className="text-xs text-muted-foreground">{t("about_this_pc_blurb")}</p>

      {!loaded && (
        <div
          className="text-xs text-muted-foreground"
          data-testid="about-loading"
        >
          {t("about_loading")}
        </div>
      )}

      {loaded && !report && (
        <div
          className="rounded border border-amber-700/40 bg-amber-950/30 px-3 py-2 text-xs text-amber-200"
          data-testid="about-unreachable"
        >
          {t("about_unreachable")}
          {error && (
            <div className="mt-1 font-mono text-[11px] text-amber-300/80 break-all">
              {error}
            </div>
          )}
        </div>
      )}

      {report && (
        <div
          className="grid grid-cols-1 md:grid-cols-2 gap-x-6 divide-y md:divide-y-0 md:divide-x divide-border"
          data-testid="about-rows"
        >
          <div className="space-y-0">
            <Row
              label={t("about_field_install_profile")}
              value={report.installProfile}
              testId="about-install-profile"
            />
            <Row
              label={t("about_field_hostname")}
              value={report.hostname || "—"}
              testId="about-hostname"
            />
            <Row
              label={t("about_field_api_version")}
              value={report.apiServerVersion || "—"}
              testId="about-api-version"
            />
            <Row
              label={t("about_field_build_time")}
              value={fmtBuildTime(report.buildTime)}
              testId="about-build-time"
            />
            <Row
              label={t("about_field_uptime")}
              value={fmtUptime(report.uptimeSeconds)}
              testId="about-uptime"
            />
            <Row
              label={t("about_field_node_version")}
              value={report.nodeVersion}
              testId="about-node-version"
            />
          </div>
          <div className="space-y-0 md:ps-6">
            <Row
              label={t("about_field_database_name")}
              value={report.databaseName ?? "—"}
              severity={report.databaseName ? "ok" : "warn"}
              testId="about-database-name"
            />
            {report.peerTokenCount != null && (
              <Row
                label={t("about_field_peer_token_count")}
                value={String(report.peerTokenCount)}
                testId="about-peer-token-count"
              />
            )}
            {report.peerSquadronCount != null && (
              <Row
                label={t("about_field_peer_squadron_count")}
                value={String(report.peerSquadronCount)}
                testId="about-peer-squadron-count"
              />
            )}
            <Row
              label={t("about_field_last_backup")}
              value={
                report.lastBackupAge
                  ? fmtAgeShort(report.lastBackupAge.ageSeconds) +
                    " · " +
                    report.lastBackupAge.fileName
                  : t("about_never_backed_up")
              }
              severity={lastBackupSeverity(report.lastBackupAge?.ageSeconds ?? null)}
              testId="about-last-backup"
            />
            <Row
              label={t("about_field_last_backup_verify")}
              value={
                report.lastBackupVerifyAge
                  ? fmtAgeShort(report.lastBackupVerifyAge.ageSeconds) +
                    (report.lastBackupVerifyAge.ok ? "" : " · FAIL")
                  : t("about_never_verified")
              }
              severity={lastBackupVerifySeverity(report.lastBackupVerifyAge)}
              testId="about-last-backup-verify"
            />
          </div>
        </div>
      )}
    </Card>
  );
}
