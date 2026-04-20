import { createClient, SupabaseClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: "rjaf.sb" },
    })
  : null;

export interface LicenseValidationResult {
  ok: boolean;
  error?: string;
  squadronId?: string;
  expiresAt?: string;
}

export async function validateLicenseRemote(
  key: string,
  fingerprint: string,
  username: string
): Promise<LicenseValidationResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await supabase.functions.invoke("validate-license", {
    body: { key, fingerprint, username },
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as Partial<LicenseValidationResult> | null;
  if (!payload || !payload.ok) {
    return { ok: false, error: payload?.error ?? "rejected" };
  }
  return {
    ok: true,
    squadronId: payload.squadronId,
    expiresAt: payload.expiresAt,
  };
}

export interface RegisterLicenseArgs {
  key: string;
  username: string;
  displayName?: string;
  squadronNumber: string;
  squadronName?: string;
  squadronBase?: string;
  expiresAt?: string | null;
}

export interface RegisterLicenseResult {
  ok: boolean;
  error?: string;
  squadronId?: string;
  supabaseEmail?: string;
  supabasePassword?: string;
}

// Registers a freshly-minted license key with the central server AND
// provisions a Supabase auth user for the ops account so the browser can
// sign into Supabase and obtain a JWT carrying app_metadata.squadron_id.
// Without that JWT every operational-table read/write is silently filtered
// by RLS and PCs cannot share data.
export async function registerLicenseRemote(
  args: RegisterLicenseArgs
): Promise<RegisterLicenseResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await supabase.functions.invoke("register-license", {
    body: args,
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as RegisterLicenseResult | null;
  if (!payload?.ok) return { ok: false, error: payload?.error ?? "register_failed" };
  return {
    ok: true,
    squadronId: payload.squadronId,
    supabaseEmail: payload.supabaseEmail,
    supabasePassword: payload.supabasePassword,
  };
}

export interface ProvisionCommanderArgs {
  username: string;
  displayName?: string;
  role?: "ops" | "commander" | "deputy";
  tier?: "hq" | "squadron" | "flight" | "ops" | "deputy";
  squadronNumber?: string;
  squadronName?: string;
  squadronBase?: string;
}

export interface ProvisionCommanderResult {
  ok: boolean;
  error?: string;
  userId?: string;
  supabaseEmail?: string;
  supabasePassword?: string;
}

// Provision (or refresh) a Supabase auth user for a non-ops account
// (Squadron / Flight / HQ commander, or a deputy). Returns the synthesized
// email + random password the client must persist locally so subsequent
// logins can call supabase.auth.signInWithPassword and obtain a JWT.
export async function provisionCommanderRemote(
  args: ProvisionCommanderArgs
): Promise<ProvisionCommanderResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await supabase.functions.invoke("provision-commander", {
    body: args,
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as ProvisionCommanderResult | null;
  if (!payload?.ok) return { ok: false, error: payload?.error ?? "provision_failed" };
  return {
    ok: true,
    userId: payload.userId,
    supabaseEmail: payload.supabaseEmail,
    supabasePassword: payload.supabasePassword,
  };
}

// ── Local cache of Supabase credentials per local username ──────────────
// The local password (what the operator types) is intentionally separate
// from the random Supabase password we mint server-side; we cache the
// Supabase creds here keyed by local username so the auth flow can sign
// into Supabase right after the local hash check passes.
const SB_CREDS_KEY = "rjaf.supabaseCreds";

export interface SupabaseCreds { email: string; password: string }

function readCredsMap(): Record<string, SupabaseCreds> {
  try {
    const raw = localStorage.getItem(SB_CREDS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return typeof obj === "object" && obj !== null ? obj : {};
  } catch {
    return {};
  }
}

export function storeSupabaseCreds(username: string, email: string, password: string): void {
  const map = readCredsMap();
  map[username.trim().toLowerCase()] = { email, password };
  try { localStorage.setItem(SB_CREDS_KEY, JSON.stringify(map)); } catch { /* swallow */ }
}

export function getSupabaseCreds(username: string): SupabaseCreds | null {
  const map = readCredsMap();
  return map[username.trim().toLowerCase()] ?? null;
}

export function clearSupabaseCreds(username: string): void {
  const map = readCredsMap();
  delete map[username.trim().toLowerCase()];
  try { localStorage.setItem(SB_CREDS_KEY, JSON.stringify(map)); } catch { /* swallow */ }
}

export async function recordAuditEvent(event: {
  type: string;
  actor?: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  if (!supabase) return;
  await supabase.from("audit_log").insert({
    type: event.type,
    actor: event.actor ?? null,
    detail: event.detail ?? {},
    occurred_at: new Date().toISOString(),
  });
}
