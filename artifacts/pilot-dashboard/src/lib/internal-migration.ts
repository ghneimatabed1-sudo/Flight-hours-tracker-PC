import type { LanAuthUser } from "./lan-user-map";

export type { LanAuthUser };

/**
 * Internal LAN migration helpers — optional health check to the monorepo
 * `artifacts/api-server` while Supabase remains the live backend.
 *
 * - Dev: same-origin `fetch` via Vite proxy (see vite.config.ts) when
 *   `VITE_INTERNAL_API_URL` is unset.
 * - Staged / prod: set `VITE_INTERNAL_API_URL` to the internal base
 *   (e.g. `http://hawk-api.lan:3847`) and add that host to CSP
 *   `connect-src` in the built `index.html` (see docs/internal-migration).
 */

/** Must match the dev proxy path in `vite.config.ts`. */
export const INTERNAL_API_PROXY_PREFIX = "__hawk_eye_internal_api";

// Same pattern as Diagnostic.tsx / supabase.ts — must not throw when
// `import.meta.env` is undefined (Node sidebar-smoke without Vite).
const __viteEnv: Record<string, string | boolean | undefined> =
  typeof import.meta !== "undefined" &&
  (import.meta as unknown as { env?: Record<string, string | boolean | undefined> }).env
    ? (import.meta as unknown as { env: Record<string, string | boolean | undefined> })
        .env
    : {};

function trimSlash(s: string): string {
  return s.replace(/\/+$/, "");
}

// ── Active install profile ─────────────────────────────────────────
// `install-profile.tsx` calls `setActiveInstallProfile` once it has
// resolved the value from `/api/healthz`. Helpers below use the value
// to decide whether `internal/auth/lan/*` paths should be rewritten
// to `aggregate/auth/lan/*` (aggregator backends do not mount the
// `/api/internal/*` shell at all).
export type ActiveInstallProfile =
  | "hub"
  | "aggregator-wing"
  | "aggregator-base"
  | "viewer";

let __activeInstallProfile: ActiveInstallProfile = "hub";

export function setActiveInstallProfile(p: ActiveInstallProfile): void {
  __activeInstallProfile = p;
}

export function getActiveInstallProfile(): ActiveInstallProfile {
  return __activeInstallProfile;
}

export function _resetActiveInstallProfileForTests(): void {
  __activeInstallProfile = "hub";
}

function isAggregator(p: ActiveInstallProfile = __activeInstallProfile): boolean {
  return p === "aggregator-wing" || p === "aggregator-base";
}

/**
 * Translate a logical path (e.g. `internal/auth/lan/me`,
 * `aggregate/peers`, `healthz`) into the URL the API helpers should
 * actually fetch. Aggregator backends do not mount `/api/internal/*`,
 * so when the active profile is an aggregator we transparently
 * rewrite `internal/auth/lan/*` to `aggregate/auth/lan/*` — the
 * server mounts `lanAuthPublic` under `/api/aggregate` in that mode.
 */
function mapLogicalPath(path: string): string {
  const stripped = path.replace(/^\/+/, "");
  if (isAggregator() && stripped.startsWith("internal/auth/lan/")) {
    return "aggregate/auth/lan/" + stripped.slice("internal/auth/lan/".length);
  }
  return stripped;
}

function getInternalApiPath(path: string): string | null {
  const mapped = mapLogicalPath(path);
  const fromEnv = String(__viteEnv.VITE_INTERNAL_API_URL ?? "").trim();
  if (fromEnv) return `${trimSlash(fromEnv)}/api/${mapped}`;
  if (__viteEnv.DEV === true) {
    const base = String(__viteEnv.BASE_URL || "/");
    const p = `${INTERNAL_API_PROXY_PREFIX}/${mapped}`;
    if (base === "/" || base === "") return `/${p}`;
    return `${trimSlash(base)}/${p}`;
  }
  return null;
}

const LAN_SESSION_KEY = "rjaf.lanSessionToken";

function getStoredLanSessionToken(): string | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const t = String(localStorage.getItem(LAN_SESSION_KEY) ?? "").trim();
    return t ? t : null;
  } catch {
    return null;
  }
}

export function setStoredLanSessionToken(token: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    if (!token) localStorage.removeItem(LAN_SESSION_KEY);
    else localStorage.setItem(LAN_SESSION_KEY, token);
  } catch {
    /* ignore */
  }
}

export function clearLanSessionToken(): void {
  setStoredLanSessionToken(null);
}

/**
 * When set to `1`/`true` **and** an internal API base is resolved (dev proxy
 * or `VITE_INTERNAL_API_URL`), the dashboard uses `POST
 * /api/internal/auth/lan/login` instead of Supabase Auth for `login()`.
 */
export function isLanSessionLoginEnabled(): boolean {
  const v = String(__viteEnv.VITE_LAN_SESSION_LOGIN ?? "")
    .trim()
    .toLowerCase();
  if (v !== "true" && v !== "1") return false;
  return getInternalApiPath("healthz") !== null;
}

/** Explicitly disables login password checks in LAN mode (temporary migration flag). */
export function isLanNoAuthEnabled(): boolean {
  const v = String(__viteEnv.VITE_LAN_NO_AUTH ?? "")
    .trim()
    .toLowerCase();
  return v === "true" || v === "1";
}

/**
 * When the base `api-server` has `HAWK_INTERNAL_SESSION_AUTH=required`, all
 * `/api/internal/*` data calls must include this header. The token is
 * returned by `POST /api/internal/auth/lan/login` and may be stored by the
 * future LAN login UI (or manually for bring-up).
 */
function internalApiHeadersBase(): Record<string, string> {
  const h: Record<string, string> = {};
  const tok = getStoredLanSessionToken();
  if (tok) h["x-hawk-lan-session"] = tok;
  return h;
}

