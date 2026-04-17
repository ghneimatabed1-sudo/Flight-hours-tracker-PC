// Supabase Edge Function: super-admin-2fa
//
// Server-side authority for the super-admin login + TOTP secret. The
// browser does not know the super-admin password and never holds the
// TOTP seed beyond the brief enrollment window. Verification of every
// subsequent login goes through this function. The TOTP seed itself
// lives in `super_admin_2fa` (RLS denies all client access; only this
// function holds the service role key needed to read it).
//
// Actions (POST { action, ... }):
//   - "start"  { username, password }
//       → validates password against SUPER_ADMIN_PASSWORD_HASH
//       → returns { ok, token, enrolled, lockedUntil, secret?, otpauth? }
//       The token is a short-lived (5 min) HMAC-signed proof bound to
//       the username; subsequent calls authenticate with it instead of
//       resending the password. If a pending (un-verified) enrollment
//       row exists, the SAME secret is returned (idempotent — never
//       rotated on retries, so a QR already scanned stays valid).
//
//   - "verify" { username, token, code }
//       → validates token, then the 6-digit TOTP code against the
//       stored secret. On success, finalises any pending enrollment
//       and bumps last_verified_at. On failure, increments
//       failed_attempts; 5 in a row → 5-minute lock.
//
// Authorization model:
//   - The super-admin password is held only on the server, as a SHA-256
//     hex hash in SUPER_ADMIN_PASSWORD_HASH. The client never sees it
//     and never has a hardcoded copy.
//   - HMAC-signed challenge tokens (CHALLENGE_SECRET) bind the password
//     step to the TOTP step so an attacker cannot skip "start" and call
//     "verify" directly.
//   - Wrong-password attempts return 401 and are NOT counted toward the
//     TOTP lockout (the client-side login counter handles that).
//
// Deploy:
//   supabase functions deploy super-admin-2fa --no-verify-jwt
//   supabase secrets set SUPER_ADMIN_PASSWORD_HASH=<sha256-hex>
//   supabase secrets set CHALLENGE_SECRET=<random 32+ byte string>
// (No JWT check on purpose — this IS the login.)

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
const TOKEN_TTL_MS = 5 * 60_000;
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

interface Body {
  action?: "start" | "verify";
  username?: string;
  password?: string;
  token?: string;
  code?: string;
}

function reply(payload: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

// ── Hashing / constant-time compare ───────────────────────────────────────
async function sha256Hex(s: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, "0"))
    .join("");
}
function timingSafeEq(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

// ── Challenge tokens (HMAC-SHA256) ────────────────────────────────────────
async function hmacSha256Hex(keyStr: string, msg: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(keyStr),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(msg)));
  return Array.from(sig).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function issueToken(secret: string, username: string): Promise<string> {
  const exp = Date.now() + TOKEN_TTL_MS;
  const payload = `${exp}|${username}`;
  const mac = await hmacSha256Hex(secret, payload);
  return btoa(`${payload}|${mac}`).replace(/=+$/, "");
}
async function verifyToken(secret: string, username: string, token: string): Promise<boolean> {
  let decoded: string;
  try { decoded = atob(token); } catch { return false; }
  const parts = decoded.split("|");
  if (parts.length !== 3) return false;
  const [expStr, tokUser, mac] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  if (tokUser !== username) return false;
  const expected = await hmacSha256Hex(secret, `${expStr}|${tokUser}`);
  return timingSafeEq(mac, expected);
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
  if (!action || !username) return reply({ ok: false, error: "missing_fields" }, 400);

  // @ts-ignore Deno is provided by the Edge runtime
  const url = Deno.env.get("SUPABASE_URL");
  // @ts-ignore Deno is provided by the Edge runtime
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // @ts-ignore Deno is provided by the Edge runtime
  const expectedHash = (Deno.env.get("SUPER_ADMIN_PASSWORD_HASH") ?? "").toLowerCase();
  // @ts-ignore Deno is provided by the Edge runtime
  const challengeSecret = Deno.env.get("CHALLENGE_SECRET") ?? "";
  if (!url || !serviceKey || !expectedHash || !challengeSecret) {
    return reply({ ok: false, error: "server_misconfigured" }, 500);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  if (action === "start") {
    const password = body.password ?? "";
    if (!password) return reply({ ok: false, error: "missing_fields" }, 400);

    // Constant-time password check.
    const providedHash = (await sha256Hex(password)).toLowerCase();
    if (!timingSafeEq(providedHash, expectedHash)) {
      return reply({ ok: false, error: "unauthorized" }, 401);
    }

    const { data: row } = await admin
      .from("super_admin_2fa")
      .select("*")
      .eq("username", username)
      .maybeSingle();

    const lockedNow = row?.locked_until && new Date(row.locked_until).getTime() > Date.now();
    if (lockedNow) {
      return reply({
        ok: false,
        error: "locked",
        lockedUntil: new Date(row!.locked_until).getTime(),
      }, 423);
    }

    const token = await issueToken(challengeSecret, username);

    if (row?.enrolled_at) {
      return reply({ ok: true, token, enrolled: true, lockedUntil: null });
    }

    // Pending enrollment: idempotent — return the existing secret if
    // there's already one in flight, otherwise mint a fresh one.
    let secret = row?.secret_b32 as string | undefined;
    if (!secret) {
      secret = generateSecret();
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
    }

    return reply({
      ok: true, token, enrolled: false, lockedUntil: null,
      secret, otpauth: otpauthURL(secret, username),
    });
  }

  if (action === "verify") {
    const code = (body.code ?? "").trim();
    const token = body.token ?? "";
    if (!/^\d{6}$/.test(code) || !token) return reply({ ok: false, error: "bad_input" }, 400);

    if (!(await verifyToken(challengeSecret, username, token))) {
      return reply({ ok: false, error: "unauthorized" }, 401);
    }

    const { data: row } = await admin
      .from("super_admin_2fa")
      .select("*")
      .eq("username", username)
      .maybeSingle();
    if (!row) return reply({ ok: false, error: "not_enrolled" }, 404);

    const lockedNow = row.locked_until && new Date(row.locked_until).getTime() > Date.now();
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
        squadron_id: null, type: "super_admin.2fa.failed", actor: username, detail: { fails },
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
      actor: username, detail: {},
    }).then(() => {}, () => {});

    return reply({ ok: true, enrolled: true });
  }

  return reply({ ok: false, error: "unknown_action" }, 400);
});
