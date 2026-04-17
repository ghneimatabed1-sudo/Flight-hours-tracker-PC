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
