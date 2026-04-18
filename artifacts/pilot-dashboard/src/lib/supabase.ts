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
  squadronNumber: string;
  squadronName?: string;
  squadronBase?: string;
  expiresAt?: string | null;
}

// Registers a freshly-minted license key with the central server so that the
// subsequent validate-license call can find it. MUST be called BEFORE the
// client tries to activate the key — otherwise validate-license returns
// "unknown_key" and the user is locked out of their own brand-new install.
export async function registerLicenseRemote(
  args: RegisterLicenseArgs
): Promise<{ ok: boolean; error?: string; squadronId?: string }> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await supabase.functions.invoke("register-license", {
    body: args,
  });
  if (error) return { ok: false, error: error.message };
  const payload = data as { ok?: boolean; error?: string; squadronId?: string } | null;
  if (!payload?.ok) return { ok: false, error: payload?.error ?? "register_failed" };
  return { ok: true, squadronId: payload.squadronId };
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