export async function postLanLogin(
  username: string,
  password: string,
): Promise<
  | { ok: true; token: string; user: LanAuthUser }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/auth/lan/login");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(body?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    if (body?.ok !== true) {
      return { ok: false, error: String(body?.error ?? "lan_login_failed") };
    }
    const token = String(body?.token ?? "").trim();
    const u = body?.user as Record<string, unknown> | undefined;
    if (!token || !u) {
      return { ok: false, error: "lan_login_bad_payload" };
    }
    return {
      ok: true,
      token,
      user: {
        id: String(u.id ?? "").trim(),
        username: String(u.username ?? "").trim(),
        displayName: String(u.displayName ?? u.display_name ?? "").trim(),
        role: String(u.role ?? "").trim(),
        squadronId:
          u.squadronId == null || u.squadronId === ""
            ? null
            : String(u.squadronId),
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function postLanDevSession(
  username: string,
  opts?: { role?: string; displayName?: string; squadronId?: string | null },
): Promise<
  | { ok: true; token: string; user: LanAuthUser }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/auth/lan/dev-session");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        role: opts?.role,
        displayName: opts?.displayName,
        squadronId: opts?.squadronId,
      }),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(body?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    if (body?.ok !== true) {
      return { ok: false, error: String(body?.error ?? "lan_dev_session_failed") };
    }
    const token = String(body?.token ?? "").trim();
    const u = body?.user as Record<string, unknown> | undefined;
    if (!token || !u) return { ok: false, error: "lan_dev_session_bad_payload" };
    return {
      ok: true,
      token,
      user: {
        id: String(u.id ?? "").trim(),
        username: String(u.username ?? "").trim(),
        displayName: String(u.displayName ?? u.display_name ?? "").trim(),
        role: String(u.role ?? "").trim(),
        squadronId:
          u.squadronId == null || u.squadronId === ""
            ? null
            : String(u.squadronId),
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchLanSessionUser(): Promise<
  | { ok: true; user: LanAuthUser }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/auth/lan/me");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  const tok = getStoredLanSessionToken();
  if (!tok) return { ok: false, error: "no_token" };
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(body?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    if (body?.ok !== true) {
      return { ok: false, error: String(body?.error ?? "lan_me_failed") };
    }
    const u = body?.user as Record<string, unknown> | undefined;
    if (!u) return { ok: false, error: "lan_me_bad_payload" };
    return {
      ok: true,
      user: {
        id: String(u.id ?? "").trim(),
        username: String(u.username ?? "").trim(),
        displayName: String(u.displayName ?? u.display_name ?? "").trim(),
        role: String(u.role ?? "").trim(),
        squadronId:
          u.squadronId == null || u.squadronId === ""
            ? null
            : String(u.squadronId),
      },
    };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Best-effort server-side session end + local token clear.
 */
export async function postLanLogout(): Promise<void> {
  const url = getInternalApiPath("internal/auth/lan/logout");
  const tok = getStoredLanSessionToken();
  if (url && tok) {
    try {
      await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...internalApiHeadersBase(),
        },
        body: JSON.stringify({ token: tok }),
      });
    } catch {
      /* ignore */
    }
  }
  clearLanSessionToken();
}

/**
 * Resolves the URL for `GET /api/healthz` on the internal API, or `null` if
 * the check is disabled (no dev proxy and no `VITE_INTERNAL_API_URL`).
 */
export function getInternalApiHealthUrl(): string | null {
  const fromEnv = String(__viteEnv.VITE_INTERNAL_API_URL ?? "").trim();
  if (fromEnv) {
    return `${trimSlash(fromEnv)}/api/healthz`;
  }
  if (__viteEnv.DEV === true) {
    const base = String(__viteEnv.BASE_URL || "/");
    const path = `${INTERNAL_API_PROXY_PREFIX}/healthz`;
    if (base === "/" || base === "") return `/${path}`;
    return `${trimSlash(base)}/${path}`;
  }
  return null;
}

export type InternalApiHealthResult =
  | { ok: true; status: string; ms: number }
  | { ok: false; error: string; ms?: number };

/**
 * Fetches the internal API health endpoint. When disabled, returns a
 * structured error (not a throw).
 */
export async function fetchInternalApiHealth(): Promise<InternalApiHealthResult> {
  const url = getInternalApiHealthUrl();
  if (!url) {
    return {
      ok: false,
      error:
        "Not enabled — in dev, start the API on INTERNAL_API_PROXY_TARGET and use the Vite proxy; or set VITE_INTERNAL_API_URL for a direct URL.",
    };
  }
  const t0 = performance.now();
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    const ms = Math.round(performance.now() - t0);
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}`, ms };
    }
    const data = (await res.json()) as { status?: string };
    if (data?.status !== "ok") {
      return {
        ok: false,
        error: `Unexpected body: ${JSON.stringify(data)}`,
        ms,
      };
    }
    return { ok: true, status: data.status, ms };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
      ms: Math.round(performance.now() - t0),
    };
  }
}

// ── Backup-verify status (Task #372 / T-E Step 3) ───────────────────
//
// Fetches the focused `/api/internal/backup-verify-status` endpoint
// the api-server exposes for the `BackupVerifyBanner`. The endpoint
// is super-admin-only on the server and returns either the marker
// row or `null` when no verify has ever been recorded.
export type BackupVerifyMarker = {
  ok: boolean;
  observedAt: string;
  ageDays: number;
  message: string | null;
};

export type BackupVerifyStatusResult =
  | { ok: true; marker: BackupVerifyMarker | null }
  | { ok: false; error: string };

export async function fetchBackupVerifyStatus(): Promise<BackupVerifyStatusResult> {
  const url = getInternalApiPath("internal/backup-verify-status");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    const body = (await res.json()) as {
      ok?: boolean;
      marker?: {
        ok?: boolean;
        observedAt?: string;
        ageDays?: number;
        message?: string | null;
      } | null;
    };
    if (body?.ok !== true) {
      return { ok: false, error: "bad_payload" };
    }
    const m = body.marker;
    if (m == null) return { ok: true, marker: null };
    if (typeof m.observedAt !== "string" || typeof m.ageDays !== "number") {
      return { ok: false, error: "bad_marker" };
    }
    return {
      ok: true,
      marker: {
        ok: m.ok === true,
        observedAt: m.observedAt,
        ageDays: m.ageDays,
        message: m.message ?? null,
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export interface InternalPilotOption {
  id: string;
  scheduleName: string;
}

export async function fetchInternalPilotOptions(): Promise<InternalPilotOption[]> {
  const url = getInternalApiPath("internal/pilot-options");
  if (!url) return [];
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return [];
    const body = (await res.json()) as {
      items?: Array<{ id?: string; schedule_name?: string }>;
    };
    const rows = Array.isArray(body?.items) ? body.items : [];
    return rows
      .map((r) => ({
        id: String(r.id ?? "").trim(),
        scheduleName: String(r.schedule_name ?? "").trim(),
      }))
      .filter((r) => !!r.id && !!r.scheduleName);
  } catch {
    return [];
  }
}

/** Row shape aligned with `squadrons` defaults columns (0039). */
export type InternalSquadronDefaultsRow = {
  base: string | null;
  wing: string | null;
  default_aircraft: unknown;
  default_monthly_targets: unknown;
};

/**
 * Fetches squadron wizard defaults from the internal API when enabled.
 * Returns `null` when disabled, HTTP error, or squadron not found — caller
 * should fall back to Supabase.
 */
export async function fetchInternalSquadronDefaultsRow(
  squadronNumber: string,
): Promise<InternalSquadronDefaultsRow | null> {
  const n = squadronNumber.trim();
  if (!n) return null;
  const url = getInternalApiPath(
    `internal/squadron-airframes?number=${encodeURIComponent(n)}`,
  );
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      found?: boolean;
      base?: string | null;
      wing?: string | null;
      default_aircraft?: unknown;
      default_monthly_targets?: unknown;
    };
    if (!body || body.found !== true) return null;
    return {
      base: body.base ?? null,
      wing: body.wing ?? null,
      default_aircraft: body.default_aircraft,
      default_monthly_targets: body.default_monthly_targets,
    };
  } catch {
    return null;
  }
}

/** One row from `GET /api/internal/squadrons` (Super Admin registry). */
export type InternalSquadronListRow = {
  id: string;
  number: string;
  name: string;
  base: string;
  wing: string | null;
  // Authorisation IDs surfaced so the admin Users UI can derive
  // wing_id / base_id from the chosen squadron without asking the
  // operator to type display strings.
  wing_id: string | null;
  base_id: string | null;
};

/**
 * Fetches the full squadron list from the internal API when enabled.
 * Returns `null` when the URL is not configured, the request fails, or the
 * body is invalid — caller should fall back to Supabase `squadrons` select.
 * On success the array may be empty (valid org with zero squadrons). Callers
 * that need hybrid Supabase fallback should treat `[]` as “no usable internal
 * snapshot yet” unless they intentionally own an empty registry.
 */
export async function fetchInternalSquadronsList(): Promise<
  InternalSquadronListRow[] | null
> {
  const url = getInternalApiPath("internal/squadrons");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      items?: Array<{
        id?: string;
        number?: string;
        name?: string;
        base?: string;
        wing?: string | null;
        wing_id?: string | null;
        base_id?: string | null;
      }>;
    };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.map((r) => ({
      id: String(r.id ?? "").trim(),
      number: String(r.number ?? "").trim(),
      name: String(r.name ?? "").trim(),
      base: String(r.base ?? "").trim(),
      wing: r.wing == null || r.wing === "" ? null : String(r.wing).trim(),
      wing_id: r.wing_id == null || r.wing_id === "" ? null : String(r.wing_id).trim(),
      base_id: r.base_id == null || r.base_id === "" ? null : String(r.base_id).trim(),
    }));
  } catch {
    return null;
  }
}

/**
 * Full `pilots` table rows (same shape as Supabase `select *`), for roster
 * hydration on the internal LAN. Returns `null` if internal API is off or the
 * response is unusable.
 */
export async function fetchInternalPilotTableRows(): Promise<
  Record<string, unknown>[] | null
> {
  const url = getInternalApiPath("internal/pilots");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

// ── Internal writes (LAN database) — gated by `VITE_INTERNAL_WRITES` ───

/**
 * When `true`, pilot and sortie **saves** go to the internal `api-server`
 * Postgres instead of Supabase (still requires a normal sign-in session for
 * squadron id). Off by default so hybrid installs never surprise the ops PC.
 */
export function internalWritesEnabled(): boolean {
  const v = String(__viteEnv.VITE_INTERNAL_WRITES ?? "")
    .trim()
    .toLowerCase();
  if (v !== "true" && v !== "1") return false;
  return getInternalApiPath("healthz") !== null;
}

function internalWriteHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...internalApiHeadersBase(),
  };
  const secret = String(__viteEnv.VITE_INTERNAL_WRITE_SECRET ?? "").trim();
  if (secret) headers["x-hawk-internal-write"] = secret;
  return headers;
}

export async function internalPilotUpsertFetch(
  body: Record<string, unknown>,
): Promise<Response> {
  const url = getInternalApiPath("internal/pilots/upsert");
  if (!url) throw new Error("internal_api_disabled");
  return fetch(url, {
    method: "POST",
    headers: internalWriteHeaders(),
    body: JSON.stringify(body),
  });
}

export async function internalPilotDeleteFetch(id: string): Promise<Response> {
  const url = getInternalApiPath(`internal/pilots/${encodeURIComponent(id)}`);
  if (!url) throw new Error("internal_api_disabled");
  return fetch(url, { method: "DELETE", headers: internalWriteHeaders() });
}

export async function internalSortieInsertFetch(
  body: Record<string, unknown>,
): Promise<Response> {
  const url = getInternalApiPath("internal/sorties");
  if (!url) throw new Error("internal_api_disabled");
  return fetch(url, {
    method: "POST",
    headers: internalWriteHeaders(),
    body: JSON.stringify(body),
  });
}

export async function internalSortieUpdateFetch(
  id: string,
  body: Record<string, unknown>,
): Promise<Response> {
  const url = getInternalApiPath(`internal/sorties/${encodeURIComponent(id)}`);
  if (!url) throw new Error("internal_api_disabled");
  return fetch(url, {
    method: "PATCH",
    headers: internalWriteHeaders(),
    body: JSON.stringify(body),
  });
}

export async function internalSortieDeleteFetch(id: string): Promise<Response> {
  const url = getInternalApiPath(`internal/sorties/${encodeURIComponent(id)}`);
  if (!url) throw new Error("internal_api_disabled");
  return fetch(url, { method: "DELETE", headers: internalWriteHeaders() });
}

/**
 * Sortie rows for the log when `VITE_INTERNAL_WRITES` is on — same shape as
 * Supabase `select * from sorties … limit 500`.
 */
export async function fetchInternalSortieTableRows(
  limit = 500,
): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath(`internal/sorties?limit=${encodeURIComponent(String(limit))}`);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

/**
 * Operator-facing health snapshot. The api-server route is mounted on
 * both `/internal/system-health` (hub) and `/aggregate/system-health`
 * (aggregator) — we try the hub path first, then fall back. Returns
 * `null` when the internal API is disabled (browser dev / non-LAN).
 */
export type SystemHealthComponent = {
  key: string;
  severity: "ok" | "warn" | "fail";
  message: string;
  detail?: Record<string, unknown> | null;
};

export type SystemHealthReport = {
  generatedAt: string;
  installProfile: string;
  schemaVersion: number;
  overall: "ok" | "warn" | "fail";
  components: SystemHealthComponent[];
};

export async function fetchInternalSystemHealth(): Promise<SystemHealthReport | null> {
  const candidates = ["internal/system-health", "aggregate/system-health"];
  for (const path of candidates) {
    const url = getInternalApiPath(path);
    if (!url) return null;
    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: internalApiHeadersBase(),
      });
      if (res.status === 404) continue;
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; report?: SystemHealthReport };
      if (body?.ok && body.report) return body.report;
      return null;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

// ── mDNS broadcast health (Task #398) ─────────────────────────────
//
// The api-server reads `%PROGRAMDATA%\HawkEye\mdns-supervisor.heartbeat`
// (when present) and reports whether the LAN broadcast is alive. The
// route is mounted on both `/internal/system/mdns-health` (hub) and
// `/aggregate/system/mdns-health` (aggregator). 404 means mDNS was
// never enabled on this host — the dashboard renders a "disabled"
// badge in that case.
export type MdnsBadgeState =
  | "alive"
  | "stale"
  | "restarting"
  | "spawn-failed"
  | "starting"
  | "unreadable"
  | "disabled";

export type MdnsHealthReport = {
  state: MdnsBadgeState;
  supervisorState: string | null;
  ageSec: number | null;
  staleThresholdSec: number;
  restartCount: number | null;
  squadronName: string | null;
  apiPort: string | null;
  timestamp: string | null;
  heartbeatPath: string;
};

export type MdnsHealthFetchResult =
  /** Heartbeat present (any state, including unreadable). */
  | { ok: true; report: MdnsHealthReport }
  /** mDNS never enabled — file does not exist. */
  | { ok: true; disabled: true }
  /** Internal API not reachable / endpoint missing — render nothing. */
  | { ok: false; error: string };

export async function fetchInternalMdnsHealth(): Promise<MdnsHealthFetchResult> {
  const candidates = ["internal/system/mdns-health", "aggregate/system/mdns-health"];
  let lastError = "internal_api_disabled";
  for (const path of candidates) {
    const url = getInternalApiPath(path);
    if (!url) return { ok: false, error: "internal_api_disabled" };
    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: internalApiHeadersBase(),
      });
      if (res.status === 404) {
        // 404 from the agent means "mdns_disabled" (no heartbeat
        // file). 404 from the proxy / wrong shell means "try next
        // candidate" — distinguish by inspecting the body.
        let body: { ok?: boolean; error?: string } = {};
        try {
          body = (await res.json()) as { ok?: boolean; error?: string };
        } catch {
          // non-JSON 404 → wrong mount, try next candidate.
        }
        if (body?.error === "mdns_disabled") {
          return { ok: true, disabled: true };
        }
        lastError = "endpoint_not_mounted";
        continue;
      }
      if (!res.ok) {
        lastError = `http_${res.status}`;
        return { ok: false, error: lastError };
      }
      const body = (await res.json()) as {
        ok?: boolean;
        report?: MdnsHealthReport;
      };
      if (body?.ok && body.report) {
        return { ok: true, report: body.report };
      }
      return { ok: false, error: "bad_payload" };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

// ── About this PC ─────────────────────────────────────────────────
// Settings-level snapshot. Mirrors fetchInternalSystemHealth: tries
// `/api/internal/about` first (hub), falls back to
// `/api/aggregate/about` (aggregator-wing / aggregator-base). Both
// routes are super_admin only and return `{ ok, report }`.
export type AboutThisPcLastBackupAge = {
  ageSeconds: number;
  path: string;
  fileName: string;
};

export type AboutThisPcLastBackupVerifyAge = {
  ageSeconds: number;
  ok: boolean;
};

export type AboutThisPcReport = {
  installProfile: string;
  hostname: string;
  apiServerVersion: string;
  buildTime: string;
  uptimeSeconds: number;
  databaseName: string | null;
  peerTokenCount: number | null;
  peerSquadronCount: number | null;
  lastBackupAge: AboutThisPcLastBackupAge | null;
  lastBackupVerifyAge: AboutThisPcLastBackupVerifyAge | null;
  nodeVersion: string;
};

export async function fetchInternalAboutThisPc(): Promise<AboutThisPcReport | null> {
  const candidates = ["internal/about", "aggregate/about"];
  for (const path of candidates) {
    const url = getInternalApiPath(path);
    if (!url) return null;
    try {
      const res = await fetch(url, {
        method: "GET",
        cache: "no-store",
        headers: internalApiHeadersBase(),
      });
      if (res.status === 404) continue;
      if (!res.ok) return null;
      const body = (await res.json()) as { ok?: boolean; report?: AboutThisPcReport };
      if (body?.ok && body.report) return body.report;
      return null;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

export type AboutThisPcAction = "run-backup" | "run-verify";

export type AboutThisPcActionResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Trigger one of the LAN-host maintenance scripts via the api-server.
 *
 * Wraps the `POST /api/internal/about/run-backup` and
 * `POST /api/internal/about/run-verify` endpoints added in task #390 so
 * the inline buttons on the AboutThisPc panel and the Settings health
 * ribbon can both fire them without re-implementing fetch glue.
 *
 * The api-server returns 202 immediately and runs the PowerShell
 * script detached; the caller should re-poll `fetchInternalAboutThisPc`
 * to watch the age dot go green.
 */
export async function postInternalAboutAction(
  action: AboutThisPcAction,
): Promise<AboutThisPcActionResult> {
  const candidates = [
    `internal/about/${action}`,
    `aggregate/about/${action}`,
  ];
  let lastError = "internal_api_disabled";
  for (const path of candidates) {
    const url = getInternalApiPath(path);
    if (!url) continue;
    try {
      const res = await fetch(url, {
        method: "POST",
        cache: "no-store",
        headers: internalApiHeadersBase(),
      });
      if (res.status === 404) {
        // The aggregator router doesn't mount the action routes today;
        // fall through and let the next candidate try.
        lastError = "not_found";
        continue;
      }
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (res.ok && body?.ok) return { ok: true };
      lastError = body?.error || `http_${res.status}`;
      // Don't fan out a definitive server response across candidates.
      return { ok: false, error: lastError };
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
    }
  }
  return { ok: false, error: lastError };
}

export async function fetchInternalAuditLogRows(
  limit = 2500,
): Promise<
  Array<{
    occurred_at?: string | null;
    actor?: string | null;
    type?: string | null;
    detail?: unknown;
  }> | null
> {
  const url = getInternalApiPath(`internal/audit-log?limit=${encodeURIComponent(String(limit))}`);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter(
      (x): x is { occurred_at?: string | null; actor?: string | null; type?: string | null; detail?: unknown } =>
        !!x && typeof x === "object",
    );
  } catch {
    return null;
  }
}

/**
 * Insert a single audit-log row via the LAN api-server. Best-effort —
 * never throws (the caller in supabase.ts swallows). Used by the LAN-mode
 * `recordAuditEvent` shim to replace what used to be a Supabase RLS-gated
 * insert.
 */
export async function postInternalAuditLog(event: {
  type: string;
  actor?: string | null;
  detail?: Record<string, unknown> | null;
}): Promise<{ ok: boolean; error?: string }> {
  const url = getInternalApiPath("internal/audit/log");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...internalApiHeadersBase(),
      },
      body: JSON.stringify({
        type: event.type,
        actor: event.actor ?? null,
        detail: event.detail ?? null,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `http_${res.status}` };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInternalUnavailableRows(): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath("internal/unavailable");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function postInternalUnavailableUpsertDay(
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/unavailable/upsert-day");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalUnavailableDay(
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/unavailable/day");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postInternalUnavailableInsert(
  payload: Record<string, unknown>,
): Promise<{ ok: true; row?: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/unavailable");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    const row = parsed?.row;
    return {
      ok: true,
      row: row && typeof row === "object" ? (row as Record<string, unknown>) : undefined,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalUnavailableById(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/unavailable/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInternalDutyWeekRows(): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath("internal/duty-week");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function fetchInternalLeavesRows(
  year: number,
): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath(`internal/leaves?year=${encodeURIComponent(String(year))}`);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function fetchInternalAlertsRows(): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath("internal/alerts");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function postInternalAlertInsert(
  payload: Record<string, unknown>,
): Promise<{ ok: true; row?: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/alerts");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    const row = parsed?.row;
    return { ok: true, row: row && typeof row === "object" ? (row as Record<string, unknown>) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function patchInternalAlert(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/alerts/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalAlert(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/alerts/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInternalNotamsRows(): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath("internal/notams");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function postInternalNotamInsert(
  payload: Record<string, unknown>,
): Promise<{ ok: true; row?: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/notams");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    const row = parsed?.row;
    return { ok: true, row: row && typeof row === "object" ? (row as Record<string, unknown>) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function patchInternalNotam(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/notams/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalNotam(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/notams/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInternalScheduleRows(
  dateIso: string,
): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath(`internal/schedule?date=${encodeURIComponent(dateIso)}`);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function fetchInternalSavedDutyWeeksRows(
  squadron: string,
): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath(`internal/saved-duty-weeks?squadron=${encodeURIComponent(squadron)}`);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function postInternalSavedDutyWeekUpsert(
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/saved-duty-weeks");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalOldSavedDutyWeeks(
  squadron: string,
  cutoffIso: string,
): Promise<{ ok: true; removed: number } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(
    `internal/saved-duty-weeks/old?squadron=${encodeURIComponent(squadron)}&cutoff=${encodeURIComponent(cutoffIso)}`,
  );
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true, removed: Number(parsed?.removed ?? 0) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchInternalSquadronUsersRows(): Promise<Record<string, unknown>[] | null> {
  const url = getInternalApiPath("internal/users");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items.filter((x): x is Record<string, unknown> => !!x && typeof x === "object");
  } catch {
    return null;
  }
}

export async function postInternalSquadronUserCreate(
  payload: Record<string, unknown>,
): Promise<{ ok: true; row?: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath("internal/users");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    const row = parsed?.row;
    return { ok: true, row: row && typeof row === "object" ? (row as Record<string, unknown>) : undefined };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function patchInternalSquadronUser(
  id: string,
  payload: Record<string, unknown>,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/users/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalSquadronUser(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/users/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postInternalImportHistory(
  payload: Record<string, unknown>,
): Promise<
  | { ok: true; stamp: string; pilotsInserted: number; sortiesInserted: number }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/import/history");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(payload),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return {
      ok: true,
      stamp: String(parsed?.stamp ?? ""),
      pilotsInserted: Number(parsed?.pilotsInserted ?? 0),
      sortiesInserted: Number(parsed?.sortiesInserted ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postInternalUndoImport(
  stamp: string,
): Promise<
  | { ok: true; pilotsRemoved: number; sortiesRemoved: number }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/import/undo");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify({ stamp }),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return {
      ok: true,
      pilotsRemoved: Number(parsed?.pilotsRemoved ?? 0),
      sortiesRemoved: Number(parsed?.sortiesRemoved ?? 0),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * One row from `GET /api/internal/users` (Super Admin user-management page).
 *
 * Mirrors the LAN api-server columns from `lan_users` plus the runtime-derived
 * `disabled_at` flag (null = active, ISO timestamp = disabled). The admin Users
 * page (pages/admin/Users.tsx) renders this list, and the LAN session middleware
 * refuses to mint or honour sessions for any row with a non-null `disabled_at`.
 */
export type InternalLanUserRow = {
  id: string;
  username: string;
  display_name: string | null;
  role: string;
  squadron_id: string | null;
  wing_id: string | null;
  base_id: string | null;
  disabled_at: string | null;
  created_at: string;
};

export async function fetchInternalLanUsers(): Promise<InternalLanUserRow[] | null> {
  const url = getInternalApiPath("internal/users");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map((r) => ({
        id: String(r.id ?? ""),
        username: String(r.username ?? ""),
        display_name:
          r.display_name == null || r.display_name === ""
            ? null
            : String(r.display_name),
        role: String(r.role ?? ""),
        squadron_id:
          r.squadron_id == null || r.squadron_id === "" ? null : String(r.squadron_id),
        wing_id:
          r.wing_id == null || r.wing_id === "" ? null : String(r.wing_id),
        base_id:
          r.base_id == null || r.base_id === "" ? null : String(r.base_id),
        disabled_at:
          r.disabled_at == null || r.disabled_at === "" ? null : String(r.disabled_at),
        created_at: String(r.created_at ?? ""),
      }));
  } catch {
    return null;
  }
}

export async function postInternalLanUserCreate(input: {
  username: string;
  password: string;
  role: string;
  display_name?: string;
  squadron_id?: string | null;
  wing_id?: string | null;
  base_id?: string | null;
}): Promise<
  | { ok: true; row: InternalLanUserRow }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/users");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(input),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    const r = (parsed?.row ?? {}) as Record<string, unknown>;
    return {
      ok: true,
      row: {
        id: String(r.id ?? ""),
        username: String(r.username ?? ""),
        display_name:
          r.display_name == null || r.display_name === "" ? null : String(r.display_name),
        role: String(r.role ?? ""),
        squadron_id:
          r.squadron_id == null || r.squadron_id === "" ? null : String(r.squadron_id),
        wing_id: r.wing_id == null || r.wing_id === "" ? null : String(r.wing_id),
        base_id: r.base_id == null || r.base_id === "" ? null : String(r.base_id),
        disabled_at:
          r.disabled_at == null || r.disabled_at === "" ? null : String(r.disabled_at),
        created_at: String(r.created_at ?? ""),
      },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Patch a LAN user. Each field is only sent if the caller wants to change it.
 * `disabled` flips the soft-disable flag; the server stamps / clears
 * `disabled_at` and refuses to disable the last super_admin.
 */
export async function patchInternalLanUser(
  id: string,
  input: {
    password?: string;
    role?: string;
    squadron_id?: string | null;
    wing_id?: string | null;
    base_id?: string | null;
    disabled?: boolean;
  },
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/users/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: internalWriteHeaders(),
      body: JSON.stringify(input),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalLanUser(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = getInternalApiPath(`internal/users/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, { method: "DELETE", headers: internalWriteHeaders() });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Peer access tokens — super_admin CRUD against
 * `routes/peer-tokens-internal.ts`. The plain token text is returned
 * exactly once at create time and is never re-derivable from the row;
 * after that only metadata (label, scope, issued_at, last_used_at,
 * revoked_at, …) is exposed.
 */
