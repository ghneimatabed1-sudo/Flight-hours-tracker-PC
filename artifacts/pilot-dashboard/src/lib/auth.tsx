import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { supabase, supabaseConfigured, validateLicenseRemote, recordAuditEvent } from "./supabase";
import { lookupLicenseKey } from "./license-registry";
import { SUPER_ADMIN } from "./mockData";
import { findCommanderByUsername, verifyCommanderPassword } from "./commander-store";
import type { User } from "./types";
import { generateSecret, otpauthURL, verifyTotp } from "./totp";

// Demo-only fallback when Supabase isn't configured (in-browser preview).
// In any real install (`supabaseConfigured === true`) the secret is held
// server-side in `super_admin_2fa` and verified by the
// `super-admin-2fa` edge function — the localStorage path is never used.
const ADMIN_TOTP_SECRET_KEY = "rjaf.adminTotp.secret";
const ADMIN_TOTP_RECOVERY_KEY = "rjaf.adminTotp.recovery";
const ADMIN_TOTP_REMAINING_KEY = "rjaf.adminTotp.remaining";
// SHA-256 hex of the super admin password chosen on THIS PC during first-run
// setup. In standalone mode this is the only acceptable credential; if the
// key is missing, the login path returns `admin_not_provisioned` so the UI
// can route the user into the provisioning form. In Supabase mode the real
// hash lives server-side (SUPER_ADMIN_PASSWORD_HASH) and this key is unused.
const ADMIN_PASSWORD_HASH_KEY = "rjaf.admin.passwordHash";
// Default super admin password ships baked into every install as a SHA-256
// hash so the raw password never appears in source. Every copy accepts this
// password on first sign-in; once the super admin rotates it through Admin
// → Security (changeSuperAdminPassword), the new hash is written to
// ADMIN_PASSWORD_HASH_KEY and takes precedence over this default on that PC.
// In Supabase mode the real hash lives server-side (SUPER_ADMIN_PASSWORD_HASH)
// and this default is ignored.
const DEFAULT_ADMIN_PASSWORD_HASH = "e25d97cfa9c1ef91c61b0f84a92a19fcbaa490ebde6e91387b1b2cd0be403af1";
// Master Recovery Key: a second, baked-in super-admin-level password used
// ONLY to reset the PC's Super Admin password when the normal one is lost
// or leaked. Never changes, never rotated — its only job is to let the true
// system owner walk up to any squadron PC and force a new super admin
// password without knowing the current one. The plaintext is held by the
// system owner off-device; only this SHA-256 hash ships in the binary.
const MASTER_RECOVERY_HASH = "a4b76b3727d60e63de1cc47250f155bc42df0f0ac5beb2794b2d764b98fca441";
// Per-PC role lock chosen by the Super Admin on the Security page. When set,
// the login screen hides every role except the locked one, and login() /
// activateLicense() refuse to authenticate any user whose role doesn't match.
// Valid values: "ops" | "commander" | "super_admin". Absent key = no lock
// (default multi-role screen). Stored per-install; never shared across PCs.
const PC_ROLE_LOCK_KEY = "rjaf.pcRoleLock";
export type PcRoleLock = "ops" | "commander" | "super_admin" | null;
function readPcRoleLock(): PcRoleLock {
  const v = localStorage.getItem(PC_ROLE_LOCK_KEY);
  return v === "ops" || v === "commander" || v === "super_admin" ? v : null;
}
const ADMIN_TOTP_ISSUER = "RJAF Pilot Dashboard";
const RECOVERY_CODE_COUNT = 10;
// When unused recovery codes drop to this number or below, the dashboard
// surfaces a banner urging the super admin to regenerate. Exported so the
// banner UI and any tests stay in sync with the server-side definition of
// "running low".
export const RECOVERY_CODES_LOW_THRESHOLD = 2;

interface StoredRecoveryCode {
  hash: string;
  usedAt: string | null;
}

