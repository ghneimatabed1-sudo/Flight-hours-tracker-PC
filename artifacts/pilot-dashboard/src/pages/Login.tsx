// LAN-only login screen.
//
// Hawk Eye PC LAN does not use Supabase, two-factor codes or recovery
// codes. The operator picks an account name, types the password and
// signs in against the local Postgres-backed `lan_users` table via
// `auth.login()`.
//
// When `VITE_LAN_NO_AUTH=1` is set (engineering builds against an empty
// database) three quick-login shortcuts mint a session for a baked-in
// super_admin / ops / commander persona without any password check.
// Both flags must be off in any production install.

import { useEffect, useState } from "react";
import { useAuth } from "@/lib/auth";
import { isLanNoAuthEnabled } from "@/lib/internal-migration";
import { useI18n } from "@/lib/i18n";
import { useIdleTimeout } from "@/lib/use-idle-timeout";
import LockScreen from "@/components/LockScreen";
import { useInstallProfile } from "@/lib/install-profile";
import { Languages, KeyRound, Lock, AlertTriangle } from "lucide-react";

// `VITE_EXPECTED_INSTALL_PROFILE` is baked into the build (the operator
// pins it during install). When set, we compare it against the value
// the running api-server reports through `/api/healthz` and warn on
// the login screen if the two disagree — that's the earliest the
// operator can catch an INSTALL_PROFILE drift before signing in and
// touching data.
const EXPECTED_INSTALL_PROFILE: string = (() => {
  try {
    if (typeof import.meta === "undefined") return "";
    const env = (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env;
    const raw = String(env?.VITE_EXPECTED_INSTALL_PROFILE ?? "").trim();
    return raw;
  } catch {
    return "";
  }
})();

// 1 hour of no input on the login page → screensaver. Stops a PC left
// open overnight from sitting on the credentials prompt forever.
const LOGIN_AUTO_LOCK_MS = 60 * 60 * 1000;

export default function LoginGate() {
  const {
    user, login, lanDevQuickLogin,
    failedAttempts, lockedUntil,
    pcRoleLock,
    silentAuthError, clearSilentAuthError,
  } = useAuth();
  const { t, lang, setLang, dir } = useI18n();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [screenLocked, setScreenLocked] = useState(false);
  useIdleTimeout(LOGIN_AUTO_LOCK_MS, () => setScreenLocked(true));

  const lanNoAuth = isLanNoAuthEnabled();
  const installProfileState = useInstallProfile();
  const profileMismatch =
    EXPECTED_INSTALL_PROFILE !== "" &&
    installProfileState.loaded &&
    installProfileState.profile !== EXPECTED_INSTALL_PROFILE;

  useEffect(() => {
    if (user) {
      // The signed-in user state is owned by AuthProvider and the routing
      // tree above us will mount the dashboard automatically.
      setSubmitting(false);
    }
  }, [user]);

  useEffect(() => {
    setErrorMsg(null);
  }, [username, password]);

  if (screenLocked) {
    return <LockScreen onUnlock={() => setScreenLocked(false)} />;
  }

  const isLockedNow = lockedUntil != null && lockedUntil > Date.now();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    const r = await login(username.trim(), password);
    if (!r.ok) {
      setErrorMsg(r.error ?? "invalid_credentials");
    }
    setSubmitting(false);
  }

  async function onQuickLogin(kind: "super_admin" | "ops" | "commander") {
    if (submitting) return;
    setSubmitting(true);
    setErrorMsg(null);
    const r = await lanDevQuickLogin(kind);
    if (!r.ok) setErrorMsg(r.error ?? "quick_login_failed");
    setSubmitting(false);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100" dir={dir}>
      <div className="mx-auto max-w-md p-6 space-y-4 pt-16">
        <header className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Hawk Eye</h1>
            <p className="text-xs text-zinc-400">{t("appNameSub")}</p>
          </div>
          <button
            type="button"
            className="text-xs inline-flex items-center gap-1 text-zinc-400 hover:text-zinc-100"
            onClick={() => setLang(lang === "en" ? "ar" : "en")}
            data-testid="button-toggle-lang"
          >
            <Languages className="h-4 w-4" />
            {lang === "en" ? "العربية" : "English"}
          </button>
        </header>

        {pcRoleLock && (
          <div className="rounded border border-zinc-800 bg-zinc-900/50 px-3 py-2 text-xs text-zinc-400">
            {t("roleLockedTo")}: <span className="font-medium text-zinc-100">{pcRoleLock}</span>
          </div>
        )}

        {profileMismatch && (
          <div
            className="rounded border border-red-700/50 bg-red-950/40 px-3 py-2 text-xs text-red-200"
            data-testid="banner-install-profile-mismatch"
          >
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-red-300" />
              <div>
                <div className="font-semibold">{t("login_profile_mismatch_title")}</div>
                <div className="mt-1">
                  {t("login_profile_mismatch_body")
                    .replace("{expected}", EXPECTED_INSTALL_PROFILE)
                    .replace("{actual}", installProfileState.profile)}
                </div>
              </div>
            </div>
          </div>
        )}

        {silentAuthError && (
          <div className="rounded border border-amber-700/40 bg-amber-950/40 px-3 py-2 text-xs text-amber-200">
            <div className="flex items-start justify-between gap-2">
              <span>{silentAuthError}</span>
              <button
                type="button"
                className="text-amber-300 hover:text-amber-100"
                onClick={clearSilentAuthError}
                data-testid="button-dismiss-silent-error"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <form onSubmit={onSubmit} className="space-y-3 rounded border border-zinc-800 bg-zinc-900/40 p-4">
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400" htmlFor="login-username">{t("username")}</label>
            <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2">
              <KeyRound className="h-4 w-4 text-zinc-500" />
              <input
                id="login-username"
                type="text"
                autoComplete="username"
                className="flex-1 bg-transparent py-2 outline-none text-sm"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={submitting || isLockedNow}
                data-testid="input-login-username"
              />
            </div>
          </div>
          <div className="space-y-1.5">
            <label className="text-xs text-zinc-400" htmlFor="login-password">{t("password")}</label>
            <div className="flex items-center gap-2 rounded border border-zinc-800 bg-zinc-950 px-2">
              <Lock className="h-4 w-4 text-zinc-500" />
              <input
                id="login-password"
                type="password"
                autoComplete="current-password"
                className="flex-1 bg-transparent py-2 outline-none text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={submitting || isLockedNow}
                data-testid="input-login-password"
              />
            </div>
          </div>

          {errorMsg && (
            <div className="text-xs text-red-300" data-testid="text-login-error">
              {errorMsg}
            </div>
          )}

          {failedAttempts > 0 && !isLockedNow && (
            <div className="text-xs text-zinc-400">
              {t("loginFailedAttempts")}: {failedAttempts}
            </div>
          )}

          {isLockedNow && (
            <div className="text-xs text-amber-300">
              {t("authLocked")}
            </div>
          )}

          <button
            type="submit"
            className="w-full rounded bg-zinc-100 px-3 py-2 text-sm font-medium text-zinc-900 hover:bg-white disabled:opacity-50"
            disabled={submitting || isLockedNow || !username || !password}
            data-testid="button-login-submit"
          >
            {submitting ? t("loading") : t("signIn")}
          </button>
        </form>

        {lanNoAuth && (
          <div className="space-y-2 rounded border border-amber-700/40 bg-amber-950/30 p-3">
            <div className="text-xs text-amber-200">
              {t("lanNoAuthDevModeHint")}
            </div>
            <div className="grid grid-cols-3 gap-2">
              <button
                type="button"
                className="rounded border border-amber-700/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
                onClick={() => onQuickLogin("super_admin")}
                disabled={submitting}
                data-testid="button-quick-super-admin"
              >
                super_admin
              </button>
              <button
                type="button"
                className="rounded border border-amber-700/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
                onClick={() => onQuickLogin("ops")}
                disabled={submitting}
                data-testid="button-quick-ops"
              >
                ops
              </button>
              <button
                type="button"
                className="rounded border border-amber-700/50 px-2 py-1 text-xs text-amber-100 hover:bg-amber-900/40 disabled:opacity-50"
                onClick={() => onQuickLogin("commander")}
                disabled={submitting}
                data-testid="button-quick-commander"
              >
                commander
              </button>
            </div>
          </div>
        )}

        <footer className="pt-4 text-center text-[11px] text-zinc-500">
          Hawk Eye LAN — Royal Jordanian Air Force Squadron Operations
        </footer>
      </div>
    </div>
  );
}
