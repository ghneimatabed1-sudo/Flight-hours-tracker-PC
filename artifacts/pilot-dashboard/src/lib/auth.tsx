// LAN-only AuthProvider.
//
// Hawk Eye PC LAN ships without Supabase, without two-factor and without a
// remote license check. This provider keeps the same `AuthCtx` shape the
// rest of the app destructures (so all consumers compile unchanged) but
// wires every operation onto the internal Postgres LAN auth API exposed
// by `lib/internal-migration.ts`.
//
// What lives here:
//   * `login` -> POST /api/internal/auth/login (or /dev/session in no-auth)
//   * `logout` / `releaseLicense` / `resetThisPC` -> clear LAN session
//   * `configureSquadron` -> persist squadron tag to localStorage
//   * `pcRoleLock` / `pcLabel` -> per-PC operator preferences
//
// The cloud-era extra sign-in factors and recovery codes from the
// previous build were removed in task #318. Operators who lose the
// super admin password use `scripts/lan-host/reset-admin-password.ps1`
// on the host PC instead.

import { createContext, useContext, useEffect, useMemo, useState, ReactNode, useCallback } from "react";
import type { User } from "./types";
import {
  clearLanSessionToken,
  fetchLanSessionUser,
  isLanNoAuthEnabled,
  isLanSessionLoginEnabled,
  postLanDevSession,
  postLanLogin,
  postLanLogout,
  setStoredLanSessionToken,
} from "./internal-migration";
import { userFromLanAuthProfile } from "./lan-user-map";

// ---- Inactivity preference ----------------------------------------------
// Per-user-id preference (in minutes) for auto-logout after no input.
// 0 disables the timer entirely. Default 120 (2h).
const INACTIVITY_KEY_PREFIX = "rjaf.inactivityMin.";
export type InactivityMinutes = 0 | 15 | 30 | 60 | 120 | 240 | 480;
export const INACTIVITY_OPTIONS: InactivityMinutes[] = [0, 15, 30, 60, 120, 240, 480];

function readInactivityMinutes(userId: string | undefined): InactivityMinutes {
  if (!userId) return 120;
  const raw = localStorage.getItem(INACTIVITY_KEY_PREFIX + userId);
  const n = raw == null ? NaN : Number(raw);
  if (INACTIVITY_OPTIONS.includes(n as InactivityMinutes)) return n as InactivityMinutes;
  return 120;
}
function writeInactivityMinutes(userId: string | undefined, value: InactivityMinutes): void {
  if (!userId) return;
  localStorage.setItem(INACTIVITY_KEY_PREFIX + userId, String(value));
  inactivityListeners.forEach(fn => { try { fn(); } catch { /* ignore */ } });
}
const inactivityListeners = new Set<() => void>();
export function getInactivityMinutes(userId: string | undefined): InactivityMinutes {
  return readInactivityMinutes(userId);
}
export function setInactivityMinutes(userId: string | undefined, value: InactivityMinutes): void {
  writeInactivityMinutes(userId, value);
}

// ---- Per-PC preferences -------------------------------------------------
// Role lock: the super admin can pin a PC to a single role so the login
// screen only offers that role's form. Persisted per install.
const PC_ROLE_LOCK_KEY = "rjaf.pcRoleLock";
export type PcRoleLock = "ops" | "commander" | "super_admin" | null;
function readPcRoleLock(): PcRoleLock {
  const v = localStorage.getItem(PC_ROLE_LOCK_KEY);
  return v === "ops" || v === "commander" || v === "super_admin" ? v : null;
}
// Operator-friendly label for this PC ("Sqn-Ops-1" etc.). Optional.
const PC_LABEL_KEY = "rjaf.pcLabel";
function readPcLabel(): string {
  return (localStorage.getItem(PC_LABEL_KEY) ?? "").trim().slice(0, 48);
}

// ---- Squadron config ----------------------------------------------------
// The dashboard scopes most queries by the operator's squadron. The
// human-readable squadron tag is chosen on the Settings page and cached
// locally so the right header / NOTAM scope is applied immediately.
interface SquadronConfig {
  name: string;
  number: string;
  base: string;
}
const SQUADRON_KEY = "rjaf.squadron";
function readSquadron(): SquadronConfig | null {
  try {
    const raw = localStorage.getItem(SQUADRON_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed.name === "string") return parsed as SquadronConfig;
  } catch { /* ignore */ }
  return null;
}
function writeSquadron(cfg: SquadronConfig | null): void {
  if (cfg) localStorage.setItem(SQUADRON_KEY, JSON.stringify(cfg));
  else localStorage.removeItem(SQUADRON_KEY);
}

