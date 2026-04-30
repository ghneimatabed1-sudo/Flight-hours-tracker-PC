// Top-of-Settings warning ribbon.
//
// Mounted by `Settings.tsx` for super_admin operators only (task #390).
// Polls the same `/api/internal/about` snapshot the AboutThisPc panel
// uses, then renders a loud red banner whenever any health dot in
// that snapshot is `fail` (last backup > 7 days old, or last verify
// FAILED). The ribbon embeds the same one-click action buttons so a
// super_admin doesn't have to scroll past five Settings cards just to
// find the AboutThisPc panel.
//
// We intentionally re-poll inside this component instead of lifting
// state into `Settings.tsx` so the panel and the ribbon stay
// independently testable. The 60s poll matches AboutThisPc.

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, PlayCircle } from "lucide-react";
import {
  fetchInternalAboutThisPc,
  postInternalAboutAction,
  type AboutThisPcAction,
  type AboutThisPcReport,
} from "@/lib/internal-migration";
import {
  lastBackupSeverity,
  lastBackupVerifySeverity,
  shouldShowAboutHealthRibbon,
} from "@/lib/about-health";
import { useI18n } from "@/lib/i18n";

const POLL_MS = 60_000;

interface InlineActionProps {
  action: AboutThisPcAction;
  label: string;
  runningLabel: string;
  testId: string;
  onAfter: () => void | Promise<void>;
}

function InlineAction({
  action,
  label,
  runningLabel,
  testId,
  onAfter,
}: InlineActionProps): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const onClick = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await postInternalAboutAction(action);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      await onAfter();
    } finally {
      setBusy(false);
    }
  }, [action, onAfter]);
  return (
    <span className="flex items-center gap-1.5">
      <button
        type="button"
        onClick={onClick}
        disabled={busy}
        data-testid={testId}
        className="inline-flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-destructive/20 text-destructive border border-destructive/40 hover:bg-destructive/30 disabled:opacity-50"
      >
        {busy ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <PlayCircle className="h-3.5 w-3.5" />
        )}
        <span>{busy ? runningLabel : label}</span>
      </button>
      {error && (
        <span
          className="text-[11px] text-destructive max-w-[10rem] truncate"
          title={error}
          data-testid={`${testId}-error`}
        >
          {error}
        </span>
      )}
    </span>
  );
}

export default function AboutHealthRibbon(): React.ReactElement | null {
  const { t } = useI18n();
  const [report, setReport] = useState<AboutThisPcReport | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetchInternalAboutThisPc();
      setReport(r);
    } catch {
      setReport(null);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | null = null;
    async function tick() {
      if (cancelled) return;
      await load();
    }
    void tick();
    timer = setInterval(tick, POLL_MS);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [load]);

  if (!shouldShowAboutHealthRibbon(report)) return null;
  if (!report) return null;

  const backupFail =
    lastBackupSeverity(report.lastBackupAge?.ageSeconds ?? null) === "fail";
  const verifyFail = lastBackupVerifySeverity(report.lastBackupVerifyAge) === "fail";

  return (
    <div
      role="alert"
      data-testid="about-health-ribbon"
      className="mb-4 rounded-md border border-destructive/60 bg-destructive/10 px-4 py-3 flex flex-wrap items-start gap-3"
    >
      <AlertTriangle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
      <div className="flex-1 min-w-[12rem]">
        <div className="text-sm font-semibold text-destructive">
          {t("about_health_ribbon_title")}
        </div>
        <div className="text-xs text-foreground/90 mt-0.5">
          {t("about_health_ribbon_blurb")}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {backupFail && (
          <InlineAction
            action="run-backup"
            label={t("about_run_backup_now")}
            runningLabel={t("about_action_running")}
            testId="about-ribbon-run-backup"
            onAfter={load}
          />
        )}
        {verifyFail && (
          <InlineAction
            action="run-verify"
            label={t("about_run_verify_now")}
            runningLabel={t("about_action_running")}
            testId="about-ribbon-run-verify"
            onAfter={load}
          />
        )}
      </div>
    </div>
  );
}
