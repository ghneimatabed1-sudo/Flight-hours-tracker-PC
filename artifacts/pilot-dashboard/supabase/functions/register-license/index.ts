// Supabase Edge Function: register-license
//
// POST { key, username, squadronNumber, squadronName, squadronBase, expiresAt? }
//   1. Upserts the squadron row keyed by `number` (so two PCs setting up the
//      same physical squadron share the same uuid).
//   2. Inserts the license key row, bound_fingerprint=null so the FIRST
//      activation seals it to that PC.
//   3. Returns { ok: true, squadronId }.
//
// Called by the Super Admin / device-setup flow IMMEDIATELY before
// `validate-license` is invoked. Without this step the validate-license call
// returns "unknown_key" because the row was never written server-side.
//
// Deploy with:
//   supabase functions deploy register-license --no-verify-jwt
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  key?: string;
  username?: string;
  squadronNumber?: string;
  squadronName?: string;
  squadronBase?: string;
  expiresAt?: string | null;
}

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
  const username = (body.username ?? "").trim().toLowerCase();
  const sqnNumber = (body.squadronNumber ?? "").trim();
  const sqnName = (body.squadronName ?? "").trim() || `Squadron ${sqnNumber}`;
  const sqnBase = (body.squadronBase ?? "").trim() || "Unknown";

  if (key.length < 12 || !username || !sqnNumber) {
    return reply({ ok: false, error: "missing_fields" }, 400);
  }

  // @ts-ignore Deno
  const url = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore Deno
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Upsert squadron by number.
  let squadronId: string;
  const { data: existingSqn } = await admin
    .from("squadrons")
    .select("id")
    .eq("number", sqnNumber)
    .maybeSingle();

  if (existingSqn) {
    squadronId = existingSqn.id as string;
  } else {
    const { data: created, error: sqnErr } = await admin
      .from("squadrons")
      .insert({ number: sqnNumber, name: sqnName, base: sqnBase })
      .select("id")
      .single();
    if (sqnErr || !created) {
      return reply({ ok: false, error: "squadron_create_failed", detail: sqnErr?.message }, 500);
    }
    squadronId = created.id as string;
  }

  // Idempotent license insert: if the key already exists (rare collision), bail out.
  const { data: existingLic } = await admin
    .from("licenses")
    .select("key")
    .eq("key", key)
    .maybeSingle();

  if (!existingLic) {
    const { error: licErr } = await admin.from("licenses").insert({
      key,
      squadron_id: squadronId,
      bound_fingerprint: null,
      expires_at: body.expiresAt ?? null,
    });
    if (licErr) {
      return reply({ ok: false, error: "license_create_failed", detail: licErr.message }, 500);
    }
  }

  // Audit
  await admin.from("audit_log").insert({
    squadron_id: squadronId,
    type: "license.register",
    actor: username,
    detail: { key: key.slice(0, 8) + "…", squadronNumber: sqnNumber },
  });

  return reply({ ok: true, squadronId });
});
