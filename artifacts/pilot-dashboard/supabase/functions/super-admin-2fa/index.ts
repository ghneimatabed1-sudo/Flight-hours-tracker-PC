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
//       → validates token, then the submitted code against either the
//       stored TOTP secret OR the pre-hashed recovery codes. On
//       successful first enrollment, a fresh set of 10 single-use
//       recovery codes is generated, hashed, stored, and returned to
//       the client one time (recoveryCodes on the response). On a
//       recovery-code sign-in the matching code is burned (used_at set)
//       so it cannot be reused, and the event is written to the audit
//       log. On failure, increments failed_attempts; 5 in a row →
//       5-minute lock.
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
const ALLOWED_USERNAME = "admin";          // only principal this function serves
const LOCKOUT_THRESHOLD = 5;                // bad TOTP codes → TOTP lockout
const LOCKOUT_MS = 5 * 60_000;
const PW_FAIL_THRESHOLD = 10;               // bad passwords in window → pw lockout
const PW_FAIL_WINDOW_MS = 10 * 60_000;
const PW_LOCKOUT_MS = 15 * 60_000;
const TOKEN_TTL_MS = 5 * 60_000;
const B32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

// In-memory password-failure counter, per username. Survives only as long
// as the edge function instance is warm — that's intentional: it slows down
// online brute force without needing extra storage. The TOTP lockout below
// is the durable, persisted one. Keyed by username so a wrong password for
// one principal can't lock another.
const pwFails = new Map<string, { count: number; firstAt: number; lockedUntil: number }>();

interface Body {
  action?: "start" | "verify";
  username?: string;
  password?: string;
  token?: string;
  code?: string;
}

const RECOVERY_CODE_COUNT = 10;

function generateRecoveryCode(): string {
  const bytes = new Uint8Array(5);
  crypto.getRandomValues(bytes);
  const b32 = base32Encode(bytes).slice(0, 8);
  return `${b32.slice(0, 4)}-${b32.slice(4, 8)}`;
}
function generateRecoveryCodes(n = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: n }, () => generateRecoveryCode());
}
function normalizeRecoveryCode(raw: string): string {
  return (raw ?? "").trim().toUpperCase().replace(/[\s-]+/g, "");
}
function isRecoveryCodeShape(raw: string): boolean {
  return /^[A-Z2-7]{8}$/.test(normalizeRecoveryCode(raw));
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

  // Defence in depth: this function only serves the configured super-admin
  // principal. Even though the UI never submits anything else today, a
  // future bug or a direct caller poking at the endpoint shouldn't be able
  // to create rows for other usernames or probe alternative principals.
  if (username !== ALLOWED_USERNAME) {
    return reply({ ok: false, error: "unauthorized" }, 401);
  }

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

    // Server-side throttle for bad password attempts. With JWT verification
    // disabled this is the main brake on online password brute-force.
    const now = Date.now();
    const fail = pwFails.get(username);
    if (fail && fail.lockedUntil > now) {
      return reply({ ok: false, error: "locked", lockedUntil: fail.lockedUntil }, 429);
    }

    // Constant-time password check.
    const providedHash = (await sha256Hex(password)).toLowerCase();
    if (!timingSafeEq(providedHash, expectedHash)) {
      const cur = (fail && now - fail.firstAt < PW_FAIL_WINDOW_MS)
        ? fail
        : { count: 0, firstAt: now, lockedUntil: 0 };
      cur.count += 1;
      if (cur.count >= PW_FAIL_THRESHOLD) cur.lockedUntil = now + PW_LOCKOUT_MS;
      pwFails.set(username, cur);
      return reply({ ok: false, error: "unauthorized" }, 401);
    }
    // Successful password clears the throttle.
    pwFails.delete(username);

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
    const rawCode = (body.code ?? "").trim();
    const token = body.token ?? "";
    const isTotpShape = /^\d{6}$/.test(rawCode);
    const isRecoveryShape = isRecoveryCodeShape(rawCode);
    if ((!isTotpShape && !isRecoveryShape) || !token) {
      return reply({ ok: false, error: "bad_input" }, 400);
    }

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

    // Recovery-code path: only usable once enrollment is complete. Before
    // enrollment the admin hasn't received any codes yet, so this falls
    // through and is rejected like any bad code.
    let recoveryMatched = false;
    if (isRecoveryShape && row.enrolled_at) {
      const normalized = normalizeRecoveryCode(rawCode);
      const hash = await sha256Hex(normalized);
      const hashes: string[] = Array.isArray(row.recovery_code_hashes) ? row.recovery_code_hashes : [];
      const usedAt: (string | null)[] = Array.isArray(row.recovery_code_used_at) ? row.recovery_code_used_at : [];
      for (let i = 0; i < hashes.length; i++) {
        if (timingSafeEq(hashes[i], hash) && !usedAt[i]) {
          recoveryMatched = true;
          const nextUsedAt = [...usedAt];
          while (nextUsedAt.length < hashes.length) nextUsedAt.push(null);
          nextUsedAt[i] = new Date().toISOString();
          const remaining = nextUsedAt.filter(v => !v).length;
          await admin.from("super_admin_2fa").update({
            recovery_code_used_at: nextUsedAt,
            last_verified_at: new Date().toISOString(),
            failed_attempts: 0,
            locked_until: null,
            updated_at: new Date().toISOString(),
          }).eq("username", username);
          await admin.from("audit_log").insert({
            squadron_id: null,
            type: "super_admin.2fa.recovery_used",
            actor: username,
            detail: { index: i, remaining },
          }).then(() => {}, () => {});
          break;
        }
      }
    }

    const totpOk = !recoveryMatched && isTotpShape && (await verifyTotp(row.secret_b32, rawCode));

    if (!recoveryMatched && !totpOk) {
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
        squadron_id: null, type: "super_admin.2fa.failed", actor: username,
        detail: { fails, mode: isRecoveryShape ? "recovery" : "totp" },
      }).then(() => {}, () => {});
      return reply({ ok: false, error: lockUntil ? "locked" : "bad", fails });
    }

    const wasEnrollment = !row.enrolled_at;
    let recoveryCodes: string[] | undefined;
    if (wasEnrollment) {
      // Finalising enrollment: mint the one-time recovery codes, hash them,
      // store the hashes, and return the plaintext codes exactly once so
      // the admin can write them down.
      recoveryCodes = generateRecoveryCodes();
      const hashes = await Promise.all(
        recoveryCodes.map(c => sha256Hex(normalizeRecoveryCode(c))),
      );
      await admin.from("super_admin_2fa").update({
        enrolled_at: new Date().toISOString(),
        last_verified_at: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
        recovery_code_hashes: hashes,
        recovery_code_used_at: hashes.map(() => null),
        updated_at: new Date().toISOString(),
      }).eq("username", username);
    } else {
      await admin.from("super_admin_2fa").update({
        last_verified_at: new Date().toISOString(),
        failed_attempts: 0,
        locked_until: null,
        updated_at: new Date().toISOString(),
      }).eq("username", username);
    }
    await admin.from("audit_log").insert({
      squadron_id: null,
      type: wasEnrollment
        ? "super_admin.2fa.enrolled"
        : (recoveryMatched ? "super_admin.2fa.verified_recovery" : "super_admin.2fa.verified"),
      actor: username, detail: {},
    }).then(() => {}, () => {});

    return reply({
      ok: true,
      enrolled: true,
      ...(recoveryCodes ? { recoveryCodes } : {}),
      ...(recoveryMatched ? { usedRecoveryCode: true } : {}),
    });
  }

  return reply({ ok: false, error: "unknown_action" }, 400);
});