export type InternalPeerTokenRow = {
  id: string;
  label: string | null;
  scope: string;
  issued_at: string;
  issued_by: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by: string | null;
  last_used_at: string | null;
};

function parsePeerTokenRow(r: Record<string, unknown>): InternalPeerTokenRow {
  const str = (v: unknown): string | null =>
    v == null || v === "" ? null : String(v);
  return {
    id: String(r.id ?? ""),
    label: str(r.label),
    scope: String(r.scope ?? ""),
    issued_at: String(r.issued_at ?? ""),
    issued_by: str(r.issued_by),
    expires_at: str(r.expires_at),
    revoked_at: str(r.revoked_at),
    revoked_by: str(r.revoked_by),
    last_used_at: str(r.last_used_at),
  };
}

export async function fetchInternalPeerTokens(): Promise<
  InternalPeerTokenRow[] | null
> {
  const url = getInternalApiPath("internal/peer-tokens");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map(parsePeerTokenRow);
  } catch {
    return null;
  }
}

export async function postInternalPeerTokenCreate(input: {
  label: string;
  scope?: string;
  expires_at?: string | null;
}): Promise<
  | { ok: true; token: string; row: InternalPeerTokenRow }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/peer-tokens");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify({
        label: input.label,
        scope: input.scope,
        expires_at: input.expires_at ?? null,
      }),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(parsed?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    const token = String(parsed?.token ?? "").trim();
    const row = parsed?.row && typeof parsed.row === "object"
      ? parsePeerTokenRow(parsed.row as Record<string, unknown>)
      : null;
    if (!token || !row) {
      return { ok: false, error: "peer_token_bad_payload" };
    }
    return { ok: true, token, row };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteInternalPeerToken(
  id: string,
): Promise<
  | { ok: true; row: InternalPeerTokenRow }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath(
    `internal/peer-tokens/${encodeURIComponent(id)}`,
  );
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return {
        ok: false,
        error: String(parsed?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    const row = parsed?.row && typeof parsed.row === "object"
      ? parsePeerTokenRow(parsed.row as Record<string, unknown>)
      : null;
    if (!row) return { ok: false, error: "peer_token_bad_payload" };
    return { ok: true, row };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function postInternalPilotTransfer(
  pilotId: string,
  toSquadronId: string,
): Promise<
  | { ok: true; pilotId: string; fromSquadron: string | null; toSquadron: string }
  | { ok: false; error: string; status?: number }
> {
  const url = getInternalApiPath("internal/pilots/transfer");
  if (!url) return { ok: false, error: "internal_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify({
        pilot_id: pilotId,
        to_squadron_id: toSquadronId,
      }),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, error: String(parsed?.error ?? `http_${res.status}`), status: res.status };
    }
    return {
      ok: true,
      pilotId: String(parsed?.pilotId ?? pilotId),
      fromSquadron:
        parsed?.fromSquadron == null || parsed.fromSquadron === ""
          ? null
          : String(parsed.fromSquadron),
      toSquadron: String(parsed?.toSquadron ?? toSquadronId),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ─────────────────────────────────────────────────────────────────────
// Aggregator-mode helpers (Wing/Base PCs)
//
// These talk to `/api/aggregate/*`, the surface mounted only when the
// active install profile is `aggregator-wing` or `aggregator-base`.
// On a hub PC the routes don't exist, so the helpers return `null` /
// surface a structured error rather than throwing.
// ─────────────────────────────────────────────────────────────────────

function aggregateApiPath(path: string): string | null {
  const stripped = path.replace(/^\/+/, "");
  return getInternalApiPath(`aggregate/${stripped}`);
}

export type PeerSquadronListRow = {
  id: string;
  squadron_id: string;
  squadron_name: string | null;
  base_url: string;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
  has_token: boolean;
  added_by: string | null;
  status: "online" | "offline";
};

function parsePeerListRow(r: Record<string, unknown>): PeerSquadronListRow {
  const status = r.status === "online" ? "online" : "offline";
  return {
    id: String(r.id ?? ""),
    squadron_id: String(r.squadron_id ?? ""),
    squadron_name:
      r.squadron_name == null || r.squadron_name === ""
        ? null
        : String(r.squadron_name),
    base_url: String(r.base_url ?? ""),
    last_ok_at:
      r.last_ok_at == null || r.last_ok_at === "" ? null : String(r.last_ok_at),
    last_error:
      r.last_error == null || r.last_error === "" ? null : String(r.last_error),
    last_error_at:
      r.last_error_at == null || r.last_error_at === ""
        ? null
        : String(r.last_error_at),
    has_token: Boolean(r.has_token),
    added_by:
      r.added_by == null || r.added_by === "" ? null : String(r.added_by),
    status,
  };
}

export async function fetchAggregatePeersList(): Promise<
  PeerSquadronListRow[] | null
> {
  const url = aggregateApiPath("peers");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown };
    if (!body || !Array.isArray(body.items)) return null;
    return body.items
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map(parsePeerListRow);
  } catch {
    return null;
  }
}

