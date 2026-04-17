// Supabase Edge Function: super-admin-2fa
//
// Server-side authority for the super-admin TOTP secret. The browser never
// stores the secret beyond the brief enrollment window; verification of
// every subsequent login goes through this function. The TOTP seed itself
// lives in `super_admin_2fa` (RLS denies all client access; only this
// function holds the service role key needed to read it).
//
// Actions (POST { action, username, password, code? }):
//   - "status"  → { enrolled: boolean, lockedUntil: number | null }
//   - "enroll"  → if not yet enrolled, returns { secret, otpauth } so the
//                 user can scan into their authenticator. Idempotent: if
//                 a pending (un-verified) enrollment already exists the
//                 same secret is returned, never rotated. Refuses if the
//                 user has already finished enrollment.
//   - "verify"  → validates the 6-digit code against the stored secret.
//                 On success, finalises any pending enrollment and bumps
//                 last_verified_at. On failure, increments failed_attempts;
//                 5 in a row → 5-minute lock.
//
// Authorization: every call requires the super admin's password in the
// body. The function checks it against SUPER_ADMIN_PASSWORD_HASH (a
// SHA-256 hex digest, set as a Supabase secret). With this check in
// place, an unauthenticated attacker cannot lock out the admin or
// trigger an enrollment they shouldn't see — they would have to know
// the password too. Wrong-password attempts are NOT counted toward the
// TOTP lockout (the client-side login counter handles that).
//
// Deploy:  supabase functions deploy super-admin-2fa --no-verify-jwt
//          supabase secrets set SUPER_ADMIN_PASSWORD_HASH=<sha256-hex>
// (No JWT check on purpose — login happens *before* the user has a JWT.)

// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ISSUER = "RJAF Pilot Dashboard";
const LOCKOUT_THRESHOLD = 5;
const LOCKOUT_MS = 5 * 60_000;
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

interface Body {
  action?: "status" | "enroll" | "verify";
  username?: string;
  password?: string;
  code?: string;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}

// Constant-time string compare to avoid timing oracles on the password hash.
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

