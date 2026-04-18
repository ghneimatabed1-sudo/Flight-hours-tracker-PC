// Supabase Edge Function: link-pilot-device
//
// POST { mil: string, code: string }
//
// Validates a one-time link code (issued from the dashboard via
// `issue_pilot_link_code`), provisions / refreshes a per-pilot Supabase auth
// user, and returns a real Supabase session that the mobile app can use to
// read its own row from `pilots` / `sorties` under RLS.
//
// Why an edge function (and not a SQL RPC):
//   * Creating an auth user and stamping app_metadata requires the service
//     role key, which must never reach the mobile client.
//   * The function then signs in as that user with a freshly rotated
//     password so it can hand the mobile app an access_token /
//     refresh_token pair.
//
// Deploy with:
//   supabase functions deploy link-pilot-device --no-verify-jwt
// Required secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.

import {
  createClient,
  type User,
} from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface LinkRequestBody {
  mil?: string;
  code?: string;
}

interface PilotLookup {
  id: string;
  squadron_id: string;
  auth_user_id: string | null;
}

interface PilotLinkCodeRow {
  id: string;
  expires_at: string;
  consumed_at: string | null;
}

interface SquadronLookup {
  number: string;
}

interface LinkResponse {
  ok: boolean;
  error?: string;
  detail?: string;
  pilotId?: string;
  squadronId?: string;
  session?: {
    access_token: string;
    refresh_token: string;
    expires_in?: number;
    expires_at?: number;
    token_type?: string;
  };
}