/**
 * Mirror of `PeerErrorKind` on the server. The dashboard switches the
 * Squadron Status badge from gray "Offline" to yellow "Token expired"
 * when the kind is `auth_invalid` or `auth_revoked`, which prompts the
 * operator to paste the new bearer (e.g. after the squadron ran
 * `reset-peer-token.ps1` without telling the aggregator).
 */
export type PeerErrorKind =
  | "network_error"
  | "auth_invalid"
  | "auth_revoked"
  | "other_http";

export type PeerHealthStatus = {
  peer_squadron_id: string;
  squadron_id: string;
  squadron_name: string | null;
  status: "online" | "offline";
  last_success_at: string | null;
  served_from_cache: boolean;
  error?: string;
  error_kind?: PeerErrorKind;
};

function parsePeerErrorKind(v: unknown): PeerErrorKind | undefined {
  if (typeof v !== "string") return undefined;
  switch (v) {
    case "network_error":
    case "auth_invalid":
    case "auth_revoked":
    case "other_http":
      return v;
    default:
      return undefined;
  }
}

function parsePeerHealth(r: Record<string, unknown>): PeerHealthStatus {
  const status = r.status === "online" ? "online" : "offline";
  const out: PeerHealthStatus = {
    peer_squadron_id: String(r.peer_squadron_id ?? ""),
    squadron_id: String(r.squadron_id ?? ""),
    squadron_name:
      r.squadron_name == null || r.squadron_name === ""
        ? null
        : String(r.squadron_name),
    status,
    last_success_at:
      r.last_success_at == null || r.last_success_at === ""
        ? null
        : String(r.last_success_at),
    served_from_cache: Boolean(r.served_from_cache),
  };
  if (r.error != null && r.error !== "") {
    out.error = String(r.error);
  }
  const kind = parsePeerErrorKind(r.error_kind);
  if (kind) out.error_kind = kind;
  return out;
}

