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
//
// This call is routed through the api-server proxy (/api/license/register)
// rather than directly to the Supabase edge function. The provisioning
// secret lives only in the api-server's environment — it is never bundled
// into client code. VITE_API_SERVER_URL is just a base URL (not a secret)
// and defaults to the same-origin /api path for web builds.
export async function registerLicenseRemote(
  args: RegisterLicenseArgs
): Promise<RegisterLicenseResult> {
  const apiBase = (import.meta.env.VITE_API_SERVER_URL as string | undefined) ?? "/api";
  let resp: Response;
  try {
    resp = await fetch(`${apiBase}/license/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(args),
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "network_error" };
  }
  let payload: RegisterLicenseResult | null = null;
  try { payload = await resp.json(); } catch { /* ignore */ }
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
  tier?: "hq" | "base" | "wing" | "squadron" | "flight" | "ops" | "deputy";
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

// Re-provision Supabase credentials for a user whose locally-cached
// password has gone out of sync with the server (e.g. password rotated
// server-side, or local cache cleared and never restored). Calls the
// provision-commander edge function which is idempotent: it either
// creates the auth user or rotates its password, and returns the new
// password the client must persist. After a successful re-sync this
// helper also signs the browser into Supabase so the very next write
// carries a valid JWT — no extra round-trip from the caller.
//
// IMPORTANT: provision-commander now enforces JWT authentication —
// the caller must already be signed into Supabase (via a valid session)
// before calling this helper. The Supabase client automatically forwards
// the current session token in the Authorization header.
export async function resyncSupabaseCreds(
  username: string,
  role: "ops" | "commander" = "ops",
  squadron?: { number?: string; name?: string; base?: string },
): Promise<{ ok: boolean; error?: string }> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  try {
    const prov = await provisionCommanderRemote({
      username,
      displayName: username,
      role,
      tier: role === "ops" ? "ops" : "squadron",
      squadronNumber: squadron?.number ?? "",
      squadronName: squadron?.name ?? "",
      squadronBase: squadron?.base ?? "",
    });
    if (!prov.ok || !prov.supabaseEmail || !prov.supabasePassword) {
      return { ok: false, error: prov.error ?? "no_creds_returned" };
    }
    storeSupabaseCreds(username, prov.supabaseEmail, prov.supabasePassword);
    const { error: sbErr } = await supabase.auth.signInWithPassword({
      email: prov.supabaseEmail,
      password: prov.supabasePassword,
    });
    if (sbErr) return { ok: false, error: sbErr.message };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function clearSupabaseCreds(username: string): void {
  const map = readCredsMap();
  delete map[username.trim().toLowerCase()];
  try { localStorage.setItem(SB_CREDS_KEY, JSON.stringify(map)); } catch { /* swallow */ }
}

// Hard retention cap for the audit_log table. Pages × page-size in the UI
// (50 × 50 = 2,500 rows) — keeping the table itself bounded means an old
// deployment can't accumulate millions of rows that slow every page load.
// Eviction runs opportunistically on insert: count rows, and if we're over
// the cap, delete the oldest row(s) so the new one fits.
export const AUDIT_RETENTION_ROWS = 2500;

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
  // Opportunistic retention eviction. We don't fail the insert if cleanup
  // hits an error — the cap is a soft guardrail, not a correctness contract.
  try {
    const { count } = await supabase
      .from("audit_log")
      .select("*", { count: "exact", head: true });
    if (typeof count === "number" && count > AUDIT_RETENTION_ROWS) {
      const overflow = count - AUDIT_RETENTION_ROWS;
      const { data: oldest } = await supabase
        .from("audit_log")
        .select("id")
        .order("occurred_at", { ascending: true })
        .limit(overflow);
      const ids = (oldest ?? []).map((r: { id: number | string }) => r.id);
      if (ids.length > 0) {
        await supabase.from("audit_log").delete().in("id", ids);
      }
    }
  } catch { /* retention is best-effort */ }
}
