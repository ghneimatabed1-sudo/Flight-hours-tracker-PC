import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { KeyRound, ShieldCheck, ShieldAlert, RefreshCw, Lock, Monitor } from "lucide-react";
import type { PcRoleLock } from "@/lib/auth";

export default function AdminSecurity() {
  const { t } = useI18n();
  const { adminTotpEnrolled, regenerateRecoveryCodes, changeSuperAdminPassword, backendMode, pcRoleLock, setPcRoleLock } = useAuth();

  // Local editable copy of the PC role lock so the super admin can preview
  // the choice before applying. Initialized from the persisted value.
  const [lockDraft, setLockDraft] = useState<PcRoleLock>(pcRoleLock);
  const [lockSaved, setLockSaved] = useState(false);
  const lockOptionLabel = (v: PcRoleLock): string => {
    if (v === "ops") return t("roleLockOps");
    if (v === "commander") return t("roleLockCommander");
    if (v === "super_admin") return t("roleLockSuperAdmin");
    return t("roleLockNone");
  };
  const applyLock = () => {
    setPcRoleLock(lockDraft);
    setLockSaved(true);
    window.setTimeout(() => setLockSaved(false), 3000);
  };
  const clearLock = () => {
    setPcRoleLock(null);
    setLockDraft(null);
    setLockSaved(true);
    window.setTimeout(() => setLockSaved(false), 3000);
  };

  const [pwCurrent, setPwCurrent] = useState("");
  const [pwNew, setPwNew] = useState("");
  const [pwConfirm, setPwConfirm] = useState("");
  const [pwBusy, setPwBusy] = useState(false);
  const [pwErr, setPwErr] = useState<string | null>(null);
  const [pwOk, setPwOk] = useState(false);
  const pwServerManaged = backendMode === "supabase";

  const [open, setOpen] = useState(false);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [newCodes, setNewCodes] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(false);

  // In Supabase mode `adminTotpEnrolled` is only flipped after a fresh
  // verify-step in this browser session (it's not persisted to localStorage),
  // so an admin who's already signed in but hasn't re-verified during this
  // page load would falsely look "not enrolled". Their session itself is
  // proof of enrollment, so we trust signed-in super_admins here.
  const enrolled = adminTotpEnrolled || backendMode === "supabase";

  const reset = () => {
    setCode("");
    setErr(null);
    setBusy(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErr(null);
    const res = await regenerateRecoveryCodes(code);
    setBusy(false);
    if (!res.ok) {
      if (res.error === "locked") setErr(t("regenerateLocked"));
      else if (res.error === "not_enrolled") setErr(t("regenerateNotEnrolled"));
      else setErr(t("regenerateBadCode"));
      return;
    }
    setNewCodes(res.recoveryCodes ?? []);
    setOpen(false);
    reset();
  };

  const copyCodes = async () => {
    if (!newCodes) return;
    try {
      await navigator.clipboard.writeText(newCodes.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch { /* no-op */ }
  };
  const downloadCodes = () => {
    if (!newCodes) return;
    const header = "RJAF Pilot Dashboard — Super Admin recovery codes\n" +
      "Regenerated: " + new Date().toISOString() + "\n" +
      "Keep these somewhere safe. Each one works only once.\n\n";
    const blob = new Blob([header + newCodes.join("\n") + "\n"], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "rjaf-admin-recovery-codes.txt";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const submitPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (pwBusy) return;
    setPwErr(null);
    setPwOk(false);
    if (pwNew.length < 8) { setPwErr(t("pwTooShort")); return; }
    if (pwNew !== pwConfirm) { setPwErr(t("pwMismatch")); return; }
    setPwBusy(true);
    const res = await changeSuperAdminPassword(pwCurrent, pwNew);
    setPwBusy(false);
    if (!res.ok) {
      if (res.error === "bad_current") setPwErr(t("pwBadCurrent"));
      else if (res.error === "too_short") setPwErr(t("pwTooShort"));
      else if (res.error === "same") setPwErr(t("pwSame"));
      else if (res.error === "server_managed") setPwErr(t("pwServerManaged"));
      else setPwErr(t("pwGenericError"));
      return;
    }
    setPwCurrent(""); setPwNew(""); setPwConfirm("");
    setPwOk(true);
    window.setTimeout(() => setPwOk(false), 4000);
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">{t("securityTitle")}</h2>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            {t("roleLockTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">{t("roleLockDesc")}</p>
          {pcRoleLock && (
            <div className="rounded-md border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-200 mb-3" data-testid="text-role-lock-active">
              <span className="opacity-80">{t("roleLockActiveBadge")} </span>
              <span className="font-semibold">{lockOptionLabel(pcRoleLock)}</span>
            </div>
          )}
          <div className="space-y-3 max-w-md">
            <div>
              <label className="text-xs text-muted-foreground">{t("roleLockCurrentLabel")}</label>
              <select
                data-testid="select-role-lock"
                value={lockDraft ?? ""}
                onChange={e => {
                  const v = e.target.value;
                  setLockDraft(v === "" ? null : (v as PcRoleLock));
                  setLockSaved(false);
                }}
                className="w-full mt-1 px-3 py-2 rounded-md bg-input border border-border text-sm"
              >
                <option value="">{t("roleLockNone")}</option>
                <option value="ops">{t("roleLockOps")}</option>
                <option value="commander">{t("roleLockCommander")}</option>
                <option value="super_admin">{t("roleLockSuperAdmin")}</option>
              </select>
            </div>
            {lockSaved && <p className="text-xs text-emerald-400" data-testid="text-role-lock-saved">{t("roleLockSaved")}</p>}
            <div className="flex gap-2">
              <Button
                type="button"
                data-testid="button-role-lock-apply"
                onClick={applyLock}
                disabled={lockDraft === pcRoleLock}
              >
                {t("roleLockSaveBtn")}
              </Button>
              {pcRoleLock && (
                <Button
                  type="button"
                  variant="outline"
                  data-testid="button-role-lock-clear"
                  onClick={clearLock}
                >
                  {t("roleLockClearBtn")}
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            {t("changePasswordTitle")}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-xs text-muted-foreground mb-3">{t("changePasswordBlurb")}</p>
          {pwServerManaged ? (
            <div className="rounded-md border border-amber-600/40 bg-amber-500/10 p-3 text-xs text-amber-200">
              {t("pwServerManaged")}
            </div>
          ) : (
            <form onSubmit={submitPassword} className="space-y-3 max-w-md">
              <div>
                <label className="text-xs text-muted-foreground">{t("currentPassword")}</label>
                <Input
                  type="password"
                  autoComplete="current-password"
                  value={pwCurrent}
                  onChange={e => { setPwCurrent(e.target.value); setPwErr(null); setPwOk(false); }}
                  data-testid="input-admin-password-current"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("newPassword")}</label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={pwNew}
                  onChange={e => { setPwNew(e.target.value); setPwErr(null); setPwOk(false); }}
                  data-testid="input-admin-password-new"
                />
                <p className="text-[11px] text-muted-foreground mt-1">{t("pwMinHint")}</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground">{t("confirmPassword")}</label>
                <Input
                  type="password"
                  autoComplete="new-password"
                  value={pwConfirm}
                  onChange={e => { setPwConfirm(e.target.value); setPwErr(null); setPwOk(false); }}
                  data-testid="input-admin-password-confirm"
                />
              </div>
              {pwErr && <p className="text-xs text-destructive" data-testid="text-admin-password-error">{pwErr}</p>}
              {pwOk && <p className="text-xs text-emerald-400" data-testid="text-admin-password-ok">✔ {t("pwUpdated")}</p>}
              <Button type="submit" disabled={pwBusy || !pwCurrent || !pwNew || !pwConfirm} data-testid="button-admin-password-submit">
                {pwBusy ? t("saving") : t("updatePassword")}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5" />
            {t("twoFactorSection")}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className="flex items-center gap-2 text-sm"
            data-testid="text-2fa-status"
          >
            {enrolled ? (
              <>
                <ShieldCheck className="h-4 w-4 text-emerald-500" />
                <span>{t("twoFactorEnrolledStatus")}</span>
              </>
            ) : (
              <>
                <ShieldAlert className="h-4 w-4 text-amber-500" />
                <span>{t("twoFactorNotEnrolledStatus")}</span>
              </>
            )}
          </div>

          <div className="rounded-md border border-border p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium">
              <KeyRound className="h-4 w-4" />
              {t("regenerateRecoveryCodesTitle")}
            </div>
            <p className="text-xs text-muted-foreground">
              {t("regenerateRecoveryCodesDesc")}
            </p>
            <Button
              variant="outline"
              disabled={!enrolled}
              onClick={() => { reset(); setOpen(true); }}
              data-testid="button-open-regenerate"
            >
              <RefreshCw className="h-4 w-4 me-2" />
              {t("regenerateRecoveryCodesBtn")}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) reset(); }}>
        <DialogContent data-testid="dialog-regenerate-confirm">
          <DialogHeader>
            <DialogTitle>{t("regenerateConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("regenerateConfirmHint")}</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-3">
            <Input
              autoFocus
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              value={code}
              onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(null); }}
              placeholder="000000"
              className="font-mono tracking-widest text-center text-lg"
              data-testid="input-regenerate-code"
            />
            {err && (
              <p className="text-xs text-destructive" data-testid="text-regenerate-error">{err}</p>
            )}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => { setOpen(false); reset(); }}
                data-testid="button-cancel-regenerate"
              >
                {t("cancel")}
              </Button>
              <Button
                type="submit"
                disabled={code.length !== 6 || busy}
                data-testid="button-confirm-regenerate"
              >
                {t("regenerateConfirmBtn")}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!newCodes} onOpenChange={(o) => { if (!o) setNewCodes(null); }}>
        <DialogContent data-testid="dialog-regenerate-result">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-4 w-4 text-amber-500" />
              {t("regenerateNewCodesTitle")}
            </DialogTitle>
            <DialogDescription>{t("regenerateNewCodesHint")}</DialogDescription>
          </DialogHeader>
          <div
            data-testid="list-new-recovery-codes"
            className="grid grid-cols-2 gap-2 p-3 rounded-md bg-muted border border-border font-mono text-sm tracking-wider select-all"
          >
            {(newCodes ?? []).map((c, i) => (
              <div key={i} className="py-0.5" data-testid={`text-new-recovery-code-${i}`}>{c}</div>
            ))}
          </div>
          <p className="text-[11px] text-amber-500">{t("recoveryCodesWarn")}</p>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={copyCodes}
              data-testid="button-copy-new-recovery-codes"
            >
              {copied ? t("copied") : t("copy")}
            </Button>
            <Button
              variant="outline"
              onClick={downloadCodes}
              data-testid="button-download-new-recovery-codes"
            >
              {t("download")}
            </Button>
            <Button
              onClick={() => setNewCodes(null)}
              data-testid="button-ack-new-recovery-codes"
            >
              {t("done")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
