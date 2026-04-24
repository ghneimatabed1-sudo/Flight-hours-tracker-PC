// Supabase Edge Function: provision-commander
//
// POST { username, displayName, role, tier, squadronNumber, squadronName,
//        squadronBase, squadronNames? }
//
// Creates (or refreshes) a Supabase auth user for a non-ops account
// (Squadron / Flight commander or deputy) so the browser can obtain a JWT
// carrying app_metadata.squadron_id + role. Without this every
// operational-table query is filtered out by RLS and the commander sees
// nothing.
//
// `squadronNames` is the multi-squadron allow-list for wing/base/HQ
// commanders — written verbatim into app_metadata.squadron_ids so the
// xpc_squadron_snapshot SELECT policy (migration 0061) admits the rows
// the commander is meant to monitor. The values must match the
// snapshot.squadron_id text column (= squadron name). Single-squadron
// commanders (squadron/flight) fall back to [squadronName] automatically.
//
// HQ Commander (tier="hq") has no single squadron — provisioned with
// squadron_id null; the squadron_ids allow-list is what unblocks their
// dashboard reads.
//
// Deploy with:
//   supabase functions deploy provision-commander
//   (JWT verification is required — do NOT use --no-verify-jwt)
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface Body {
  username?: string;
  displayName?: string;
  role?: "ops" | "commander" | "deputy";
  tier?: "hq" | "wing" | "base" | "squadron" | "flight" | "ops" | "deputy";
  squadronNumber?: string;
  squadronName?: string;
  squadronBase?: string;
  // Multi-squadron allow-list: array of squadron names (matching
  // public.squadrons.name and xpc_squadron_snapshot.squadron_id).
  squadronNames?: string[];
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

// @ts-ignore Deno
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);

  // ── Authentication gate ──────────────────────────────────────────────────
  // JWT verification is enabled for this function (deployed WITHOUT
  // --no-verify-jwt). Supabase validates the token before we even reach here,
  // but we additionally inspect the claims to enforce that only already-
  // authenticated ops/admin users can provision new accounts.
  // @ts-ignore Deno
  const url = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore Deno
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  // @ts-ignore Deno
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const callerToken = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";

  if (!callerToken) {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }

  // Verify the caller's JWT and inspect their app_metadata claims.
  const callerClient = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${callerToken}` } },
  });
  const { data: { user: callerUser }, error: callerErr } = await callerClient.auth.getUser();
  if (callerErr || !callerUser) {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }

  const callerRole = (callerUser.app_metadata?.role as string | undefined) ?? "";
  const allowedRoles = ["ops", "admin"];
  if (!allowedRoles.includes(callerRole)) {
    return reply({ ok: false, error: "forbidden" }, 403);
  }

  // ── Parse body ───────────────────────────────────────────────────────────
  let body: Body;
  try { body = await req.json(); } catch { return reply({ ok: false, error: "bad_json" }, 400); }

  const username = (body.username ?? "").trim().toLowerCase();
  const displayName = (body.displayName ?? username).trim();
  const role = body.role ?? "commander";
  const tier = body.tier ?? "squadron";
  const sqnNumber = (body.squadronNumber ?? "").trim();
  const sqnName = (body.squadronName ?? `Squadron ${sqnNumber}`).trim();
  const sqnBase = (body.squadronBase ?? "Unknown").trim();

  if (!username) return reply({ ok: false, error: "missing_username" }, 400);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // ── Enforce caller-level privilege constraints ────────────────────────────
  if (callerRole === "ops") {
    // Ops callers may only provision accounts within their own squadron.
    // They must always supply a squadronNumber — omitting it would allow
    // creating a null-squadron (HQ-scoped) account which bypasses RLS.
    if (!sqnNumber) {
      return reply({ ok: false, error: "squadron_number_required" }, 400);
    }

    // Ops callers may only provision squadron/flight/deputy-tier accounts.
    // Allowing hq/wing/base would let them create cross-tenant admin accounts.
    const opsAllowedTiers = ["squadron", "flight", "deputy"];
    if (!opsAllowedTiers.includes(tier)) {
      return reply({ ok: false, error: "forbidden" }, 403);
    }

    // Ops callers may not promote accounts to role=ops (would create a
    // parallel ops account for the same squadron outside normal provisioning).
    if (role === "ops") {
      return reply({ ok: false, error: "forbidden" }, 403);
    }

    // Verify the target squadron number maps to the caller's own squadron.
    const callerSqnId = callerUser.app_metadata?.squadron_id as string | undefined;
    if (!callerSqnId) {
      return reply({ ok: false, error: "forbidden" }, 403);
    }
    const { data: targetSqn } = await admin
      .from("squadrons")
      .select("id")
      .eq("number", sqnNumber)
      .maybeSingle();
    if (!targetSqn || targetSqn.id !== callerSqnId) {
      return reply({ ok: false, error: "forbidden" }, 403);
    }
  } else if (callerRole === "admin") {
    // Admin (HQ-tier) callers may provision any tier and across squadrons,
    // but may not create new role=ops accounts (those go through register-license).
    if (role === "ops") {
      return reply({ ok: false, error: "forbidden" }, 403);
    }
  }

  // Resolve squadron. Optional for HQ commander.
  let squadronId: string | null = null;
  if (sqnNumber) {
    const { data: existing } = await admin
      .from("squadrons")
      .select("id")
      .eq("number", sqnNumber)
      .maybeSingle();
    if (existing) {
      squadronId = existing.id as string;
    } else {
      // Only admins may implicitly create new squadron rows.
      if (callerRole !== "admin") {
        return reply({ ok: false, error: "squadron_not_found" }, 404);
      }
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
  }

  const appRole = role === "ops" ? "ops" : role === "deputy" ? "deputy" : "admin";
  const email = `${username}@${sqnSlug(sqnNumber)}.rjaf.local`;
  const password = randomPassword();

  let pcId: string | null = null;
  if (tier === "ops" || tier === "squadron" || tier === "deputy") {
    pcId = sqnName || null;
  } else if (tier === "wing") {
    pcId = `WING:${displayName}`;
  } else if (tier === "base") {
    pcId = `BASE:${displayName}`;
  } else if (tier === "hq" || tier === "flight") {
    pcId = `HQ:${displayName}`;
  }
  // Resolve the squadron_ids allow-list that gates the snapshot SELECT
  // policy (migration 0061). For multi-squadron tiers we trust the caller-
  // supplied list but validate each name against public.squadrons so a
  // typo can't smuggle a bogus claim into a JWT. For single-squadron
  // tiers we fall back to [squadronName] so the commander still sees their
  // own snapshot row without a separate caller change.
  let squadronIdsClaim: string[] | null = null;
  const rawNames = Array.isArray(body.squadronNames) ? body.squadronNames : [];
  const cleanedNames = Array.from(
    new Set(
      rawNames
        .map((n) => (typeof n === "string" ? n.trim() : ""))
        .filter((n) => n.length > 0),
    ),
  );
  if (cleanedNames.length > 0) {
    const { data: validRows } = await admin
      .from("squadrons")
      .select("name")
      .in("name", cleanedNames);
    const valid = new Set((validRows ?? []).map((r: any) => r.name as string));
    const accepted = cleanedNames.filter((n) => valid.has(n));
    if (accepted.length > 0) squadronIdsClaim = accepted.sort();
  }
  // Squadron/flight commanders typically don't pass squadronNames — fall
  // back to their single squadron so the snapshot RLS still admits them.
  if (!squadronIdsClaim && sqnName && (tier === "squadron" || tier === "flight")) {
    squadronIdsClaim = [sqnName];
  }

  const appMeta = {
    squadron_id: squadronId,
    role: appRole,
    tier,
    squadron_number: sqnNumber || null,
    pc_id: pcId,
    squadron_ids: squadronIdsClaim,
  };
  const userMeta = { displayName };

  let userId: string | null = null;
  try {
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const match = list?.users?.find((u: any) => (u.email ?? "").toLowerCase() === email);
    if (match) userId = match.id;
  } catch (_) { /* ignore */ }

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

  if (squadronId) {
    try {
      await admin.from("users").upsert(
        {
          id: userId,
          squadron_id: squadronId,
          username,
          display_name: displayName || username,
          role: appRole === "admin" ? "admin" : appRole,
        },
        { onConflict: "id" },
      );
    } catch (_) { /* ignore */ }
  }

  await admin.from("audit_log").insert({
    squadron_id: squadronId,
    type: "user.provision",
    actor: callerUser.id,
    detail: {
      provisionedUsername: username,
      role: appRole,
      tier,
      squadronNumber: sqnNumber || null,
      squadronIds: squadronIdsClaim,
    },
  });

  return reply({
    ok: true,
    userId,
    supabaseEmail: email,
    supabasePassword: password,
  });
});
