import { useEffect, useState } from "react";
import { Link } from "wouter";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { supabase, supabaseConfigured } from "@/lib/supabase";
import { fmtDateTime } from "@/lib/format";
import {
  loadReminderSession, saveReminderSession, clearReminderSession,
} from "@/lib/reminder-session";
import {
  AlarmClock, RefreshCw, Power, PowerOff, ListChecks, AlertTriangle, Lock, Play,
} from "lucide-react";

interface ScheduleRun {
  runid: number;
  start_time: string;
  end_time: string | null;
  status: string;
  return_message: string | null;
}

interface HttpResult {
  id: number;
  status_code: number | null;
  error_msg: string | null;
  created: string;
  content_preview: string | null;
}

interface ScheduleStatus {
  enabled: boolean;
  extensionMissing?: boolean;
  jobid?: number;
  schedule?: string;
  runs: ScheduleRun[];
  httpResults?: HttpResult[];
}

const ADMIN_USERNAME = "admin";
const DEFAULT_CRON = "0 6 * * *";

type PendingAction = "status" | "enable" | "disable" | "run-now";

export default function RemindersSchedule() {
  const { t, lang } = useI18n();
  const { toast } = useToast();
  const [hasSession, setHasSession] = useState<boolean>(() => !!loadReminderSession());
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<ScheduleStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cronInput, setCronInput] = useState(DEFAULT_CRON);
  const [authOpen, setAuthOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState("");

  function requireSession(action: PendingAction) {
    setPendingAction(action);
    setPwd("");
    setCode("");
    setAuthOpen(true);
  }

  async function callAction(action: "status" | "enable" | "disable" | "run-now", token: string) {
    if (!supabase) return null;
    const body: Record<string, unknown> = { action, token };
    if (action === "enable") body.cron = cronInput.trim();
    return await supabase.functions.invoke("manage-reminder-schedule", { body });
  }

  async function refresh() {
    if (!supabaseConfigured || !supabase) {
      setError("supabase_not_configured");
      return;
    }
    const session = loadReminderSession();
    if (!session) {
      setHasSession(false);
      requireSession("status");
      return;
    }
    setLoading(true);
    setError(null);
    const res = await callAction("status", session.token);
    setLoading(false);
    if (res?.error || !res?.data?.ok) {
      const reason = res?.data?.error ?? res?.error?.message ?? "status_failed";
      if (reason === "bad_token" || reason === "missing_token") {
        clearReminderSession();
        setHasSession(false);
        requireSession("status");
        return;
      }
      setError(reason);
      return;
    }
    const s = res.data.status as ScheduleStatus;
    setStatus(s);
    if (s.schedule) setCronInput(s.schedule);
  }

  // Auto-refresh on mount if a session is already cached.
  useEffect(() => {
    if (hasSession) refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submitAuth() {
    if (!supabase || !pendingAction) return;
    setBusy(true);
    const res = await supabase.functions.invoke("manage-reminder-schedule", {
      body: { action: "session", username: ADMIN_USERNAME, password: pwd, code },
    });
    if (res.error || !res.data?.ok) {
      setBusy(false);
      const reason = res.data?.error ?? res.error?.message ?? "auth_failed";
      toast({
        title: t("authFailed"),
        description: reason === "locked"
          ? t("authLocked")
          : reason === "bad_code"
            ? t("authBadCode")
            : t("authBadCreds"),
        variant: "destructive",
      });
      return;
    }
    saveReminderSession({
      token: res.data.token as string,
      expiresAt: res.data.expiresAt as number,
    });
    setHasSession(true);

    // Carry the just-authenticated user straight into their pending action.
    const action = pendingAction;
    setAuthOpen(false);
    setPendingAction(null);
    setPwd("");
    setCode("");

    if (action === "status") {
      setBusy(false);
      refresh();
      return;
    }

    // enable / disable / run-now
    const token = res.data.token as string;
    const op = await callAction(action, token);
    setBusy(false);
    if (op?.error || !op?.data?.ok) {
      toast({
        title: action === "run-now" ? t("runNowFailed") : t("scheduleActionFailed"),
        description: op?.data?.error ?? op?.error?.message ?? "failed",
        variant: "destructive",
      });
      return;
    }
    if (action === "run-now") {
      const r = (op.data?.result ?? {}) as { sent?: number; failed?: number; candidates?: number };
      toast({
        title: t("runNowSuccess"),
        description: t("runNowResult")
          .replace("{sent}", String(r.sent ?? 0))
          .replace("{failed}", String(r.failed ?? 0))
          .replace("{candidates}", String(r.candidates ?? 0)),
      });
    } else {
      toast({
        title: action === "enable" ? t("scheduleEnabled") : t("scheduleDisabled"),
      });
    }
    refresh();
  }

  async function performMutation(action: "enable" | "disable" | "run-now") {
    const session = loadReminderSession();
    if (!session) {
      requireSession(action);
      return;
    }
    setBusy(true);
    const res = await callAction(action, session.token);
    setBusy(false);
    if (res?.error || !res?.data?.ok) {
      const reason = res?.data?.error ?? res?.error?.message ?? "failed";
      if (reason === "bad_token" || reason === "missing_token") {
        clearReminderSession();
        setHasSession(false);
        requireSession(action);
        return;
      }
      toast({
        title: action === "run-now" ? t("runNowFailed") : t("scheduleActionFailed"),
        description: reason,
        variant: "destructive",
      });
      return;
    }
    if (action === "run-now") {
      const r = (res.data?.result ?? {}) as { sent?: number; failed?: number; candidates?: number };
      toast({
        title: t("runNowSuccess"),
        description: t("runNowResult")
          .replace("{sent}", String(r.sent ?? 0))
          .replace("{failed}", String(r.failed ?? 0))
          .replace("{candidates}", String(r.candidates ?? 0)),
      });
    } else {
      toast({
        title: action === "enable" ? t("scheduleEnabled") : t("scheduleDisabled"),
      });
    }
    refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-bold flex items-center gap-2">
          <AlarmClock className="h-5 w-5" />
          {t("remindersSchedule")}
        </h2>
        <div className="flex gap-2">
          <Link
            href="/admin/reminders/log"
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card hover-elevate px-3 py-1.5 text-sm"
            data-testid="link-reminder-log"
          >
            <ListChecks className="h-4 w-4" />
            {t("viewReminderLog")}
          </Link>
          <Button
            variant="outline"
            size="sm"
            onClick={refresh}
            disabled={loading || busy}
            data-testid="button-refresh-status"
          >
            <RefreshCw className={`h-4 w-4 me-1 ${loading ? "animate-spin" : ""}`} />
            {t("refresh")}
          </Button>
        </div>
      </div>

      <p className="text-sm text-muted-foreground">{t("remindersScheduleHelp")}</p>

      {error === "supabase_not_configured" ? (
        <Card>
          <CardContent className="p-4 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-amber-500 mt-0.5" />
            <span>{t("scheduleNeedsSupabase")}</span>
          </CardContent>
        </Card>
      ) : error ? (
        <Card>
          <CardContent className="p-4 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-red-500 mt-0.5" />
            <span data-testid="text-status-error">{t("scheduleStatusError")}: {error}</span>
          </CardContent>
        </Card>
      ) : !hasSession ? (
        <Card>
          <CardContent className="p-4 flex flex-wrap items-center gap-3 text-sm">
            <Lock className="h-4 w-4 text-muted-foreground" />
            <span className="flex-1 min-w-0">{t("scheduleAuthRequired")}</span>
            <Button
              size="sm"
              onClick={() => requireSession("status")}
              data-testid="button-unlock"
            >
              {t("scheduleUnlock")}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {status?.enabled ? (
              <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200" data-testid="badge-schedule-enabled">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                {t("scheduleEnabledBadge")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded px-2 py-0.5 text-xs font-medium bg-muted text-muted-foreground" data-testid="badge-schedule-disabled">
                <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />
                {t("scheduleDisabledBadge")}
              </span>
            )}
            <span>{t("dailyJobName")}</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {status?.extensionMissing && (
            <div className="flex items-start gap-2 text-sm rounded-md border border-amber-200 bg-amber-50 dark:bg-amber-950/40 dark:border-amber-900 px-3 py-2">
              <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5" />
              <span>{t("scheduleExtensionMissing")}</span>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
            <div>
              <div className="text-xs text-muted-foreground">{t("status")}</div>
              <div className="font-medium" data-testid="text-status">
                {loading
                  ? t("loading")
                  : !hasSession
                    ? "—"
                    : status?.enabled
                      ? t("scheduleRunningDaily")
                      : t("scheduleNotConfigured")}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("cronExpression")}</div>
              <div className="font-mono text-xs" data-testid="text-cron">
                {status?.schedule ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("jobid")}</div>
              <div className="font-mono text-xs">{status?.jobid ?? "—"}</div>
            </div>
          </div>

          <div className="space-y-2 pt-1">
            <label className="text-sm font-medium">{t("cronExpression")}</label>
            <Input
              value={cronInput}
              onChange={(e) => setCronInput(e.target.value)}
              placeholder={DEFAULT_CRON}
              className="font-mono max-w-xs"
              data-testid="input-cron"
            />
            <p className="text-[11px] text-muted-foreground">{t("cronExpressionHint")}</p>
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => performMutation("enable")}
              disabled={busy || loading || !!status?.extensionMissing}
              data-testid="button-enable"
            >
              <Power className="h-4 w-4 me-1" />
              {status?.enabled ? t("scheduleReapply") : t("scheduleEnable")}
            </Button>
            <Button
              variant="destructive"
              onClick={() => performMutation("disable")}
              disabled={busy || loading || !status?.enabled}
              data-testid="button-disable"
            >
              <PowerOff className="h-4 w-4 me-1" />
              {t("scheduleDisable")}
            </Button>
            <Button
              variant="secondary"
              onClick={() => performMutation("run-now")}
              disabled={busy || loading}
              data-testid="button-run-now"
            >
              <Play className="h-4 w-4 me-1" />
              {t("runNow")}
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">{t("runNowHelp")}</p>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("recentScheduleRuns")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("startedAt")}</th>
                  <th className="text-start py-2 px-3">{t("endedAt")}</th>
                  <th className="text-start py-2 px-3">{t("status")}</th>
                  <th className="text-start py-2 px-3">{t("runMessage")}</th>
                </tr>
              </thead>
              <tbody>
                {(!status || status.runs.length === 0) && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted-foreground">
                      {loading ? t("loading") : t("noScheduleRuns")}
                    </td>
                  </tr>
                )}
                {status?.runs.map((r) => (
                  <tr
                    key={r.runid}
                    className="border-b border-border/60"
                    data-testid={`row-run-${r.runid}`}
                  >
                    <td className="py-2 px-3 tabular-nums whitespace-nowrap">
                      {fmtDateTime(r.start_time, lang)}
                    </td>
                    <td className="py-2 px-3 tabular-nums whitespace-nowrap">
                      {r.end_time ? fmtDateTime(r.end_time, lang) : "—"}
                    </td>
                    <td className="py-2 px-3">
                      <span
                        className={
                          r.status === "succeeded"
                            ? "inline-flex rounded px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                            : "inline-flex rounded px-2 py-0.5 text-xs font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                        }
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="py-2 px-3 text-xs text-muted-foreground max-w-md truncate">
                      {r.return_message ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("recentHttpResults")}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40 text-muted-foreground">
                  <th className="text-start py-2 px-3">{t("sentAt")}</th>
                  <th className="text-start py-2 px-3">{t("httpStatus")}</th>
                  <th className="text-start py-2 px-3">{t("httpDetails")}</th>
                </tr>
              </thead>
              <tbody>
                {(!status?.httpResults || status.httpResults.length === 0) && (
                  <tr>
                    <td colSpan={3} className="py-6 text-center text-muted-foreground">
                      {loading ? t("loading") : t("noHttpResults")}
                    </td>
                  </tr>
                )}
                {status?.httpResults?.map((h) => {
                  const ok = h.status_code != null && h.status_code >= 200 && h.status_code < 300;
                  return (
                    <tr
                      key={h.id}
                      className="border-b border-border/60"
                      data-testid={`row-http-${h.id}`}
                    >
                      <td className="py-2 px-3 tabular-nums whitespace-nowrap">
                        {fmtDateTime(h.created, lang)}
                      </td>
                      <td className="py-2 px-3">
                        <span
                          className={
                            ok
                              ? "inline-flex rounded px-2 py-0.5 text-xs font-mono font-medium bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200"
                              : "inline-flex rounded px-2 py-0.5 text-xs font-mono font-medium bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200"
                          }
                        >
                          {h.status_code ?? t("error")}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-xs text-muted-foreground max-w-md truncate">
                        {h.error_msg ?? h.content_preview ?? "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={authOpen} onOpenChange={(o) => { if (!o) { setAuthOpen(false); setPendingAction(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {pendingAction === "enable"
                ? t("confirmEnableSchedule")
                : pendingAction === "disable"
                  ? t("confirmDisableSchedule")
                  : pendingAction === "run-now"
                    ? t("confirmRunNow")
                    : t("scheduleAuthTitle")}
            </DialogTitle>
            <DialogDescription>
              {pendingAction === "enable"
                ? t("confirmEnableScheduleHelp")
                : pendingAction === "disable"
                  ? t("confirmDisableScheduleHelp")
                  : pendingAction === "run-now"
                    ? t("confirmRunNowHelp")
                    : t("scheduleAuthHelp")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("password")}</label>
              <Input
                type="password"
                value={pwd}
                onChange={(e) => setPwd(e.target.value)}
                autoComplete="current-password"
                data-testid="input-confirm-password"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium">{t("totpCode")}</label>
              <Input
                inputMode="numeric"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                placeholder="123456"
                className="font-mono tracking-widest"
                data-testid="input-confirm-code"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setAuthOpen(false); setPendingAction(null); }}
              disabled={busy}
            >
              {t("cancel")}
            </Button>
            <Button
              onClick={submitAuth}
              disabled={busy || !pwd || code.length !== 6}
              variant={pendingAction === "disable" ? "destructive" : "default"}
              data-testid="button-confirm-submit"
            >
              {busy
                ? t("loading")
                : pendingAction === "enable"
                  ? t("scheduleEnable")
                  : pendingAction === "disable"
                    ? t("scheduleDisable")
                    : pendingAction === "run-now"
                      ? t("runNow")
                      : t("scheduleUnlock")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