function reply(payload: LinkResponse, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

async function sha256Hex(input: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(input)
  );
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function randomPassword(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  // base64url, plenty of entropy, satisfies Supabase's >=8 char rule.
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

// @ts-ignore Deno provided by the Edge runtime
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (req: Request) => Response | Promise<Response>): void;
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST")
    return reply({ ok: false, error: "method_not_allowed" }, 405);

  let body: LinkRequestBody;
  try {
    body = (await req.json()) as LinkRequestBody;
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

  // 1. Look up the pilot. The dashboard stores the actual military number
  //    inside the JSON `data->>militaryNumber` blob — `pilots.id` is just
  //    the auto-generated row key (e.g. "P001"). Match either, so a pilot
  //    can type whichever one the squadron records as their military number.
  //    Generic error on miss to avoid confirming which numbers exist.
  let pilot: PilotLookup | null = null;
  let pilotErr: { message: string } | null = null;
  {
    const byMil = await admin
      .from("pilots")
      .select("id, squadron_id, auth_user_id")
      .eq("data->>militaryNumber", mil)
      .limit(1)
      .maybeSingle<PilotLookup>();
    if (byMil.error) pilotErr = byMil.error;
    pilot = byMil.data ?? null;
  }
  if (!pilot && !pilotErr) {
    const byId = await admin
      .from("pilots")
      .select("id, squadron_id, auth_user_id")
      .eq("id", mil)
      .maybeSingle<PilotLookup>();
    if (byId.error) pilotErr = byId.error;
    pilot = byId.data ?? null;
  }
  if (pilotErr) return reply({ ok: false, error: "lookup_failed" }, 500);
  if (!pilot) return reply({ ok: false, error: "invalid_credentials" });

  // 2. Validate the code. Hashed at rest; compare hashes.
  const codeHash = await sha256Hex(code);
  const { data: codeRow } = await admin
    .from("pilot_link_codes")
    .select("id, expires_at, consumed_at")
    .eq("pilot_id", pilot.id)
    .eq("code_hash", codeHash)
    .is("consumed_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle<PilotLinkCodeRow>();
  if (!codeRow) return reply({ ok: false, error: "invalid_credentials" });

  // 3. Mark the code consumed BEFORE provisioning the auth user. Use the
  //    `is consumed_at null` guard + select-after-update to enforce the
  //    one-time semantic: if a concurrent request consumed it first, our
  //    update returns zero rows and we abort.
  const { data: consumed, error: consumeErr } = await admin
    .from("pilot_link_codes")
    .update({ consumed_at: new Date().toISOString() })
    .eq("id", codeRow.id)
    .is("consumed_at", null)
    .select("id");
  if (consumeErr) return reply({ ok: false, error: "consume_failed" }, 500);
  if (!consumed || consumed.length === 0) {
    return reply({ ok: false, error: "invalid_credentials" });
  }

  // 4. Resolve the squadron number (used to synthesize a stable email).
  const { data: sqRow } = await admin
    .from("squadrons")
    .select("number")
    .eq("id", pilot.squadron_id)
    .maybeSingle<SquadronLookup>();
  const squadronNumber = (sqRow?.number ?? "rjaf")
    .toString()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  // Pilot ids are military numbers (alnum). Email scheme matches
  // provision-user's `${user}@${sq}.rjaf.local` pattern so audit trails stay
  // legible.
  const safePilotId = pilot.id.toLowerCase().replace(/[^a-z0-9]/g, "");
  const email = `pilot-${safePilotId}@${squadronNumber}.rjaf.mobile`;

  // 5. Create the auth user on first link, otherwise rotate their password
  //    and refresh their app_metadata so the JWT has the latest claims.
  const password = randomPassword();
  let authUserId: string | null = pilot.auth_user_id;

  const appMetadata = { role: "pilot", pilot_id: pilot.id };

  if (!authUserId) {
    const { data: created, error: createErr } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        app_metadata: appMetadata,
        user_metadata: { pilot_id: pilot.id },
      });
    if (createErr || !created.user) {
      // The pilot may have an orphaned auth user from a previous attempt.
      // Try to recover by paging through listUsers() until we hit the email
      // (or run out of pages). Pagination ceiling is generous but bounded
      // so a runaway project never hangs the function.
      let existing: User | undefined;
      for (let page = 1; page <= 50 && !existing; page++) {
        const { data: list, error: listErr } =
          await admin.auth.admin.listUsers({ page, perPage: 200 });
        if (listErr) break;
        existing = list?.users?.find((u: User) => u.email === email);
        if (!list?.users || list.users.length < 200) break;
      }
      if (!existing) {
        return reply(
          {
            ok: false,
            error: "auth_create_failed",
            detail: createErr?.message,
          },
          500
        );
      }
      authUserId = existing.id;
      const { error: updErr } = await admin.auth.admin.updateUserById(
        authUserId,
        { password, app_metadata: appMetadata }
      );
      if (updErr) return reply({ ok: false, error: "auth_update_failed" }, 500);
    } else {
      authUserId = created.user.id;
    }
  } else {
    const { error: updErr } = await admin.auth.admin.updateUserById(
      authUserId,
      { password, app_metadata: appMetadata }
    );
    if (updErr) {
      // If the row pointed at a stale auth user that no longer exists, fall
      // back to creating a fresh one.
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          app_metadata: appMetadata,
          user_metadata: { pilot_id: pilot.id },
        });
      if (createErr || !created.user) {
        return reply({ ok: false, error: "auth_update_failed" }, 500);
      }
      authUserId = created.user.id;
    }
  }

  // 6. Persist the binding (also clears any other pilot row that was
  //    pointing at this auth user).
  const { error: bindErr } = await admin.rpc("bind_pilot_auth_user", {
    p_pilot_id: pilot.id,
    p_auth_user_id: authUserId,
  });
  if (bindErr) return reply({ ok: false, error: "bind_failed" }, 500);

  // 7. Sign in with the freshly rotated password using the anon client. This
  //    yields a real session the mobile app can persist and refresh.
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data: signIn, error: signInErr } = await anon.auth.signInWithPassword(
    { email, password }
  );
  if (signInErr || !signIn.session) {
    return reply({ ok: false, error: "signin_failed" }, 500);
  }

  // 8. Audit + device row (kept for the dashboard's "linked devices" view).
  await admin.from("pilot_devices").insert({
    token_hash: await sha256Hex(signIn.session.access_token),
    squadron_id: pilot.squadron_id,
    pilot_id: pilot.id,
  });
  await admin.from("audit_log").insert({
    squadron_id: pilot.squadron_id,
    type: "mobile.link",
    actor: pilot.id,
    detail: { pilotId: pilot.id, via: "edge" },
  });

  return reply({
    ok: true,
    pilotId: pilot.id,
    squadronId: pilot.squadron_id,
    session: {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
      expires_in: signIn.session.expires_in,
      expires_at: signIn.session.expires_at,
      token_type: signIn.session.token_type,
    },
  });
});