// ---- Hardware fingerprint ----------------------------------------------
// Stable per-install identifier surfaced in audit rows and registry pings.
// In LAN mode we just persist a UUID per install (no remote attestation).
const FINGERPRINT_KEY = "rjaf.pcFingerprint";
function readOrMintFingerprint(): string {
  let v = localStorage.getItem(FINGERPRINT_KEY);
  if (!v) {
    v = (crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)) + "-" + Date.now().toString(36);
    localStorage.setItem(FINGERPRINT_KEY, v);
  }
  return v;
}

// ---- Public types -------------------------------------------------------
interface AuthState {
  licensed: boolean;
  configured: boolean;
  user: User | null;
  squadron: SquadronConfig | null;
  fingerprint: string;
  failedAttempts: number;
  lockedUntil: number | null;
}

interface LoginResult {
  ok: boolean;
  error?: string;
}

interface AuthCtx extends AuthState {
  silentAuthError: string | null;
  clearSilentAuthError: () => void;
  // Licensing was a Supabase-era concept. In LAN mode the license is
  // implicit: install the host on the squadron PC and you are licensed.
  // The method is preserved as a no-op success so legacy callers compile.
  activateLicense: (key: string, username: string) => Promise<{ ok: boolean; error?: string }>;
  configureSquadron: (cfg: SquadronConfig) => void;
  login: (username: string, password: string) => Promise<LoginResult>;
  // LAN dev "no auth" quick login for engineers iterating against an
  // empty database. Gated by VITE_LAN_NO_AUTH=1 and the matching server
  // flag. In production both flags should be 0.
  lanDevQuickLogin: (
    kind: "super_admin" | "ops" | "commander",
  ) => Promise<{ ok: boolean; error?: string }>;
  // Super admin password lifecycle. In LAN mode the canonical reset path
  // is the host-side PowerShell script — the in-app surface is preserved
  // for backwards compatibility but always returns lan_mode_use_script.
  changeSuperAdminPassword: (
    currentPassword: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  provisionSuperAdmin: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  resetSuperAdminPasswordWithMaster: (
    masterPassword: string,
    newPassword: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
  releaseLicense: () => void;
  resetThisPC: () => Promise<void>;
  backendMode: "lan";
  pcRoleLock: PcRoleLock;
  setPcRoleLock: (v: PcRoleLock) => void;
  adminProvisioned: boolean;
  pcLabel: string;
  setPcLabel: (v: string) => void;
  inactivityMinutes: InactivityMinutes;
  setInactivityMinutes: (v: InactivityMinutes) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [squadron, setSquadronState] = useState<SquadronConfig | null>(() => readSquadron());
  const [fingerprint] = useState<string>(() => readOrMintFingerprint());
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [silentAuthError, setSilentAuthError] = useState<string | null>(null);
  const [pcRoleLock, setPcRoleLockState] = useState<PcRoleLock>(() => readPcRoleLock());
  const [pcLabel, setPcLabelState] = useState<string>(() => readPcLabel());
  const [inactivityMin, setInactivityMin] = useState<InactivityMinutes>(
    () => readInactivityMinutes(undefined),
  );

  // Keep the inactivity preference in sync with the signed-in user.
  useEffect(() => {
    setInactivityMin(readInactivityMinutes(user?.id ?? undefined));
    const off = (() => {
      const fn = () => setInactivityMin(readInactivityMinutes(user?.id ?? undefined));
      inactivityListeners.add(fn);
      return () => { inactivityListeners.delete(fn); };
    })();
    return off;
  }, [user?.id]);

  // On boot, attempt to recover a still-valid LAN session from the
  // browser-side token (httpOnly cookie also works on real installs).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!isLanSessionLoginEnabled() && !isLanNoAuthEnabled()) return;
      try {
        const r = await fetchLanSessionUser();
        if (cancelled) return;
        if (r.ok && r.user) {
          setUser(userFromLanAuthProfile(r.user, r.user.username));
        }
      } catch (e) {
        if (!cancelled) setSilentAuthError(e instanceof Error ? e.message : "lan_session_recovery_failed");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const setSquadron = useCallback((cfg: SquadronConfig) => {
    writeSquadron(cfg);
    setSquadronState(cfg);
  }, []);

  const login = useCallback<AuthCtx["login"]>(async (username, password) => {
    if (lockedUntil && lockedUntil > Date.now()) {
      return { ok: false, error: "locked" };
    }
    try {
      const r = await postLanLogin(username, password);
      if (!r.ok) {
        const next = failedAttempts + 1;
        setFailedAttempts(next);
        if (next >= 5) setLockedUntil(Date.now() + 60_000);
        return { ok: false, error: r.error ?? "invalid_credentials" };
      }
      setStoredLanSessionToken(r.token);
      const profile = await fetchLanSessionUser();
      if (!profile.ok || !profile.user) {
        return { ok: false, error: "session_load_failed" };
      }
      setUser(userFromLanAuthProfile(profile.user, profile.user.username));
      setFailedAttempts(0);
      setLockedUntil(null);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "login_failed" };
    }
  }, [failedAttempts, lockedUntil]);

  const lanDevQuickLogin = useCallback<AuthCtx["lanDevQuickLogin"]>(async (kind) => {
    if (!isLanNoAuthEnabled()) return { ok: false, error: "lan_no_auth_disabled" };
    try {
      const r = await postLanDevSession(kind);
      if (!r.ok) return { ok: false, error: r.error ?? "dev_session_failed" };
      setStoredLanSessionToken(r.token);
      const profile = await fetchLanSessionUser();
      if (!profile.ok || !profile.user) return { ok: false, error: "session_load_failed" };
      setUser(userFromLanAuthProfile(profile.user, profile.user.username));
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "dev_session_failed" };
    }
  }, []);

  const logout = useCallback(() => {
    void postLanLogout().catch(() => { /* best-effort */ });
    clearLanSessionToken();
    setUser(null);
  }, []);

  const releaseLicense = useCallback(() => {
    // No remote license to release in LAN mode; treat as a sign-out.
    logout();
  }, [logout]);

  const resetThisPC = useCallback(async () => {
    try {
      try { await postLanLogout(); } catch { /* ignore */ }
      clearLanSessionToken();
      const keys: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith("rjaf.")) keys.push(k);
      }
      keys.forEach(k => localStorage.removeItem(k));
      setUser(null);
      setSquadronState(null);
      setPcRoleLockState(null);
      setPcLabelState("");
    } finally {
      setTimeout(() => { try { window.location.reload(); } catch { /* ignore */ } }, 50);
    }
  }, []);

  const clearSilentAuthError = useCallback(() => setSilentAuthError(null), []);

  const ctx: AuthCtx = useMemo(() => ({
    licensed: true,
    configured: !!squadron,
    user,
    squadron,
    fingerprint,
    failedAttempts,
    lockedUntil,
    silentAuthError,
    clearSilentAuthError,
    activateLicense: async () => ({ ok: true }),
    configureSquadron: setSquadron,
    login,
    lanDevQuickLogin,
    changeSuperAdminPassword: async () => ({ ok: false, error: "lan_mode_use_powershell_script" }),
    provisionSuperAdmin: async () => ({ ok: false, error: "lan_mode_use_powershell_script" }),
    resetSuperAdminPasswordWithMaster: async () => ({ ok: false, error: "lan_mode_use_powershell_script" }),
    logout,
    releaseLicense,
    resetThisPC,
    backendMode: "lan",
    pcRoleLock,
    setPcRoleLock: (v) => {
      if (v) localStorage.setItem(PC_ROLE_LOCK_KEY, v);
      else localStorage.removeItem(PC_ROLE_LOCK_KEY);
      setPcRoleLockState(v);
    },
    adminProvisioned: true,
    pcLabel,
    setPcLabel: (v) => {
      const trimmed = v.trim().slice(0, 48);
      if (trimmed) localStorage.setItem(PC_LABEL_KEY, trimmed);
      else localStorage.removeItem(PC_LABEL_KEY);
      setPcLabelState(trimmed);
    },
    inactivityMinutes: inactivityMin,
    setInactivityMinutes: (v) => {
      writeInactivityMinutes(user?.id ?? undefined, v);
      setInactivityMin(v);
    },
  }), [user, squadron, fingerprint, failedAttempts, lockedUntil, silentAuthError, clearSilentAuthError, login, lanDevQuickLogin, logout, releaseLicense, resetThisPC, pcRoleLock, pcLabel, inactivityMin, setSquadron]);

  return <Ctx.Provider value={ctx}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be used inside <AuthProvider>");
  return v;
}
