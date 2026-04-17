// Supabase Edge Function: validate-license
//
// POST { key: string, fingerprint: string }
//
// Behaviour:
//   1. Looks up the license key in the licenses table.
//   2. Rejects if the key does not exist, is revoked, or has expired.
//   3. If bound_fingerprint is null, binds it to the supplied fingerprint
//      (one-time activation per device).
//   4. If a different fingerprint is bound, rejects with "pc_mismatch".
//   5. On success returns { ok, squadronId, expiresAt }.
//
// The function uses the SUPABASE_SERVICE_ROLE_KEY to bypass RLS so it can
// read and update the licenses table directly. Deploy with:
//   supabase functions deploy validate-license --no-verify-jwt
//
// Set the secret on the project:
//   supabase secrets set SUPABASE_SERVICE_ROLE_KEY=...

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body { key?: string; fingerprint?: string; }

function reply(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// @ts-ignore Deno is provided by the Edge runtime
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);

  let body: Body;
  try { body = await req.json(); }
  catch { return reply({ ok: false, error: "bad_json" }, 400); }

  const key = (body.key ?? "").trim().toUpperCase();
  const fingerprint = (body.fingerprint ?? "").trim();
  if (key.length < 12 || !fingerprint) {
    return reply({ ok: false, error: "missing_fields" }, 400);
  }

  // @ts-ignore Deno is provided by the Edge runtime
  const url = Deno.env.get("SUPABASE_URL");
  // @ts-ignore Deno is provided by the Edge runtime
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return reply({ ok: false, error: "server_misconfigured" }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: license, error } = await admin
    .from("licenses")
    .select("key, squadron_id, bound_fingerprint, expires_at, revoked_at")
    .eq("key", key)
    .maybeSingle();

  if (error) return reply({ ok: false, error: "lookup_failed" }, 500);
  if (!license) return reply({ ok: false, error: "unknown_key" });

  if (license.revoked_at) return reply({ ok: false, error: "revoked" });
  if (license.expires_at && new Date(license.expires_at as string).getTime() < Date.now()) {
    return reply({ ok: false, error: "expired" });
  }

  if (license.bound_fingerprint && license.bound_fingerprint !== fingerprint) {
    await admin.from("audit_log").insert({
      squadron_id: license.squadron_id,
      type: "license.activate.pc_mismatch",
      detail: { key: key.slice(0, 8) + "…", supplied: fingerprint, bound: license.bound_fingerprint },
    });
    return reply({ ok: false, error: "pc_mismatch" });
  }

  if (!license.bound_fingerprint) {
    const { error: updErr } = await admin
      .from("licenses")
      .update({ bound_fingerprint: fingerprint })
      .eq("key", key);
    if (updErr) return reply({ ok: false, error: "bind_failed" }, 500);
  }

  await admin.from("audit_log").insert({
    squadron_id: license.squadron_id,
    type: "license.activate.ok",
    detail: { key: key.slice(0, 8) + "…", fingerprint },
  });

  return reply({
    ok: true,
    squadronId: license.squadron_id,
    expiresAt: license.expires_at,
  });
});
