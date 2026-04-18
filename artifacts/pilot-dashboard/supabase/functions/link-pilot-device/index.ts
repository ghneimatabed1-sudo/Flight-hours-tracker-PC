// Supabase Edge Function: link-pilot-device  (v6)
//
// POST { mil: string, code: string }
//
// Validates a one-time link code and provisions a per-pilot Supabase auth
// user, returning a real session for the mobile app to use under RLS.
//
// v6 changes (Apr 2026):
//   - Case-INsensitive `id` lookup (ilike) — fixes pairing failures on
//     decks where the only identifier is the pilots.id row key (e.g.
//     "RADWAN") and the pilot types it in different casing.
//   - Looks at the top-level `name` and `arabic_name` columns in addition
//     to the JSON-blob fields, since the dashboard pilot form writes both.
//   - Adds `data->>phone` as a fallback identifier.
//   - Logs each lookup attempt + outcome to function logs (visible via
//     Supabase Studio → Edge Functions → Logs) so failures are diagnosable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function reply(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function sha256Hex(input: string) {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input),
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomPassword() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// deno-lint-ignore no-explicit-any
type Sb = any;

async function findPilot(admin: Sb, raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  // Try identifiers in priority order — first hit wins.
  // Each lookup is case-insensitive (ilike) and uses the FULL string;
  // we never substring-match to avoid cross-pilot collisions.
  const attempts: { label: string; build: () => Sb }[] = [
    {
      label: "id (case-insensitive)",
      build: () => admin.from("pilots").select("*").ilike("id", trimmed),
    },
    {
      label: "name (column)",
      build: () => admin.from("pilots").select("*").ilike("name", trimmed),
    },
    {
      label: "arabic_name (column)",
      build: () =>
        admin.from("pilots").select("*").ilike("arabic_name", trimmed),
    },
    {
      label: "data.militaryNumber",
      build: () =>
        admin
          .from("pilots")
          .select("*")
          .filter("data->>militaryNumber", "ilike", trimmed),
    },
    {
      label: "data.callSign",
      build: () =>
        admin
          .from("pilots")
          .select("*")
          .filter("data->>callSign", "ilike", trimmed),
    },
    {
      label: "data.flightName",
      build: () =>
        admin
          .from("pilots")
          .select("*")
          .filter("data->>flightName", "ilike", trimmed),
    },
    {
      label: "data.name",
      build: () =>
        admin.from("pilots").select("*").filter("data->>name", "ilike", trimmed),
    },
    {
      label: "data.arabicName",
      build: () =>
        admin
          .from("pilots")
          .select("*")
          .filter("data->>arabicName", "ilike", trimmed),
    },
    {
      label: "data.phone",
      build: () =>
        admin
          .from("pilots")
          .select("*")
          .filter("data->>phone", "ilike", trimmed),
    },
  ];

  for (const a of attempts) {
    const { data, error } = await a.build().limit(1);
    if (error) {
      console.log(`[link] lookup ${a.label} ERROR:`, error.message);
      continue;
    }
    if (data && data.length > 0) {
      console.log(`[link] matched pilot via ${a.label}: id=${data[0].id}`);
      return data[0];
    }
  }
  console.log(`[link] no pilot matched identifier "${trimmed}"`);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return reply({ ok: false, error: "method_not_allowed" }, 405);
  }

  let body: { mil?: string; code?: string };
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, error: "bad_json" }, 400);
  }
  const mil = (body.mil ?? "").trim();
  const code = (body.code ?? "").trim();
  if (!mil || !code) {
    return reply({ ok: false, error: "invalid_credentials" }, 400);
  }

  const url = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !anonKey || !serviceKey) {
    return reply({ ok: false, error: "server_misconfigured" }, 500);
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // 1. Resolve pilot from any identifier the Super Admin assigned.
  const pilot = await findPilot(admin, mil);
  if (!pilot) {
    return reply({ ok: false, error: "not_found" }, 404);
  }

  // 2. Verify the one-time code: SHA-256 hash, must be unconsumed and
  //    not expired, and must belong to this pilot.
  const codeHash = await sha256Hex(code);
  const { data: codeRow, error: codeErr } = await admin
    .from("pilot_link_codes")
    .select("id, pilot_id, squadron_id, expires_at, consumed_at")
    .eq("pilot_id", pilot.id)
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("issued_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (codeErr) {
    console.log("[link] code lookup error:", codeErr.message);
    return reply({ ok: false, error: "generic" }, 500);
  }
  if (!codeRow) {
    console.log(`[link] no valid code for pilot ${pilot.id}`);
    return reply({ ok: false, error: "bad_code" }, 401);
  }

  // 3. Provision (or refresh) the per-pilot auth user. Email is synthetic;
  //    the real auth is the link code.
  const email = `pilot+${pilot.id.toLowerCase()}@rjaf.local`.replace(/\s+/g, "");
  const password = randomPassword();

  // a. Try create. If already exists, fetch + update password.
  let userId: string | null = null;
  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: {
      pilot_id: pilot.id,
      squadron_id: codeRow.squadron_id,
      role: "pilot",
    },
    user_metadata: { pilot_id: pilot.id },
  });
  if (created?.user) {
    userId = created.user.id;
  } else if (createErr && /already/i.test(createErr.message ?? "")) {
    // Locate the existing user by email and rotate password.
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    const existing = list?.users?.find((u) => (u.email ?? "").toLowerCase() === email);
    if (!existing) {
      console.log("[link] could not locate existing auth user for", email);
      return reply({ ok: false, error: "generic" }, 500);
    }
    userId = existing.id;
    await admin.auth.admin.updateUserById(existing.id, {
      password,
      app_metadata: {
        pilot_id: pilot.id,
        squadron_id: codeRow.squadron_id,
        role: "pilot",
      },
    });
  } else if (createErr) {
    console.log("[link] createUser error:", createErr.message);
    return reply({ ok: false, error: "generic" }, 500);
  }
  if (!userId) {
    return reply({ ok: false, error: "generic" }, 500);
  }

  // 4. Sign in as the user with the rotated password to get a real
  //    session for the mobile app.
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({
    email,
    password,
  });
  if (signErr || !signIn?.session) {
    console.log("[link] sign-in error:", signErr?.message);
    return reply({ ok: false, error: "generic" }, 500);
  }

  // 5. Mark the code consumed and record the device link.
  await admin.from("pilot_link_codes").update({
    consumed_at: new Date().toISOString(),
  }).eq("id", codeRow.id);

  await admin.from("pilot_devices").upsert(
    {
      pilot_id: pilot.id,
      user_id: userId,
      linked_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  return reply({
    ok: true,
    pilotId: pilot.id,
    squadronId: codeRow.squadron_id,
    session: {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_at: signIn.session.expires_at,
    },
  });
});