function reply(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── TOTP / Base32 (Web Crypto, same algorithm as src/lib/totp.ts) ─────────
function base32Encode(buf: Uint8Array): string {
  let bits = 0, value = 0, out = "";
  for (let i = 0; i < buf.length; i++) {
    value = (value << 8) | buf[i];
    bits += 8;
    while (bits >= 5) {
      out += B32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/, "").replace(/\s+/g, "").toUpperCase();
  const out: number[] = [];
  let bits = 0, value = 0;
  for (let i = 0; i < clean.length; i++) {
    const idx = B32_ALPHABET.indexOf(clean[i]);
    if (idx < 0) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}
function generateSecret(byteLength = 20): string {
  const buf = new Uint8Array(byteLength);
  crypto.getRandomValues(buf);
  return base32Encode(buf);
}
async function hotp(secret: Uint8Array, counter: number): Promise<string> {
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  const high = Math.floor(counter / 0x1_0000_0000);
  const low = counter >>> 0;
  view.setUint32(0, high);
  view.setUint32(4, low);
  const key = await crypto.subtle.importKey(
    "raw", secret as BufferSource,
    { name: "HMAC", hash: "SHA-1" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, buf));
  const offset = sig[sig.length - 1] & 0x0f;
  const code = ((sig[offset] & 0x7f) << 24)
             | (sig[offset + 1] << 16)
             | (sig[offset + 2] << 8)
             |  sig[offset + 3];
  return (code % 1_000_000).toString().padStart(6, "0");
}
async function verifyTotp(secretB32: string, code: string, windowSteps = 1): Promise<boolean> {
  const clean = code.replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return false;
  const bytes = base32Decode(secretB32);
  const counter = Math.floor(Date.now() / 30_000);
  for (let w = -windowSteps; w <= windowSteps; w++) {
    if ((await hotp(bytes, counter + w)) === clean) return true;
  }
  return false;
}
function otpauthURL(secret: string, account: string): string {
  const label = encodeURIComponent(`${ISSUER}:${account}`);
  const params = new URLSearchParams({
    secret, issuer: ISSUER, algorithm: "SHA1", digits: "6", period: "30",
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ── Handler ───────────────────────────────────────────────────────────────
// @ts-ignore Deno is provided by the Edge runtime
Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return reply({ ok: false, error: "method_not_allowed" }, 405);

  let body: Body;
  try { body = await req.json(); }
  catch { return reply({ ok: false, error: "bad_json" }, 400); }

  const action = body.action;
  const username = (body.username ?? "").trim().toLowerCase();
  const password = body.password ?? "";
  if (!action || !username || !password) {
    return reply({ ok: false, error: "missing_fields" }, 400);
  }

  // @ts-ignore Deno is provided by the Edge runtime
  const url = Deno.env.get("SUPABASE_URL");
  // @ts-ignore Deno is provided by the Edge runtime
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // @ts-ignore Deno is provided by the Edge runtime
  const expectedHash = (Deno.env.get("SUPER_ADMIN_PASSWORD_HASH") ?? "").toLowerCase();
  if (!url || !serviceKey || !expectedHash) {
    return reply({ ok: false, error: "server_misconfigured" }, 500);
  }

  // Authenticate the caller. Without this check the endpoint would let
  // anyone enroll/lock the super-admin account.
  const providedHash = (await sha256Hex(password)).toLowerCase();
  if (!timingSafeEq(providedHash, expectedHash)) {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  const { data: row } = await admin
    .from("super_admin_2fa")
    .select("*")
    .eq("username", username)
    .maybeSingle();

  const lockedNow = row?.locked_until && new Date(row.locked_until).getTime() > Date.now();

  if (action === "status") {
    return reply({
      ok: true,
      enrolled: !!row?.enrolled_at,
      lockedUntil: lockedNow ? new Date(row!.locked_until).getTime() : null,
    });
  }

  if (action === "enroll") {
    if (lockedNow) return reply({ ok: false, error: "locked" }, 423);
    if (row?.enrolled_at) return reply({ ok: false, error: "already_enrolled" }, 409);

    // Idempotent: if a pending (un-verified) enrollment already exists,
    // return the SAME secret. Rotating it on every call would invalidate
    // the QR an admin may have already scanned in another window.
    if (row?.secret_b32) {
      return reply({
        ok: true,
        secret: row.secret_b32,
        otpauth: otpauthURL(row.secret_b32, username),
      });
    }

    const secret = generateSecret();
    const { error: upErr } = await admin
      .from("super_admin_2fa")
      .insert({
        username,
        secret_b32: secret,
        enrolled_at: null,
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      });
    if (upErr) return reply({ ok: false, error: "store_failed", detail: upErr.message }, 500);
    return reply({ ok: true, secret, otpauth: otpauthURL(secret, username) });
  }

  if (action === "verify") {
    const code = (body.code ?? "").trim();
    if (!/^\d{6}$/.test(code)) return reply({ ok: false, error: "bad_input" }, 400);
    if (!row) return reply({ ok: false, error: "not_enrolled" }, 404);
    if (lockedNow) return reply({ ok: false, error: "locked" }, 423);

    const ok = await verifyTotp(row.secret_b32, code);
    if (!ok) {
      const fails = (row.failed_attempts ?? 0) + 1;
      const lockUntil = fails >= LOCKOUT_THRESHOLD
        ? new Date(Date.now() + LOCKOUT_MS).toISOString()
        : null;
      await admin.from("super_admin_2fa").update({
        failed_attempts: fails,
        locked_until: lockUntil,
        updated_at: new Date().toISOString(),
      }).eq("username", username);
      await admin.from("audit_log").insert({
        squadron_id: null,
        type: "super_admin.2fa.failed",
        actor: username,
        detail: { fails },
      }).then(() => {}, () => {});
      return reply({ ok: false, error: lockUntil ? "locked" : "bad", fails });
    }

    const wasEnrollment = !row.enrolled_at;
    await admin.from("super_admin_2fa").update({
      enrolled_at: row.enrolled_at ?? new Date().toISOString(),
      last_verified_at: new Date().toISOString(),
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    }).eq("username", username);
    await admin.from("audit_log").insert({
      squadron_id: null,
      type: wasEnrollment ? "super_admin.2fa.enrolled" : "super_admin.2fa.verified",
      actor: username,
      detail: {},
    }).then(() => {}, () => {});

    return reply({ ok: true, enrolled: true });
  }

  return reply({ ok: false, error: "unknown_action" }, 400);
});