export async function fetchAggregatePeersHealth(): Promise<
  PeerHealthStatus[] | null
> {
  const url = aggregateApiPath("peers/health");
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { peers?: unknown };
    if (!body || !Array.isArray(body.peers)) return null;
    return body.peers
      .filter((x): x is Record<string, unknown> => !!x && typeof x === "object")
      .map(parsePeerHealth);
  } catch {
    return null;
  }
}

export type PostAggregatePeerInput = {
  squadron_id: string;
  squadron_name?: string | null;
  base_url: string;
  token: string;
};

export type PostAggregatePeerResult =
  | {
      ok: true;
      id: string;
      squadron_id: string;
      squadron_name: string | null;
      base_url: string;
    }
  | { ok: false; error: string; status?: number };

export async function postAggregatePeer(
  input: PostAggregatePeerInput,
): Promise<PostAggregatePeerResult> {
  const url = aggregateApiPath("peers");
  if (!url) return { ok: false, error: "aggregate_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify(input),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      return {
        ok: false,
        error: String(parsed?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    return {
      ok: true,
      id: String(parsed.id ?? ""),
      squadron_id: String(parsed.squadron_id ?? input.squadron_id),
      squadron_name:
        parsed.squadron_name == null || parsed.squadron_name === ""
          ? null
          : String(parsed.squadron_name),
      base_url: String(parsed.base_url ?? input.base_url),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type PatchAggregatePeerInput = {
  squadron_name?: string | null;
  base_url?: string;
  token?: string;
};

export async function patchAggregatePeer(
  id: string,
  input: PatchAggregatePeerInput,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = aggregateApiPath(`peers/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "aggregate_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "PATCH",
      headers: internalWriteHeaders(),
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        ok: false,
        error: String(parsed?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Result of a peer-token probe. The dashboard's "Refresh peer token"
 * dialog uses `error_kind` to localise the failure reason — e.g.
 * "Token still revoked" vs "Token still rejected" vs "Peer
 * unreachable" — so the operator knows whether to ask the squadron
 * to re-issue the token or to check the network.
 */
export type ProbeAggregatePeerResult =
  | { ok: true }
  | {
      ok: false;
      /** Empty string when the route itself failed (HTTP error). */
      error: string;
      error_kind?: PeerErrorKind;
      status?: number;
    };

/**
 * POST /api/aggregate/peers/:id/probe with `{auth_token}`. Lets the
 * Refresh Peer Token dialog verify a freshly-pasted bearer against the
 * peer's `/api/peer/healthz` BEFORE the operator commits it via PATCH.
 */
export async function probeAggregatePeer(
  id: string,
  authToken: string,
): Promise<ProbeAggregatePeerResult> {
  const url = aggregateApiPath(`peers/${encodeURIComponent(id)}/probe`);
  if (!url) return { ok: false, error: "aggregate_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: internalWriteHeaders(),
      body: JSON.stringify({ auth_token: authToken }),
    });
    const parsed = (await res.json().catch(() => ({}))) as Record<
      string,
      unknown
    >;
    if (!res.ok) {
      return {
        ok: false,
        error: String(parsed?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    if (parsed?.ok === true) return { ok: true };
    return {
      ok: false,
      error: String(parsed?.error ?? "probe_failed"),
      error_kind: parsePeerErrorKind(parsed?.error_kind),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteAggregatePeer(
  id: string,
): Promise<{ ok: true } | { ok: false; error: string; status?: number }> {
  const url = aggregateApiPath(`peers/${encodeURIComponent(id)}`);
  if (!url) return { ok: false, error: "aggregate_api_disabled" };
  try {
    const res = await fetch(url, {
      method: "DELETE",
      headers: internalWriteHeaders(),
    });
    if (!res.ok) {
      const parsed = (await res.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      return {
        ok: false,
        error: String(parsed?.error ?? `http_${res.status}`),
        status: res.status,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export type AggregateRowKind =
  | "pilots"
  | "sorties"
  | "leaves"
  | "unavailable"
  | "notams"
  | "readiness-summary";

export type AggregateRow = Record<string, unknown> & {
  /** Tagged by `tagRows()` on the server — present on every row. */
  squadron_id?: string;
  squadron_name?: string | null;
  source_peer_id?: string;
};

export type AggregateRowsResult = {
  items: AggregateRow[];
  peers: PeerHealthStatus[];
};

export async function fetchAggregateRows(
  kind: AggregateRowKind,
): Promise<AggregateRowsResult | null> {
  const url = aggregateApiPath(kind);
  if (!url) return null;
  try {
    const res = await fetch(url, {
      method: "GET",
      cache: "no-store",
      headers: internalApiHeadersBase(),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { items?: unknown; peers?: unknown };
    if (!body) return null;
    const items = Array.isArray(body.items)
      ? body.items.filter(
          (x): x is Record<string, unknown> => !!x && typeof x === "object",
        )
      : [];
    const peers = Array.isArray(body.peers)
      ? body.peers
          .filter(
            (x): x is Record<string, unknown> => !!x && typeof x === "object",
          )
          .map(parsePeerHealth)
      : [];
    return { items, peers };
  } catch {
    return null;
  }
}
