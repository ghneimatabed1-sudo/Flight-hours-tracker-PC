// Edge function: heal-claims
//
// v1.1.73 — Critical Bug 1 root-cause companion to the 0030 backfill
// migration. The migration handles the bulk case server-side; this
// function closes the gap whenever the migration has not been
// applied yet (older self-hosted installs) or when an auth user was
// created out-of-band by an admin and is missing the
// app_metadata.squadron_id / role claims that every squadron-scoped
// edge function (provision-user, register-license, ...) and every
// RLS policy depend on.
//
// Idempotent: if the caller's app_metadata already carries both
// squadron_id and role, the function returns ok without touching
// anything. Operates ONLY on the JWT-authenticated caller — there is
// no path here to mutate any other user's claims, so it is safe to
// expose to every signed-in user.

import { serve } from "https://deno.land/std@0.208.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ ok: false, error: "method_not_allowed" }, 405);

  // Caller identification — pulls user_id straight from the JWT, never
  // trusts any payload field.
  const authHeader = req.headers.get("Authorization") ?? "";
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: caller, error: callerErr } = await userClient.auth.getUser();
  if (callerErr || !caller?.user) {
    return json({ ok: false, error: "unauthenticated", detail: callerErr?.message }, 401);
  }
  const userId = caller.user.id;
  const meta = (caller.user.app_metadata ?? {}) as { squadron_id?: string; role?: string };
  if (meta.squadron_id && meta.role) {
    return json({ ok: true, healed: false, reason: "already_stamped" });
  }

  // Service-role client to (a) look up the public.users row and (b) call
  // auth.admin.updateUserById. Both are gated by the JWT-derived userId
  // above so a caller can only heal their OWN claims.
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE);
  const { data: pu, error: puErr } = await admin
    .from("users")
    .select("squadron_id, role")
    .eq("id", userId)
    .maybeSingle();
  if (puErr) return json({ ok: false, error: "lookup_failed", detail: puErr.message }, 500);
  if (!pu?.squadron_id) {
    return json({ ok: false, error: "no_squadron_for_user", detail: "public.users row is missing or has no squadron_id — re-provision required" }, 422);
  }

  // Read squadron number for app_metadata.squadron_number (used by the
  // license-key flow). LOWER() so it matches the convention provision-
  // user already follows.
  const { data: sq } = await admin
    .from("squadrons")
    .select("number")
    .eq("id", pu.squadron_id)
    .maybeSingle();
  const squadronNumber = (sq?.number ?? "rjaf").toString().toLowerCase();

  const nextMeta = {
    ...(caller.user.app_metadata ?? {}),
    squadron_id: pu.squadron_id,
    role: pu.role ?? meta.role ?? "ops",
    squadron_number: squadronNumber,
  };

  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: nextMeta,
  });
  if (updErr) return json({ ok: false, error: "update_failed", detail: updErr.message }, 500);

  return json({ ok: true, healed: true, app_metadata: nextMeta });
});
