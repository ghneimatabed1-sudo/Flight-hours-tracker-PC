import { createContext, useContext, useEffect, useMemo, useRef, useState, ReactNode } from "react";
import { supabase, supabaseConfigured, validateLicenseRemote, recordAuditEvent } from "./supabase";
import { lookupLicenseKey } from "./license-registry";
import { commanders, SUPER_ADMIN } from "./mockData";
import type { User } from "./types";
import { generateSecret, otpauthURL, verifyTotp } from "./totp";

// Demo-only fallback when Supabase isn't configured (in-browser preview).
// In any real install (`supabaseConfigured === true`) the secret is held
// server-side in `super_admin_2fa` and verified by the
// `super-admin-2fa` edge function — the localStorage path is never used.
const ADMIN_TOTP_SECRET_KEY = "rjaf.adminTotp.secret";
const ADMIN_TOTP_RECOVERY_KEY = "rjaf.adminTotp.recovery";
const ADMIN_TOTP_ISSUER = "RJAF Pilot Dashboard";
const RECOVERY_CODE_COUNT = 10;

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
  cancelAdminTotp: () => void;
  pendingAdmin: { mode: "enroll" | "verify"; secret: string; otpauth: string } | null;
  adminTotpEnrolled: boolean;
  // One-time plaintext recovery codes shown to the super admin right after
  // they finish 2FA enrollment. Cleared as soon as they click "I've saved
  // these" (ackRecoveryCodes), so they never end up persisted anywhere.
  pendingRecoveryCodes: string[] | null;
  ackRecoveryCodes: () => void;
  logout: () => void;
  releaseLicense: () => void;
  backendMode: "supabase" | "demo";
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

const DEMO_KEY_PREFIXES = ["RJAF-", "DEMO-"];

// Static credentials for HQ users *other than* the super admin. The super
// admin's password is held only on the server (SUPER_ADMIN_PASSWORD_HASH)
// and validated by the super-admin-2fa edge function — never by the
// client. In demo mode (no Supabase) we still accept "admin123" so the
// in-browser preview can log in.
const HQ_CREDS: Record<string, string> = {
  commander1: "commander",
  wing1: "commander",
  base1: "commander",
  hq1: "commander",
};
const DEMO_SUPER_ADMIN_PASSWORD = "admin123";

function lookupHQUser(username: string): User | null {
  const u = username.trim().toLowerCase();
  if (u === "admin") return SUPER_ADMIN;
  return commanders.find(c => c.username === u) ?? null;
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
      if (k.length < 12) {
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
      // Demo mode: validate against the local registry written by the Super
      // Admin LicenseKeys page. The legacy DEMO-/RJAF- prefix shortcut is kept
      // as a fallback so the smoke-test seed key still opens the app, but a
      // username is still required for the audit trail.
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
      // Unknown key — fall back to the legacy DEMO-/RJAF- prefix so the seed
      // smoke-test path still works for first-time evaluators.
      if (DEMO_KEY_PREFIXES.some(p => k.startsWith(p))) {
        localStorage.setItem("rjaf.licensed", "1");
        localStorage.setItem("rjaf.licenseKey", k);
        localStorage.setItem("rjaf.licenseUser", u);
        localStorage.setItem("rjaf.licenseBoundFp", state.fingerprint);
        setState(s => ({ ...s, licensed: true }));
        return { ok: true };
      }
      return { ok: false, error: "Invalid license key format. Keys are issued by the Super Admin." };
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

        // Demo-only fallback: in-browser preview without Supabase. The
        // hardcoded demo password is the only thing the client knows.
        if (password !== DEMO_SUPER_ADMIN_PASSWORD) return await recordFail("bad_credentials");
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

      const hqExpected = HQ_CREDS[u];
      if (hqExpected) {
        if (hqExpected !== password) return await recordFail("bad_credentials");
        if (!hqUser) return await recordFail("unknown_hq_user");

        localStorage.setItem("rjaf.user", JSON.stringify(hqUser));
        localStorage.removeItem("rjaf.fails");
        localStorage.removeItem("rjaf.lockUntil");
        await recordAuditEvent({ type: "login.ok", actor: username, detail: { role: hqUser.role } });
        setState(s => ({ ...s, user: hqUser, failedAttempts: 0, lockedUntil: null }));
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
        const user: User = { username, role, displayName: (data.user.user_metadata?.displayName as string) ?? username };
        localStorage.setItem("rjaf.user", JSON.stringify(user));
        localStorage.removeItem("rjaf.fails");
        localStorage.removeItem("rjaf.lockUntil");
        await recordAuditEvent({ type: "login.ok", actor: username });
        setState(s => ({ ...s, user, failedAttempts: 0, lockedUntil: null }));
        return { ok: true };
      }

      if (!username || password.length < 4) return await recordFail("bad_credentials");
      const user: User = { username, role: "ops", displayName: username };
      localStorage.setItem("rjaf.user", JSON.stringify(user));
      localStorage.removeItem("rjaf.fails");
      localStorage.removeItem("rjaf.lockUntil");
      setState(s => ({ ...s, user, failedAttempts: 0, lockedUntil: null }));
      return { ok: true };
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
        await recordAuditEvent({
          type: "login.2fa.enrolled",
          actor: pending.user.username,
        });
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
    logout: () => {
      if (supabase) supabase.auth.signOut();
      localStorage.removeItem("rjaf.user");
      setPending(null);
      setPendingRecoveryCodes(null);
      pendingLoginUserRef.current = null;
      setState(s => ({ ...s, user: null }));
    },
    releaseLicense: () => {
      localStorage.removeItem("rjaf.licensed");
      localStorage.removeItem("rjaf.licenseKey");
      localStorage.removeItem("rjaf.licenseUser");
      localStorage.removeItem("rjaf.licenseBoundFp");
      localStorage.removeItem("rjaf.user");
      localStorage.removeItem("rjaf.squadronId");
      setState(s => ({ ...s, licensed: false, user: null }));
    },
  }), [state, pending, adminTotpEnrolled, pendingRecoveryCodes]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
}
