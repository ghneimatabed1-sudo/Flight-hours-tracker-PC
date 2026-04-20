// Supabase Edge Function: register-license
//
// POST { key, username, squadronNumber, squadronName, squadronBase, expiresAt? }
//
//   1. Upserts the squadron row keyed by `number` so two PCs activating the
//      same physical squadron share one uuid.
//   2. Inserts the license row (bound_fingerprint=null until first activation).
//   3. Provisions a Supabase auth user for the ops account so the browser can
//      obtain a JWT carrying app_metadata.squadron_id + role="ops". Without
//      this every operational-table read/write is silently filtered out by
//      RLS and PCs cannot share data.
//   4. Mirrors the auth user into public.users.
//   5. Returns { ok, squadronId, supabaseEmail, supabasePassword } — the
//      client persists the supabase creds locally and uses them to sign into
//      Supabase right after the local password verify on every login.
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
  displayName?: string;
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

function randomPassword(): string {
  const arr = new Uint8Array(24);
  crypto.getRandomValues(arr);
  return Array.from(arr).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function sqnSlug(n: string): string {
  return (n || "rjaf").toLowerCase().replace(/[^a-z0-9]/g, "");
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
  const displayName = (body.displayName ?? username).trim();
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

  // 1. Upsert squadron by number.
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

  // 2. Idempotent license insert.
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

  // 3. Provision (or refresh) the Supabase auth user for this ops account.
  //    Email is deterministic: `${username}@${slug(squadronNumber)}.rjaf.local`
  //    so two PCs setting up the same squadron+username converge on one auth
  //    user. The password we mint here is random and only stored in the
  //    response — the client persists it locally and uses it for subsequent
  //    auth.signInWithPassword calls.
  const email = `${username}@${sqnSlug(sqnNumber)}.rjaf.local`;
  const password = randomPassword();
  const appMeta = {
    squadron_id: squadronId,
    role: "ops",
    tier: "ops",
    squadron_number: sqnNumber,
  };
  const userMeta = { displayName };

  let userId: string | null = null;
  try {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users?.find((u: any) => (u.email ?? "").toLowerCase() === email);
    if (match) userId = match.id;
  } catch (_) { /* listUsers not strictly required to succeed */ }

  if (userId) {
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      password,
      app_metadata: appMeta,
      user_metadata: userMeta,
    });
    if (updErr) {
      return reply({ ok: false, error: "user_update_failed", detail: updErr.message }, 500);
    }
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      app_metadata: appMeta,
      user_metadata: userMeta,
    });
    if (createErr || !created.user) {
      return reply({ ok: false, error: "user_create_failed", detail: createErr?.message }, 500);
    }
    userId = created.user.id;
  }

  // 4. Mirror into public.users (best-effort; not fatal).
  try {
    await admin.from("users").upsert(
      {
        id: userId,
        squadron_id: squadronId,
        username,
        display_name: displayName || username,
        role: "ops",
      },
      { onConflict: "id" },
    );
  } catch (_) { /* swallow */ }

  await admin.from("audit_log").insert({
    squadron_id: squadronId,
    type: "license.register",
    actor: username,
    detail: { key: key.slice(0, 8) + "…", squadronNumber: sqnNumber },
  });

  return reply({
    ok: true,
    squadronId,
    supabaseEmail: email,
    supabasePassword: password,
  });
});
