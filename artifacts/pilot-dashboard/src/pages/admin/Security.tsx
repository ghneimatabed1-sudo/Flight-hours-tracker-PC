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
import { KeyRound, ShieldCheck, ShieldAlert, RefreshCw } from "lucide-react";

export default function AdminSecurity() {
  const { t } = useI18n();
  const { adminTotpEnrolled, regenerateRecoveryCodes, backendMode } = useAuth();

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

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">{t("securityTitle")}</h2>

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
