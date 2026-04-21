import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

// ── In-memory rate limiter ───────────────────────────────────────────────────
// License registration is a rare, deliberate operation. Rate-limit per source
// IP to a small burst (5 attempts per 15-minute window) to prevent automated
// brute-force of the license key space and credential-stuffing attacks.
// The store is process-local; if the service is replicated, a shared Redis
// store should be used instead. For a single-process deployment this is
// sufficient to stop casual automated abuse.

interface RateLimitEntry {
  count: number;
  windowStart: number;
}

const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const RATE_LIMIT_MAX = 5;                     // max attempts per window per IP

const rateLimitStore = new Map<string, RateLimitEntry>();

// Evict stale entries opportunistically to prevent unbounded memory growth.
function evictStaleEntries(): void {
  const now = Date.now();
  for (const [ip, entry] of rateLimitStore) {
    if (now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
      rateLimitStore.delete(ip);
    }
  }
}

function checkRateLimit(ip: string): { allowed: boolean; retryAfterMs: number } {
  evictStaleEntries();
  const now = Date.now();
  const entry = rateLimitStore.get(ip);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitStore.set(ip, { count: 1, windowStart: now });
    return { allowed: true, retryAfterMs: 0 };
  }

  entry.count += 1;
  if (entry.count > RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }
  return { allowed: true, retryAfterMs: 0 };
}

/**
 * POST /api/license/register
 *
 * Server-side proxy for the Supabase `register-license` edge function.
 * The client never touches the provisioning secret — it is loaded here from
 * the server's environment and attached as the `X-Provisioning-Secret` header
 * when forwarding the request to Supabase.
 *
 * Required environment variables (server-side only, never exposed to clients):
 *   SUPABASE_URL               — Supabase project URL
 *   SUPABASE_ANON_KEY          — Supabase anon/public key (for function invocation)
 *   REGISTER_LICENSE_SECRET    — Pre-shared secret that gates the edge function
 */
router.post("/license/register", async (req: Request, res: Response) => {
  // Resolve the client's IP address. Express may receive the real IP via
  // `X-Forwarded-For` when sitting behind a reverse proxy (Replit, Nginx, etc.).
  const forwardedFor = req.headers["x-forwarded-for"];
  const clientIp =
    (Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor?.split(",")[0]?.trim()) ??
    req.socket.remoteAddress ??
    "unknown";

  const { allowed, retryAfterMs } = checkRateLimit(clientIp);
  if (!allowed) {
    const retryAfterSec = Math.ceil(retryAfterMs / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.status(429).json({
      ok: false,
      error: "rate_limit_exceeded",
      retryAfterSeconds: retryAfterSec,
    });
    return;
  }

  const supabaseUrl = process.env["SUPABASE_URL"];
  const supabaseAnonKey = process.env["SUPABASE_ANON_KEY"];
  const registerSecret = process.env["REGISTER_LICENSE_SECRET"];

  if (!supabaseUrl || !supabaseAnonKey || !registerSecret) {
    res.status(503).json({ ok: false, error: "server_misconfigured" });
    return;
  }

  const edgeFunctionUrl = `${supabaseUrl}/functions/v1/register-license`;

  let upstream: globalThis.Response;
  try {
    upstream = await fetch(edgeFunctionUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${supabaseAnonKey}`,
        "x-provisioning-secret": registerSecret,
      },
      body: JSON.stringify(req.body),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "upstream_error";
    res.status(502).json({ ok: false, error: "upstream_unreachable", detail: message });
    return;
  }

  let payload: unknown;
  try {
    payload = await upstream.json();
  } catch {
    res.status(502).json({ ok: false, error: "upstream_bad_response" });
    return;
  }

  res.status(upstream.status).json(payload);
});

export default router;
