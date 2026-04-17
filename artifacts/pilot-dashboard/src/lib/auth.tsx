import { createContext, useContext, useEffect, useMemo, useState, ReactNode } from "react";
import { supabase, supabaseConfigured, validateLicenseRemote, recordAuditEvent } from "./supabase";
import { commanders, SUPER_ADMIN } from "./mockData";
import type { User } from "./types";

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
interface AuthCtx extends AuthState {
  activateLicense: (key: string) => Promise<{ ok: boolean; error?: string }>;
  configureSquadron: (cfg: SquadronConfig) => void;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
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

const HQ_CREDS: Record<string, string> = {
  admin: "admin123",
  commander1: "commander",
  wing1: "commander",
  base1: "commander",
  hq1: "commander",
};

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
    activateLicense: async (key) => {
      const k = key.trim().toUpperCase();
      if (k.length < 12) {
        return { ok: false, error: "Invalid license key format. Keys are issued by the Super Admin." };
      }
      const packaged = await isPackagedDesktop();
      if (packaged && !supabaseConfigured) {
        return { ok: false, error: "License server not configured. Contact your Super Admin to provision this installation." };
      }
      if (supabaseConfigured) {
        const res = await validateLicenseRemote(k, state.fingerprint);
        if (!res.ok) {
          await recordAuditEvent({ type: "license.activate.failed", detail: { key: k.slice(0, 8) + "…", reason: res.error } });
          return { ok: false, error: res.error ?? "License rejected by server." };
        }
        localStorage.setItem("rjaf.licensed", "1");
        localStorage.setItem("rjaf.licenseKey", k);
        localStorage.setItem("rjaf.licenseBoundFp", state.fingerprint);
        if (res.squadronId) localStorage.setItem("rjaf.squadronId", res.squadronId);
        await recordAuditEvent({ type: "license.activate.ok", detail: { squadronId: res.squadronId } });
        setState(s => ({ ...s, licensed: true }));
        return { ok: true };
      }
      if (!DEMO_KEY_PREFIXES.some(p => k.startsWith(p))) {
        return { ok: false, error: "Invalid license key format. Keys are issued by the Super Admin." };
      }
      localStorage.setItem("rjaf.licensed", "1");
      localStorage.setItem("rjaf.licenseKey", k);
      localStorage.setItem("rjaf.licenseBoundFp", state.fingerprint);
      setState(s => ({ ...s, licensed: true }));
      return { ok: true };
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
      const hqExpected = HQ_CREDS[username.trim().toLowerCase()];
      if (hqExpected) {
        if (hqExpected !== password) return await recordFail("bad_credentials");
        const hqUser = lookupHQUser(username);
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
    logout: () => {
      if (supabase) supabase.auth.signOut();
      localStorage.removeItem("rjaf.user");
      setState(s => ({ ...s, user: null }));
    },
    releaseLicense: () => {
      localStorage.removeItem("rjaf.licensed");
      localStorage.removeItem("rjaf.licenseKey");
      localStorage.removeItem("rjaf.licenseBoundFp");
      localStorage.removeItem("rjaf.user");
      localStorage.removeItem("rjaf.squadronId");
      setState(s => ({ ...s, licensed: false, user: null }));
    },
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAuth must be inside AuthProvider");
  return v;
}