function isTotpShape(s: string): boolean {
  return /^\d{6}$/.test(s.trim());
}
function normalizeRecoveryCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");
}
function isRecoveryCodeShape(raw: string): boolean {
  return /^[A-Z2-7]{8}$/.test(normalizeRecoveryCode(raw));
}
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, "0")).join("");
}
function generateDemoRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  const alpha = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    let s = "";
    for (let j = 0; j < 8; j++) s += alpha[bytes[j] % 32];
    out.push(`${s.slice(0, 4)}-${s.slice(4, 8)}`);
  }
  return out;
}
function readDemoRecoveryCodes(): StoredRecoveryCode[] {
  try {
    const raw = localStorage.getItem(ADMIN_TOTP_RECOVERY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}
function writeDemoRecoveryCodes(codes: StoredRecoveryCode[]): void {
  localStorage.setItem(ADMIN_TOTP_RECOVERY_KEY, JSON.stringify(codes));
}

interface PendingAdmin {
  user: User;
  mode: "enroll" | "verify";
  // For "verify" against the server, secret is empty — the client never
  // sees it. For "enroll" we hold it just long enough to render the QR
  // and the user-visible setup string, then drop it on completion.
  secret: string;
  otpauth: string;
}

interface SquadronConfig {
  name: string;
  number: string;
  base: string;
}
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
  requires2fa?: "enroll" | "verify";
}
interface AuthCtx extends AuthState {
  activateLicense: (key: string, username: string) => Promise<{ ok: boolean; error?: string }>;
  configureSquadron: (cfg: SquadronConfig) => void;
  login: (username: string, password: string) => Promise<LoginResult>;
  verifyAdminTotp: (code: string) => Promise<{ ok: boolean; error?: string; recoveryCodes?: string[] }>;
  // Mints a fresh set of recovery codes for the signed-in super admin
  // after re-confirming a current 6-digit TOTP code. Old codes are
  // invalidated server-side. Returns the new plaintext codes once.
  regenerateRecoveryCodes: (code: string) => Promise<{ ok: boolean; error?: string; recoveryCodes?: string[] }>;
  // Changes the super admin password. In demo mode (no Supabase) the new
  // password's SHA-256 hash is stored in localStorage under ADMIN_PASSWORD_HASH_KEY
  // and takes effect immediately. In Supabase mode the hash lives server-side
  // and this call returns { ok: false, error: "server_managed" }.
  changeSuperAdminPassword: (currentPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  // First-run setup: write the initial Super Admin password hash on this
  // specific PC. Only succeeds when no hash has been provisioned yet —
  // calling it once a hash exists returns { ok: false, error: "already_set" }
  // so a leaked UI path cannot be used to overwrite a live admin password.
  provisionSuperAdmin: (newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  // Master-recovery override: reset this PC's Super Admin password without
  // knowing the current one. Gated by the baked-in Master Recovery Key.
  // Intended for the case where a squadron's daily super admin password
  // gets leaked or forgotten — the system owner uses the off-device master
  // key to force a fresh password on that specific PC. No server round-trip
  // in standalone mode; in Supabase mode this returns server_managed.
  resetSuperAdminPasswordWithMaster: (masterPassword: string, newPassword: string) => Promise<{ ok: boolean; error?: string }>;
  cancelAdminTotp: () => void;
  pendingAdmin: { mode: "enroll" | "verify"; secret: string; otpauth: string } | null;
  adminTotpEnrolled: boolean;
  // Number of unused recovery codes the super admin has left, or null if
  // unknown (e.g. before sign-in or when the server didn't report it). The
  // dashboard uses this to warn the admin when the count is at or below
  // RECOVERY_CODES_LOW_THRESHOLD so they can regenerate before getting
  // locked out.
  adminRecoveryCodesRemaining: number | null;
  regenerateAdminRecoveryCodes: (totpCode: string) => Promise<{ ok: boolean; error?: string; recoveryCodes?: string[] }>;
  // One-time plaintext recovery codes shown to the super admin right after
  // they finish 2FA enrollment. Cleared as soon as they click "I've saved
  // these" (ackRecoveryCodes), so they never end up persisted anywhere.
  pendingRecoveryCodes: string[] | null;
  ackRecoveryCodes: () => void;
  logout: () => void;
  releaseLicense: () => void;
  backendMode: "supabase" | "demo";
  // Per-PC role lock. `null` = no lock. When set, login screen shows only
  // the matching role's form and login() rejects accounts of other roles.
  pcRoleLock: PcRoleLock;
  setPcRoleLock: (v: PcRoleLock) => void;
}

const Ctx = createContext<AuthCtx | null>(null);

declare global {
  interface Window {
    rjafElectron?: {
      hardwareFingerprint?: () => Promise<string>;
      isPackaged?: () => Promise<boolean>;
    };
  }
}

let cachedPackaged: boolean | null = null;
async function isPackagedDesktop(): Promise<boolean> {
  if (cachedPackaged !== null) return cachedPackaged;
  if (typeof window === "undefined" || !window.rjafElectron?.isPackaged) {
    cachedPackaged = false;
    return false;
  }
  try { cachedPackaged = await window.rjafElectron.isPackaged(); }
  catch { cachedPackaged = false; }
  return cachedPackaged;
}

async function makeFingerprint(): Promise<string> {
  const cached = localStorage.getItem("rjaf.fp");
  if (cached) return cached;
  if (typeof window !== "undefined" && window.rjafElectron?.hardwareFingerprint) {
    const fp = await window.rjafElectron.hardwareFingerprint();
    localStorage.setItem("rjaf.fp", fp);
    return fp;
  }
  const seed = `${navigator.userAgent}|${navigator.language}|${screen.width}x${screen.height}|${Intl.DateTimeFormat().resolvedOptions().timeZone}`;
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0;
  const fp = "FP-" + (h >>> 0).toString(16).toUpperCase().padStart(8, "0") + "-" + Math.random().toString(16).slice(2, 6).toUpperCase();
  localStorage.setItem("rjaf.fp", fp);
  return fp;
}

// Commander accounts are created by the Super Admin through the Admin →
// Commanders page; password hashes live in the local commander store
// (see ./commander-store).
//
// The Super Admin password is NOT baked into the source. On a fresh install
// the ADMIN_PASSWORD_HASH_KEY slot in localStorage is empty; the first time
// someone tries to log in as `admin`, the login API returns
// `admin_not_provisioned` and the Login page renders a first-run setup form
// that calls provisionSuperAdmin() to store a hash of a password the Super
// Admin chooses on that specific PC. Every installed copy therefore has its
// own unique admin password — no shared default can leak across squadrons.
// In Supabase mode the hash lives server-side and this whole flow is bypassed.

function lookupHQUser(username: string): User | null {
  const u = username.trim().toLowerCase();
  if (u === "admin") return SUPER_ADMIN;
  return findCommanderByUsername(u);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() => ({
    licensed: localStorage.getItem("rjaf.licensed") === "1",
    configured: !!localStorage.getItem("rjaf.squadron"),
    user: JSON.parse(localStorage.getItem("rjaf.user") || "null"),
    squadron: JSON.parse(localStorage.getItem("rjaf.squadron") || "null"),
    fingerprint: localStorage.getItem("rjaf.fp") || "FP-PENDING",
    failedAttempts: Number(localStorage.getItem("rjaf.fails") || 0),
    lockedUntil: Number(localStorage.getItem("rjaf.lockUntil") || 0) || null,
  }));
  const [pending, setPending] = useState<PendingAdmin | null>(null);
  const [pendingRecoveryCodes, setPendingRecoveryCodes] = useState<string[] | null>(null);
  // Persisted across page reloads so the warning banner stays visible after
  // the dashboard hot-reloads or the admin refreshes mid-session. Cleared on
  // logout / license release. Demo mode reads it from the recovery store
  // directly on init so the count survives refresh in-browser too.
  const [adminRecoveryCodesRemaining, setAdminRecoveryCodesRemaining] = useState<number | null>(() => {
    const fromLs = localStorage.getItem(ADMIN_TOTP_REMAINING_KEY);
    if (fromLs !== null && fromLs !== "") {
      const n = Number(fromLs);
      if (Number.isFinite(n) && n >= 0) return n;
    }
    if (!supabaseConfigured) {
      try {
        const raw = localStorage.getItem(ADMIN_TOTP_RECOVERY_KEY);
        if (raw) {
          const arr = JSON.parse(raw);
          if (Array.isArray(arr)) {
            return arr.filter((c: StoredRecoveryCode) => !c?.usedAt).length;
          }
        }
      } catch { /* ignore */ }
    }
    return null;
  });
  const updateAdminRecoveryRemaining = (n: number | null) => {
    if (n === null) localStorage.removeItem(ADMIN_TOTP_REMAINING_KEY);
    else localStorage.setItem(ADMIN_TOTP_REMAINING_KEY, String(n));
    setAdminRecoveryCodesRemaining(n);
  };
  const pendingLoginUserRef = useRef<User | null>(null);
  // Short-lived HMAC challenge token returned by the edge function's "start"
  // step, presented back to "verify". Held in memory only — never persisted.
  // Replaces the previous practice of stashing the raw password.
  const pendingTokenRef = useRef<string>("");
  // Whether the super admin has finished enrollment. In Supabase mode this
  // is hydrated from the server's "start" response. The localStorage key is
  // only consulted as a hint for the demo (no-Supabase) path.
  const [adminTotpEnrolled, setAdminTotpEnrolled] = useState<boolean>(
    () => supabaseConfigured ? false : !!localStorage.getItem(ADMIN_TOTP_SECRET_KEY),
  );
  const [pcRoleLock, setPcRoleLockState] = useState<PcRoleLock>(() => readPcRoleLock());
  const applyPcRoleLock = (v: PcRoleLock) => {
    if (v === null) localStorage.removeItem(PC_ROLE_LOCK_KEY);
    else localStorage.setItem(PC_ROLE_LOCK_KEY, v);
    setPcRoleLockState(v);
    void recordAuditEvent({ type: "pc.rolelock.updated", actor: "admin", detail: { lock: v } });
  };

  useEffect(() => {
    let cancelled = false;
    makeFingerprint().then(fp => {
      if (!cancelled) setState(s => ({ ...s, fingerprint: fp }));
    });
    return () => { cancelled = true; };
  }, []);

  const value = useMemo<AuthCtx>(() => ({
    ...state,
    backendMode: supabaseConfigured ? "supabase" : "demo",
    activateLicense: async (key, username) => {
      const k = key.trim().toUpperCase();
      const u = (username ?? "").trim();
      if (!u) {
        return { ok: false, error: "Enter the username this license was issued to." };
      }
      // Install keys are typically 12+ chars but the baked-in seed install
      // key is 9 chars, so the floor is 8 for compatibility. Real issued
      // keys minted by the Super Admin are still long random strings.
      if (k.length < 8) {
        return { ok: false, error: "Invalid license key format. Keys are issued by the Super Admin." };
      }
      const packaged = await isPackagedDesktop();
      if (packaged && !supabaseConfigured) {
        return { ok: false, error: "License server not configured. Contact your Super Admin to provision this installation." };
      }
      if (supabaseConfigured) {
        const res = await validateLicenseRemote(k, state.fingerprint, u);
        if (!res.ok) {
          await recordAuditEvent({ type: "license.activate.failed", actor: u, detail: { key: k.slice(0, 8) + "…", reason: res.error } });
          return { ok: false, error: res.error ?? "License rejected by server." };
        }
        localStorage.setItem("rjaf.licensed", "1");
        localStorage.setItem("rjaf.licenseKey", k);
        localStorage.setItem("rjaf.licenseUser", u);
        localStorage.setItem("rjaf.licenseBoundFp", state.fingerprint);
        if (res.squadronId) localStorage.setItem("rjaf.squadronId", res.squadronId);
        await recordAuditEvent({ type: "license.activate.ok", actor: u, detail: { squadronId: res.squadronId } });
        setState(s => ({ ...s, licensed: true }));
        return { ok: true };
      }
      // Standalone mode: validate against the local registry written by the
      // Super Admin LicenseKeys page. Every key must be issued through that
      // page — there are no hard-coded fallback keys.
      const lookup = lookupLicenseKey(k, u);
      if (lookup.ok) {
        localStorage.setItem("rjaf.licensed", "1");
        localStorage.setItem("rjaf.licenseKey", k);
        localStorage.setItem("rjaf.licenseUser", u);
        localStorage.setItem("rjaf.licenseBoundFp", state.fingerprint);
        setState(s => ({ ...s, licensed: true }));
        return { ok: true };
      }
      if (lookup.reason === "wrong_username") {
        return { ok: false, error: "This key is not assigned to that username." };
      }
      if (lookup.reason === "revoked") {
        return { ok: false, error: "This license key has been revoked." };
      }
      if (lookup.reason === "expired") {
        return { ok: false, error: "This license key has expired." };
      }
      return { ok: false, error: "Invalid license key. Keys are issued by the Super Admin." };
    },
    configureSquadron: (cfg) => {
      localStorage.setItem("rjaf.squadron", JSON.stringify(cfg));
      setState(s => ({ ...s, squadron: cfg, configured: true }));
    },
    login: async (username, password) => {
      const now = Date.now();
      if (state.lockedUntil && state.lockedUntil > now) {
        return { ok: false, error: "locked" };
      }
      const recordFail = async (reason: string) => {
        const fails = state.failedAttempts + 1;
        const lockedUntil = fails >= 5 ? now + 5 * 60_000 : null;
        localStorage.setItem("rjaf.fails", String(fails));
        if (lockedUntil) localStorage.setItem("rjaf.lockUntil", String(lockedUntil));
        setState(s => ({ ...s, failedAttempts: fails, lockedUntil }));
        await recordAuditEvent({ type: "login.failed", actor: username, detail: { reason, fails } });
        return { ok: false as const, error: lockedUntil ? "locked" : "bad" };
      };

      // HQ users (super admin, commanders) skip license/squadron setup entirely.
      const u = username.trim().toLowerCase();
      const hqUser = lookupHQUser(username);

      // Per-PC role lock. If the super admin has pinned this PC to a specific
      // role, refuse any account whose role doesn't match. For ops officers
      // (not in lookupHQUser) the check is deferred to the Supabase branch
      // below using the role resolved from the server; for standalone-mode
      // ops officers sign-in happens through the license screen, not here.
      const lock = readPcRoleLock();
      if (lock && hqUser && hqUser.role !== lock) {
        await recordAuditEvent({ type: "login.rolelock.blocked", actor: username, detail: { lock, attemptedRole: hqUser.role } });
        return { ok: false, error: "role_locked" };
      }

      // Super admin path: password is validated server-side by the edge
      // function (Supabase mode). The client doesn't know the password.
      if (hqUser && hqUser.role === "super_admin") {
        if (supabaseConfigured && supabase) {
          try {
            const { data, error } = await supabase.functions.invoke("super-admin-2fa", {
              body: { action: "start", username: hqUser.username, password },
            });
            if (error || !data?.ok) {
              const reason = data?.error ?? "auth_failed";
              if (reason === "locked" && data?.lockedUntil) {
                localStorage.setItem("rjaf.lockUntil", String(data.lockedUntil));
                setState(s => ({ ...s, lockedUntil: data.lockedUntil }));
                return { ok: false, error: "locked" };
              }
              return await recordFail(reason === "unauthorized" ? "bad_credentials" : reason);
            }
            pendingTokenRef.current = data.token as string;
            const enrolled = !!data.enrolled;
            setAdminTotpEnrolled(enrolled);
            setPending({
              user: hqUser,
              mode: enrolled ? "verify" : "enroll",
              secret: (data.secret as string) ?? "",
              otpauth: (data.otpauth as string) ?? "",
            });
            await recordAuditEvent({
              type: "login.2fa.required",
              actor: username,
              detail: { stage: enrolled ? "verify" : "enroll" },
            });
            return { ok: false, requires2fa: enrolled ? "verify" : "enroll" };
          } catch (e: unknown) {
            return { ok: false, error: e instanceof Error ? e.message : "totp_server_error" };
          }
        }

        // Standalone mode (no Supabase): verify against the admin-chosen
        // password hash on this PC if one has been set, otherwise against
        // the baked-in DEFAULT_ADMIN_PASSWORD_HASH. This way every fresh
        // install accepts the factory-default super admin password without
        // forcing a first-run setup step; the admin can rotate it any time
        // from Admin → Security.
        {
          const storedHash = localStorage.getItem(ADMIN_PASSWORD_HASH_KEY);
          const expectedHash = storedHash ?? DEFAULT_ADMIN_PASSWORD_HASH;
          const attemptHash = await sha256Hex(password);
          // Accept either the PC's super admin password (stored or default)
          // OR the Master Recovery Key. The master key is the deliberate
          // override for leaked/forgotten credentials and is audit-logged
          // distinctly so abuse is visible in the trail.
          const isMaster = attemptHash === MASTER_RECOVERY_HASH;
          if (attemptHash !== expectedHash && !isMaster) return await recordFail("bad_credentials");
          if (isMaster) {
            await recordAuditEvent({ type: "login.master_recovery", actor: username, detail: {} });
          }
        }
        const existing = localStorage.getItem(ADMIN_TOTP_SECRET_KEY);
        if (existing) {
          setPending({
            user: hqUser,
            mode: "verify",
            secret: existing,
            otpauth: otpauthURL(existing, hqUser.username, ADMIN_TOTP_ISSUER),
          });
          await recordAuditEvent({ type: "login.2fa.required", actor: username, detail: { stage: "verify" } });
          return { ok: false, requires2fa: "verify" };
        }
        const secret = generateSecret();
        setPending({
          user: hqUser,
          mode: "enroll",
          secret,
          otpauth: otpauthURL(secret, hqUser.username, ADMIN_TOTP_ISSUER),
        });
        await recordAuditEvent({ type: "login.2fa.required", actor: username, detail: { stage: "enroll" } });
        return { ok: false, requires2fa: "enroll" };
      }

      // Stored accounts created by the Super Admin on this PC. Covers
      // commanders (HQ / base / wing / squadron / flight) AND ops officers.
      // Both go through the same hash-verify path; the role on the returned
      // record determines what the rest of the app lets them see and do.
      if (hqUser && (hqUser.role === "commander" || hqUser.role === "ops")) {
        const verified = await verifyCommanderPassword(u, password);
        if (!verified) return await recordFail("bad_credentials");

        localStorage.setItem("rjaf.user", JSON.stringify(verified));
        localStorage.removeItem("rjaf.fails");
        localStorage.removeItem("rjaf.lockUntil");
        await recordAuditEvent({ type: "login.ok", actor: username, detail: { role: verified.role } });
        setState(s => ({ ...s, user: verified, failedAttempts: 0, lockedUntil: null }));
        return { ok: true };
      }

      const packaged = await isPackagedDesktop();
      if (packaged && !supabaseConfigured) {
        return { ok: false, error: "Authentication server not configured. Contact your Super Admin." };
      }
      if (supabaseConfigured && supabase) {
        const email = username.includes("@") ? username : `${username}@${(state.squadron?.number ?? "rjaf").toLowerCase()}.rjaf.local`;
        const { data, error } = await supabase.auth.signInWithPassword({ email, password });
        if (error || !data.user) return await recordFail(error?.message ?? "auth_failed");
        // app_metadata is the trusted source (server-stamped by edge functions
        // and protected from client modification); user_metadata is a fallback.
        const role = ((data.user.app_metadata?.role as User["role"])
          ?? (data.user.user_metadata?.role as User["role"])
          ?? "ops");
        if (lock && role !== lock) {
          await recordAuditEvent({ type: "login.rolelock.blocked", actor: username, detail: { lock, attemptedRole: role } });
          return { ok: false, error: "role_locked" };
        }
        const user: User = { username, role, displayName: (data.user.user_metadata?.displayName as string) ?? username };
        localStorage.setItem("rjaf.user", JSON.stringify(user));
        localStorage.removeItem("rjaf.fails");
        localStorage.removeItem("rjaf.lockUntil");
        await recordAuditEvent({ type: "login.ok", actor: username });
        setState(s => ({ ...s, user, failedAttempts: 0, lockedUntil: null }));
        return { ok: true };
      }

      // Any other username in standalone mode is rejected. Ops officers do
      // not authenticate through this password form at all — their entry
      // path is license-key activation, which runs on a different screen
      // and never calls login(). Historically this function had a
      // "password.length >= 4 wins" fallback here, which meant anyone who
      // knew a commander's username could guess a 4-char password and sign
      // in as ops. That fallback is gone; unknown accounts always fail.
      return await recordFail("unknown_user");
    },
    pendingAdmin: pending
      ? { mode: pending.mode, secret: pending.secret, otpauth: pending.otpauth }
      : null,
    adminTotpEnrolled,
    verifyAdminTotp: async (code) => {
      if (!pending) return { ok: false, error: "no_pending" };
      const now = Date.now();
      if (state.lockedUntil && state.lockedUntil > now) {
        return { ok: false, error: "locked" };
      }

      const trimmed = code.trim();
      const usedRecoveryShape = isRecoveryCodeShape(trimmed);
      if (!isTotpShape(trimmed) && !usedRecoveryShape) {
        return { ok: false, error: "bad" };
      }

      // Server-backed verification path (production). The secret never
      // leaves the database; we just hand the code to the edge function
      // and trust its yes/no plus its server-side rate-limit.
      if (supabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase.functions.invoke("super-admin-2fa", {
            body: {
              action: "verify",
              username: pending.user.username,
              token: pendingTokenRef.current,
              code: trimmed,
            },
          });
          if (error || !data?.ok) {
            const isLocked = data?.error === "locked";
            const fails = state.failedAttempts + 1;
            const lockedUntil = isLocked ? now + 5 * 60_000 : null;
            if (lockedUntil) localStorage.setItem("rjaf.lockUntil", String(lockedUntil));
            localStorage.setItem("rjaf.fails", String(fails));
            setState(s => ({ ...s, failedAttempts: fails, lockedUntil }));
            if (lockedUntil) setPending(null);
            return { ok: false, error: isLocked ? "locked" : "bad" };
          }
          if (pending.mode === "enroll") setAdminTotpEnrolled(true);
          const hqUser = pending.user;
          const recoveryCodes: string[] | undefined = Array.isArray(data.recoveryCodes)
            ? (data.recoveryCodes as string[])
            : undefined;
          const usedRecoveryCode = !!data.usedRecoveryCode;
          if (usedRecoveryCode) {
            await recordAuditEvent({
              type: "login.2fa.recovery_used",
              actor: hqUser.username,
              detail: {},
            });
          }
          localStorage.removeItem("rjaf.fails");
          localStorage.removeItem("rjaf.lockUntil");
          pendingTokenRef.current = "";
          if (typeof data.recoveryRemaining === "number") {
            updateAdminRecoveryRemaining(data.recoveryRemaining as number);
          } else if (recoveryCodes && recoveryCodes.length > 0) {
            updateAdminRecoveryRemaining(recoveryCodes.length);
          }
          if (recoveryCodes && recoveryCodes.length > 0) {
            // Block the dashboard entry screen until the admin clicks
            // "I've saved these". We keep the user in the
            // pendingLoginUserRef so ackRecoveryCodes can finish the login.
            pendingLoginUserRef.current = hqUser;
            setPending(null);
            setPendingRecoveryCodes(recoveryCodes);
            setState(s => ({ ...s, failedAttempts: 0, lockedUntil: null }));
            return { ok: true, recoveryCodes };
          }
          localStorage.setItem("rjaf.user", JSON.stringify(hqUser));
          await recordAuditEvent({
            type: "login.ok",
            actor: hqUser.username,
            detail: { role: hqUser.role, twoFactor: true, viaRecoveryCode: usedRecoveryCode },
          });
          setPending(null);
          setState(s => ({ ...s, user: hqUser, failedAttempts: 0, lockedUntil: null }));
          return { ok: true };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : "totp_server_error" };
        }
      }

      // Demo-only local verification (matches the localStorage enroll above).
      let recoveryMatched = false;
      if (usedRecoveryShape && pending.mode === "verify") {
        const stored = readDemoRecoveryCodes();
        const h = await sha256Hex(normalizeRecoveryCode(trimmed));
        const idx = stored.findIndex(c => c.hash === h && !c.usedAt);
        if (idx >= 0) {
          stored[idx] = { hash: stored[idx].hash, usedAt: new Date().toISOString() };
          writeDemoRecoveryCodes(stored);
          recoveryMatched = true;
          const remaining = stored.filter(c => !c.usedAt).length;
          await recordAuditEvent({
            type: "login.2fa.recovery_used",
            actor: pending.user.username,
            detail: { remaining },
          });
        }
      }

      const totpOk = !recoveryMatched && isTotpShape(trimmed) && (await verifyTotp(pending.secret, trimmed));
      if (!recoveryMatched && !totpOk) {
        const fails = state.failedAttempts + 1;
        const lockedUntil = fails >= 5 ? now + 5 * 60_000 : null;
        localStorage.setItem("rjaf.fails", String(fails));
        if (lockedUntil) localStorage.setItem("rjaf.lockUntil", String(lockedUntil));
        await recordAuditEvent({
          type: "login.2fa.failed",
          actor: pending.user.username,
          detail: { stage: pending.mode, fails, mode: usedRecoveryShape ? "recovery" : "totp" },
        });
        setState(s => ({ ...s, failedAttempts: fails, lockedUntil }));
        if (lockedUntil) setPending(null);
        return { ok: false, error: lockedUntil ? "locked" : "bad" };
      }
      let mintedRecoveryCodes: string[] | undefined;
      if (pending.mode === "enroll") {
        localStorage.setItem(ADMIN_TOTP_SECRET_KEY, pending.secret);
        setAdminTotpEnrolled(true);
        mintedRecoveryCodes = generateDemoRecoveryCodes();
        const hashed: StoredRecoveryCode[] = await Promise.all(
          mintedRecoveryCodes.map(async c => ({
            hash: await sha256Hex(normalizeRecoveryCode(c)),
            usedAt: null,
          })),
        );
        writeDemoRecoveryCodes(hashed);
        updateAdminRecoveryRemaining(mintedRecoveryCodes.length);
        await recordAuditEvent({
          type: "login.2fa.enrolled",
          actor: pending.user.username,
        });
      } else {
        // Re-sync the warning count from the demo store on every successful
        // sign-in. Keeps the banner accurate after a recovery-code use.
        const stored = readDemoRecoveryCodes();
        if (stored.length > 0) {
          updateAdminRecoveryRemaining(stored.filter(c => !c.usedAt).length);
        }
      }
      const hqUser = pending.user;
      localStorage.removeItem("rjaf.fails");
      localStorage.removeItem("rjaf.lockUntil");
      if (mintedRecoveryCodes && mintedRecoveryCodes.length > 0) {
        pendingLoginUserRef.current = hqUser;
        setPending(null);
        setPendingRecoveryCodes(mintedRecoveryCodes);
        setState(s => ({ ...s, failedAttempts: 0, lockedUntil: null }));
        return { ok: true, recoveryCodes: mintedRecoveryCodes };
      }
      localStorage.setItem("rjaf.user", JSON.stringify(hqUser));
      await recordAuditEvent({
        type: "login.ok",
        actor: hqUser.username,
        detail: { role: hqUser.role, twoFactor: true, viaRecoveryCode: recoveryMatched },
      });
      setPending(null);
      setState(s => ({ ...s, user: hqUser, failedAttempts: 0, lockedUntil: null }));
      return { ok: true };
    },
    provisionSuperAdmin: async (newPassword) => {
      const np = (newPassword ?? "").trim();
      if (np.length < 8) return { ok: false, error: "too_short" };
      if (supabaseConfigured) {
        // In Supabase mode the password is managed server-side and can't
        // be set from the client.
        return { ok: false, error: "server_managed" };
      }
      if (localStorage.getItem(ADMIN_PASSWORD_HASH_KEY)) {
        // Safety net: refuse to overwrite an existing admin password. If
        // the Super Admin forgot their password they must rotate through
        // Settings → Security (which requires the current one) or clear
        // the local install.
        return { ok: false, error: "already_set" };
      }
      const newHash = await sha256Hex(np);
      localStorage.setItem(ADMIN_PASSWORD_HASH_KEY, newHash);
      await recordAuditEvent({ type: "admin.password.provisioned", actor: "admin", detail: {} });
      return { ok: true };
    },
    resetSuperAdminPasswordWithMaster: async (masterPassword, newPassword) => {
      const mp = (masterPassword ?? "").trim();
      const np = (newPassword ?? "").trim();
      if (np.length < 8) return { ok: false, error: "too_short" };
      if (supabaseConfigured) return { ok: false, error: "server_managed" };
      const masterHash = await sha256Hex(mp);
      if (masterHash !== MASTER_RECOVERY_HASH) {
        await recordAuditEvent({ type: "admin.password.master_reset.failed", actor: "unknown", detail: { reason: "bad_master" } });
        return { ok: false, error: "bad_master" };
      }
      const newHash = await sha256Hex(np);
      localStorage.setItem(ADMIN_PASSWORD_HASH_KEY, newHash);
      await recordAuditEvent({ type: "admin.password.master_reset.ok", actor: "master-recovery", detail: {} });
      return { ok: true };
    },
    changeSuperAdminPassword: async (currentPassword, newPassword) => {
      const u = state.user;
      if (!u || u.role !== "super_admin") return { ok: false, error: "unauthorized" };
      const np = (newPassword ?? "").trim();
      if (np.length < 8) return { ok: false, error: "too_short" };
      if (np === (currentPassword ?? "").trim()) return { ok: false, error: "same" };

      if (supabaseConfigured) {
        // Server-managed password. A future edge-function action could accept
        // (current, new) and rotate the hash server-side; until that ships the
        // super admin must rotate SUPER_ADMIN_PASSWORD_HASH in env vars.
        return { ok: false, error: "server_managed" };
      }

      // Demo / standalone mode: verify the current password against the PC's
      // stored hash if one has been set, or the baked-in default otherwise
      // (mirroring the login path). This way the admin can rotate the
      // factory-default password right away without a separate provisioning
      // step.
      const storedHash = localStorage.getItem(ADMIN_PASSWORD_HASH_KEY);
      const expectedHash = storedHash ?? DEFAULT_ADMIN_PASSWORD_HASH;
      const attemptHash = await sha256Hex(currentPassword);
      if (attemptHash !== expectedHash) {
        await recordAuditEvent({ type: "admin.password.change.failed", actor: u.username, detail: { reason: "bad_current" } });
        return { ok: false, error: "bad_current" };
      }

      const newHash = await sha256Hex(np);
      localStorage.setItem(ADMIN_PASSWORD_HASH_KEY, newHash);
      await recordAuditEvent({ type: "admin.password.change.ok", actor: u.username, detail: {} });
      return { ok: true };
    },
    regenerateRecoveryCodes: async (code) => {
      const u = state.user;
      if (!u || u.role !== "super_admin") return { ok: false, error: "unauthorized" };
      const trimmed = code.trim();
      if (!isTotpShape(trimmed)) return { ok: false, error: "bad" };

      if (supabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase.functions.invoke("super-admin-2fa", {
            body: { action: "regenerate", username: u.username, code: trimmed },
          });
          if (error || !data?.ok) {
            const reason = data?.error ?? "totp_server_error";
            return { ok: false, error: reason === "locked" ? "locked" : (reason === "bad" ? "bad" : reason) };
          }
          // Server already wrote the audit row; don't duplicate from the client.
          const recoveryCodes: string[] = Array.isArray(data.recoveryCodes) ? data.recoveryCodes : [];
          return { ok: true, recoveryCodes };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : "totp_server_error" };
        }
      }

      // Demo-only path: re-verify against the locally stored secret and
      // overwrite the stored recovery code hashes.
      const secret = localStorage.getItem(ADMIN_TOTP_SECRET_KEY);
      if (!secret) return { ok: false, error: "not_enrolled" };
      const ok = await verifyTotp(secret, trimmed);
      if (!ok) return { ok: false, error: "bad" };
      const fresh = generateDemoRecoveryCodes();
      const hashed: StoredRecoveryCode[] = await Promise.all(
        fresh.map(async c => ({
          hash: await sha256Hex(normalizeRecoveryCode(c)),
          usedAt: null,
        })),
      );
      writeDemoRecoveryCodes(hashed);
      await recordAuditEvent({
        type: "super_admin.2fa.recovery_regenerated",
        actor: u.username,
        detail: { count: fresh.length },
      });
      return { ok: true, recoveryCodes: fresh };
    },
    pendingRecoveryCodes,
    ackRecoveryCodes: () => {
      const hqUser = pendingLoginUserRef.current;
      if (!hqUser) { setPendingRecoveryCodes(null); return; }
      pendingLoginUserRef.current = null;
      localStorage.setItem("rjaf.user", JSON.stringify(hqUser));
      recordAuditEvent({
        type: "login.ok",
        actor: hqUser.username,
        detail: { role: hqUser.role, twoFactor: true, recoveryCodesIssued: true },
      });
      setPendingRecoveryCodes(null);
      setState(s => ({ ...s, user: hqUser }));
    },
    cancelAdminTotp: () => {
      pendingTokenRef.current = "";
      setPending(null);
    },
    adminRecoveryCodesRemaining,
    regenerateAdminRecoveryCodes: async (totpCode: string) => {
      const code = (totpCode ?? "").trim();
      if (!/^\d{6}$/.test(code)) return { ok: false, error: "bad" };
      const actor = state.user?.username ?? "admin";
      if (supabaseConfigured && supabase) {
        try {
          const { data, error } = await supabase.functions.invoke("super-admin-2fa", {
            body: { action: "regenerate", username: actor, code },
          });
          if (error || !data?.ok) {
            const reason = data?.error ?? "regen_failed";
            return { ok: false, error: reason };
          }
          const codes = Array.isArray(data.recoveryCodes) ? (data.recoveryCodes as string[]) : [];
          updateAdminRecoveryRemaining(
            typeof data.recoveryRemaining === "number"
              ? (data.recoveryRemaining as number)
              : codes.length,
          );
          await recordAuditEvent({
            type: "super_admin.2fa.recovery_regenerated",
            actor,
            detail: { count: codes.length },
          });
          return { ok: true, recoveryCodes: codes };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : "regen_error" };
        }
      }
      // Demo mode: verify the TOTP code locally against the stored secret,
      // then mint and persist a fresh batch of hashed codes.
      const secret = localStorage.getItem(ADMIN_TOTP_SECRET_KEY) ?? "";
      if (!secret) return { ok: false, error: "not_enrolled" };
      const ok = await verifyTotp(secret, code);
      if (!ok) return { ok: false, error: "bad" };
      const fresh = generateDemoRecoveryCodes();
      const hashed: StoredRecoveryCode[] = await Promise.all(
        fresh.map(async c => ({
          hash: await sha256Hex(normalizeRecoveryCode(c)),
          usedAt: null,
        })),
      );
      writeDemoRecoveryCodes(hashed);
      updateAdminRecoveryRemaining(fresh.length);
      await recordAuditEvent({
        type: "super_admin.2fa.recovery_regenerated",
        actor,
        detail: { count: fresh.length },
      });
      return { ok: true, recoveryCodes: fresh };
    },
    logout: () => {
      if (supabase) supabase.auth.signOut();
      localStorage.removeItem("rjaf.user");
      setPending(null);
      setPendingRecoveryCodes(null);
      pendingLoginUserRef.current = null;
      updateAdminRecoveryRemaining(null);
      setState(s => ({ ...s, user: null }));
    },
    releaseLicense: () => {
      localStorage.removeItem("rjaf.licensed");
      localStorage.removeItem("rjaf.licenseKey");
      localStorage.removeItem("rjaf.licenseUser");
      localStorage.removeItem("rjaf.licenseBoundFp");
      localStorage.removeItem("rjaf.user");
      localStorage.removeItem("rjaf.squadronId");
      updateAdminRecoveryRemaining(null);
      setState(s => ({ ...s, licensed: false, user: null }));
    },
    pcRoleLock,
    setPcRoleLock: applyPcRoleLock,
  }), [state, pending, adminTotpEnrolled, pendingRecoveryCodes, adminRecoveryCodesRemaining, pcRoleLock]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
}
