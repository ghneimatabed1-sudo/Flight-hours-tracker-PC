// LAN-only Security admin page.
//
// Cloud-era extra sign-in factors and remote-managed super admin
// password are gone. The remaining knobs are:
//   * Per-PC role lock (squadron PC pinned to ops / commander / super_admin)
//   * Operator-friendly PC label
//   * Documentation pointing operators at the host-side PowerShell helpers
//     for password resets
//
// The full live-fire reset path lives in
// `scripts/lan-host/reset-admin-password.ps1`.

import { useState } from "react";
import { useAuth, type PcRoleLock } from "@/lib/auth";
import { useI18n } from "@/lib/i18n";
import { ShieldCheck, Lock, KeyRound, Pencil } from "lucide-react";

export default function Security() {
  const { t } = useI18n();
  const { backendMode, pcRoleLock, setPcRoleLock, pcLabel, setPcLabel } = useAuth();

  const [labelDraft, setLabelDraft] = useState(pcLabel);
  const [labelSaved, setLabelSaved] = useState(false);

  function commitLabel() {
    setPcLabel(labelDraft.trim());
    setLabelSaved(true);
    setTimeout(() => setLabelSaved(false), 1500);
  }

  function commitRoleLock(v: PcRoleLock) {
    setPcRoleLock(v);
  }

  return (
    <div className="space-y-6 max-w-3xl" data-testid="page-security">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold flex items-center gap-2">
          <ShieldCheck className="h-5 w-5" />
          {t("securityTitle")}
        </h1>
        <p className="text-sm text-zinc-400">
          {t("securityLanIntro")}
        </p>
      </header>

      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3" data-testid="section-backend-mode">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Lock className="h-4 w-4 text-zinc-400" />
          {t("backendModeTitle")}
        </h2>
        <div className="text-xs text-zinc-300">
          {t("backendModeLabel")}: <span className="font-mono">{backendMode}</span>
        </div>
        <p className="text-xs text-zinc-500">
          {t("backendModeLanHint")}
        </p>
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3" data-testid="section-role-lock">
        <h2 className="text-sm font-medium">{t("pcRoleLockTitle")}</h2>
        <p className="text-xs text-zinc-500">{t("pcRoleLockHint")}</p>
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {(["super_admin", "commander", "ops"] as const).map((r) => (
            <button
              key={r}
              type="button"
              className={
                "rounded border px-2 py-1 text-xs " +
                (pcRoleLock === r
                  ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                  : "border-zinc-700 text-zinc-300 hover:bg-zinc-800")
              }
              onClick={() => commitRoleLock(r)}
              data-testid={`button-role-lock-${r}`}
            >
              {r}
            </button>
          ))}
          <button
            type="button"
            className={
              "rounded border px-2 py-1 text-xs " +
              (pcRoleLock === null
                ? "border-zinc-100 bg-zinc-100 text-zinc-900"
                : "border-zinc-700 text-zinc-300 hover:bg-zinc-800")
            }
            onClick={() => commitRoleLock(null)}
            data-testid="button-role-lock-clear"
          >
            {t("pcRoleLockClear")}
          </button>
        </div>
        <div className="text-xs text-zinc-400 pt-1">
          {t("pcRoleLockCurrent")}: <span className="font-mono">{pcRoleLock ?? t("none")}</span>
        </div>
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3" data-testid="section-pc-label">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <Pencil className="h-4 w-4 text-zinc-400" />
          {t("pcLabelTitle")}
        </h2>
        <p className="text-xs text-zinc-500">{t("pcLabelHint")}</p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm outline-none"
            maxLength={48}
            value={labelDraft}
            onChange={(e) => setLabelDraft(e.target.value)}
            placeholder="Sqn-Ops-1"
            data-testid="input-pc-label"
          />
          <button
            type="button"
            className="rounded bg-zinc-100 px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-white"
            onClick={commitLabel}
            data-testid="button-save-pc-label"
          >
            {t("save")}
          </button>
        </div>
        {labelSaved && (
          <div className="text-xs text-emerald-300" data-testid="text-pc-label-saved">
            {t("saved")}
          </div>
        )}
      </section>

      <section className="rounded border border-zinc-800 bg-zinc-900/40 p-4 space-y-3" data-testid="section-password-reset">
        <h2 className="text-sm font-medium flex items-center gap-2">
          <KeyRound className="h-4 w-4 text-zinc-400" />
          {t("changePasswordTitle")}
        </h2>
        <p className="text-xs text-zinc-500">{t("lanPasswordResetIntro")}</p>
        <pre className="rounded border border-zinc-800 bg-zinc-950 p-2 text-[11px] text-zinc-300 overflow-x-auto" data-testid="text-reset-script-path">
{`PS C:\\\\hawk-eye> .\\scripts\\lan-host\\reset-admin-password.ps1`}
        </pre>
        <p className="text-[11px] text-zinc-500">{t("lanPasswordResetWho")}</p>
      </section>
    </div>
  );
}
