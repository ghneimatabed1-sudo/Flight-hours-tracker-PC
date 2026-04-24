// Supabase Edge Function: register-license
//
// POST { key, username, squadronNumber, squadronName, squadronBase, expiresAt? }
// Header: X-Provisioning-Secret: <REGISTER_LICENSE_SECRET env var>
//
//   1. Validates the REGISTER_LICENSE_SECRET header to block unauthenticated
//      callers from reaching the provisioning logic at all.
//   2. Verifies the license key ALREADY EXISTS in the licenses table (pre-seeded
//      by an admin). Arbitrary / invented keys are rejected.
//   3. Upserts the squadron row keyed by `number` so two PCs activating the
//      same physical squadron share one uuid.
//   4. Links the license row to the squadron (first activation).
//   5. Provisions a Supabase auth user for the ops account so the browser can
//      obtain a JWT carrying app_metadata.squadron_id + role="ops". Without
//      this every operational-table read/write is silently filtered out by
//      RLS and PCs cannot share data.
//   6. Mirrors the auth user into public.users (REQUIRED — failure here is
//      surfaced as `user_mirror_failed` so the client retries; without this
//      row, dashboard joins on public.users (audit actor display, member
//      lists, role lookups) silently miss the ops account).
//   7. Returns { ok, squadronId, supabaseEmail, supabasePassword } — the
//      client persists the supabase creds locally and uses them to sign into
//      Supabase right after the local password verify on every login.
//
// Deploy with:
//   supabase functions deploy register-license --no-verify-jwt
//   (Bootstrap flow — no existing session yet, but protected by the shared secret)
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-provisioning-secret",
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

  // ── Provisioning secret gate ─────────────────────────────────────────────
  // This function is deployed with --no-verify-jwt because it is part of the
  // initial bootstrap flow (no Supabase session exists yet). We compensate by
  // requiring a pre-shared secret known only to legitimate client builds.
  // Set REGISTER_LICENSE_SECRET in the Supabase function secrets (not in the
  // client env), then embed the matching value as VITE_REGISTER_LICENSE_SECRET
  // in the desktop build. Never expose this secret in a public web build.
  // @ts-ignore Deno
  const expectedSecret = Deno.env.get("REGISTER_LICENSE_SECRET") ?? "";
  if (!expectedSecret) {
    // Misconfigured deployment — refuse all requests until the secret is set.
    return reply({ ok: false, error: "server_misconfigured" }, 503);
  }

  const incomingSecret = req.headers.get("x-provisioning-secret") ?? "";
  // Constant-time comparison to prevent timing attacks.
  if (incomingSecret.length !== expectedSecret.length ||
      !constantTimeEqual(incomingSecret, expectedSecret)) {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }

  // ── Parse body ───────────────────────────────────────────────────────────
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

  // ── License key validation ───────────────────────────────────────────────
  // The license key MUST have been pre-seeded by an admin (via the admin
  // dashboard or a migration). We do NOT allow arbitrary keys to be invented
  // and inserted here — that would let any caller bootstrap a squadron account
  // for any key they invent.
  const { data: licenseRow, error: licLookupErr } = await admin
    .from("licenses")
    .select("key, squadron_id, expires_at, revoked_at")
    .eq("key", key)
    .maybeSingle();

  if (licLookupErr) {
    return reply({ ok: false, error: "license_lookup_failed", detail: licLookupErr.message }, 500);
  }
  if (!licenseRow) {
    // Key does not exist — not a legitimately issued key.
    return reply({ ok: false, error: "invalid_license_key" }, 403);
  }
  if (licenseRow.revoked_at && new Date(licenseRow.revoked_at) <= new Date()) {
    return reply({ ok: false, error: "license_revoked" }, 403);
  }
  if (licenseRow.expires_at && new Date(licenseRow.expires_at) < new Date()) {
    return reply({ ok: false, error: "license_expired" }, 403);
  }

  // ── Verify the license belongs to the requested squadron ─────────────────
  // licenses.squadron_id is NOT NULL — every key is pre-seeded with the
  // squadron it may activate. Reject attempts to use a key for a different
  // squadron (prevents cross-tenant key reuse).
  const licSqnId = licenseRow.squadron_id as string;

  // Look up the squadron by the number supplied by the caller.
  const { data: requestedSqn } = await admin
    .from("squadrons")
    .select("id")
    .eq("number", sqnNumber)
    .maybeSingle();

  if (requestedSqn && requestedSqn.id !== licSqnId) {
    // The key belongs to a different squadron than the one being requested.
    return reply({ ok: false, error: "license_squadron_mismatch" }, 403);
  }

  // ── Upsert squadron by number ────────────────────────────────────────────
  // The authoritative squadron record is identified by the license's
  // squadron_id — we use that as our source of truth.
  const squadronId = licSqnId;

  // ── Provision the Supabase auth user for this ops account ────────────────
  const email = `${username}@${sqnSlug(sqnNumber)}.rjaf.local`;
  const password = randomPassword();
  // squadron_ids is the JWT allow-list the snapshot SELECT policy
  // (migration 0061) checks. Ops accounts only ever monitor their own
  // squadron, so the allow-list is the single squadron name. We populate
  // it here for parity with provision-commander so every freshly issued
  // ops account passes the same RLS check that wing/base/HQ commanders do.
  const appMeta = {
    squadron_id: squadronId,
    role: "ops",
    tier: "ops",
    squadron_number: sqnNumber,
    pc_id: sqnName,
    squadron_ids: sqnName ? [sqnName] : null,
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

  // ── Mirror into public.users (REQUIRED; fail loudly) ─────────────────────
  // Every dashboard feature that joins public.users to display ops accounts
  // (audit-log actor lookups, squadron member listings, role checks against
  // public.users instead of app_metadata) silently misses ops accounts when
  // this row is absent. Previous versions swallowed the error here, which is
  // exactly how the gap audited in audit-2026-04-25 went undetected. If this
  // upsert fails we MUST surface the error so the client retries — the auth
  // user has already been created/updated and updateUserById is idempotent,
  // so the next call repairs the state.
  const { error: mirrorErr } = await admin.from("users").upsert(
    {
      id: userId,
      squadron_id: squadronId,
      username,
      display_name: displayName || username,
      role: "ops",
    },
    { onConflict: "id" },
  );
  if (mirrorErr) {
    return reply(
      { ok: false, error: "user_mirror_failed", detail: mirrorErr.message },
      500,
    );
  }

  const { error: auditErr } = await admin.from("audit_log").insert({
    squadron_id: squadronId,
    type: "license.register",
    actor: username,
    detail: { key: key.slice(0, 8) + "…", squadronNumber: sqnNumber },
  });
  if (auditErr) {
    return reply(
      { ok: false, error: "audit_write_failed", detail: auditErr.message },
      500,
    );
  }

  return reply({
    ok: true,
    squadronId,
    supabaseEmail: email,
    supabasePassword: password,
  });
});

/**
 * Constant-time string comparison to prevent timing side-channel attacks
 * when comparing the provisioning secret.
 */
function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
