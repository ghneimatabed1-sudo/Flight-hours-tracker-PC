// Supabase Edge Function: provision-commander
//
// POST { username, displayName, role, tier, squadronNumber, squadronName, squadronBase }
//
// Creates (or refreshes) a Supabase auth user for a non-ops account
// (Squadron / Flight commander or deputy) so the browser can obtain a JWT
// carrying app_metadata.squadron_id + role. Without this every
// operational-table query is filtered out by RLS and the commander sees
// nothing.
//
// HQ Commander (tier="hq") has no squadron — provisioned with squadron_id
// null; they will not pass squadron-RLS by design.
//
// Deploy with:
//   supabase functions deploy provision-commander --no-verify-jwt
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

  // @ts-ignore Deno
  const url = Deno.env.get("SUPABASE_URL")!;
  // @ts-ignore Deno
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

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
  // Compute the canonical cross-PC id this account is allowed to claim
  // in cross-pc.ts. The id mirrors what HQLayout passes to
  // registerLocalPC():
  //   ops / squadron-tier  → the squadron's display name
  //   wing/base/hq         → "<TIER>:<displayName>"
  // RLS on xpc_user_pcs uses meta.pc_id as the only valid value the
  // user may insert, blocking cross-tenant impersonation.
  let pcId: string | null = null;
  if (tier === "ops" || tier === "squadron" || tier === "deputy") {
    pcId = sqnName || null;
  } else if (tier === "wing") {
    pcId = `WING:${displayName}`;
  } else if (tier === "base") {
    pcId = `BASE:${displayName}`;
  } else if (tier === "hq" || tier === "flight") {
    // Flight commanders sit under HQLayout's "hq" fallback today.
    pcId = `HQ:${displayName}`;
  }
  const appMeta = {
    squadron_id: squadronId,
    role: appRole,
    tier,
    squadron_number: sqnNumber || null,
    pc_id: pcId,
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

  // Mirror into public.users where possible. public.users requires
  // squadron_id NOT NULL, so HQ commanders are skipped.
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
    actor: username,
    detail: { role: appRole, tier, squadronNumber: sqnNumber || null },
  });

  return reply({
    ok: true,
    userId,
    supabaseEmail: email,
    supabasePassword: password,
  });
});
