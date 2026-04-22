// Cross-PC workflow layer.
//
// This module backs the four ecosystem features that span more than one
// squadron PC: the squadron-PC registry, cross-squadron pending sortie
// approvals, the flight-schedule sharing chain (Squadron ↔ Wing ↔ Base),
// and Sqn/Wing/Base private messages.
//
// When VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY are configured we talk
// to four shared tables on the central Supabase project (xpc_registry,
// xpc_pending, xpc_schedule_shares, xpc_messages). Unlike the per-squadron
// operational tables these are intentionally cross-tenant — every PC in
// the ecosystem can see every other PC, and a wing/base PC must read rows
// originated by squadrons it oversees. RLS on those tables is permissive
// (any authenticated user); per-PC filtering happens in the queryFn below.
//
// When Supabase is NOT configured (demo mode / standalone Electron preview
// before the central server is online) we fall back to a single
// localStorage namespace per channel ("rjaf.xpc.*"). The fallback keeps
// the in-browser preview working and lets a single PC see its own slice;
// other PCs render as "registered but offline" until the link comes back.

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { Sortie } from "./mock";
import { supabase, supabaseConfigured, recordAuditEvent } from "./supabase";

const isLive = () => supabaseConfigured && supabase !== null;

// PostgREST returns PGRST205 when a table referenced in code does not yet
// exist in the central Supabase schema (i.e. migrations 0011/0012/0013
// have not been applied). When that happens the cross-PC layer should
// degrade gracefully — fall back to the local mirror and stay quiet —
// instead of spamming a "Couldn't reach the server" toast every poll
// interval. Detect both the structured Supabase error and a plain Error
// whose .message embeds the PostgREST JSON.
function isMissingTableError(err: unknown): boolean {
  if (!err) return false;
  const code = (err as { code?: string }).code;
  if (code === "PGRST205" || code === "42P01") return true;
  const msg = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return /PGRST205|Could not find the table|does not exist/i.test(msg);
}

// Wrap a Supabase query so PGRST205 (missing table) is swallowed and a
// caller-supplied local fallback runs instead. Other errors still throw.
async function liveOrLocal<T>(remote: () => Promise<T>, local: () => T | Promise<T>): Promise<T> {
  try {
    return await remote();
  } catch (err) {
    if (isMissingTableError(err)) return await local();
    throw err;
  }
}

// ── shared helpers ──────────────────────────────────────────────────────
function readJSON<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return (v ?? fallback) as T;
  } catch {
    return fallback;
  }
}
function writeJSON<T>(key: string, v: T) {
  try { localStorage.setItem(key, JSON.stringify(v)); } catch { /* quota / private mode */ }
}
function genId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
function nowIso(): string { return new Date().toISOString(); }

// ── 1. Squadron PC registry ─────────────────────────────────────────────
//
// Every squadron PC that has ever signed in is registered. A PC may be
// offline at any moment — registration is by ecosystem, not live link, so
// other PCs still see the entry in pickers and the registry catches up
// silently when the offline PC reconnects.
const REGISTRY_KEY = "rjaf.xpc.registry";
// Heartbeat written by the local PC on every signed-in render. PCs whose
// heartbeat is older than this window are considered offline (they still
// stay in the registry — they just render without the green dot).
const ONLINE_WINDOW_MS = 5 * 60_000;

// Tier of the PC in the Squadron → Wing → Base → HQ chain. The tier is
// what the schedule-sharing chain enforces when picking forward targets:
// a squadron PC can only forward up to a `wing` PC, a wing PC can only
// forward up to a `base` PC, and a base PC terminates the chain.
export type PcTier = "flight" | "squadron" | "wing" | "base" | "hq";

// ── Flight Commander binding ────────────────────────────────────────────
//
// A Flight Commander PC reports up to ONE specific Squadron Commander PC
// chosen at first-run setup. Once bound, every cross-PC surface on the
// flight PC (schedule sharing recipient picker, messages composer) is
// reshaped to address only that single squadron commander. The binding
// is stored only in localStorage on the flight PC itself — the squadron
// commander doesn't need to know the relationship in advance, the
// inbound schedule share carries the originator id and routes the
// approval back automatically.
const FLIGHT_BIND_ID_KEY   = "rjaf.pc.flight.boundPcId";
const FLIGHT_BIND_NAME_KEY = "rjaf.pc.flight.boundPcName";

export interface FlightBinding {
  pcId: string;
  pcName: string;
}

export function getFlightBinding(): FlightBinding | null {
  const id = localStorage.getItem(FLIGHT_BIND_ID_KEY) ?? "";
  if (!id) return null;
  return { pcId: id, pcName: localStorage.getItem(FLIGHT_BIND_NAME_KEY) ?? id };
}

export function setFlightBinding(b: FlightBinding | null) {
  if (!b || !b.pcId) {
    localStorage.removeItem(FLIGHT_BIND_ID_KEY);
    localStorage.removeItem(FLIGHT_BIND_NAME_KEY);
    return;
  }
  localStorage.setItem(FLIGHT_BIND_ID_KEY, b.pcId);
  localStorage.setItem(FLIGHT_BIND_NAME_KEY, b.pcName || b.pcId);
}

// Admin-driven Flight↔Squadron commander binding overrides. April 2026:
// per CO request the binding selection is moved out of the flight PC's
// first-run gate and into Super Admin → Commanders, so HQ controls who
// reports to whom. The override is keyed by the flight commander's
// username; when that commander signs in on any PC, the gate auto-applies
// the override and skips the manual picker. Stored in a single
// localStorage map per PC so admin presets are restorable from any
// machine that's been synced.
const ADMIN_FLIGHT_BIND_KEY = "rjaf.pc.flight.adminOverrides";
type AdminBindingMap = Record<string, FlightBinding>;
function readAdminMap(): AdminBindingMap {
  try {
    const raw = localStorage.getItem(ADMIN_FLIGHT_BIND_KEY);
    return raw ? (JSON.parse(raw) as AdminBindingMap) : {};
  } catch { return {}; }
}
export function getAdminFlightBindingFor(username: string | null | undefined): FlightBinding | null {
  if (!username) return null;
  const m = readAdminMap();
  return m[username.toLowerCase()] ?? null;
}
export function setAdminFlightBindingFor(username: string, b: FlightBinding | null) {
  const m = readAdminMap();
  const key = username.toLowerCase();
  if (!b || !b.pcId) delete m[key];
  else m[key] = { pcId: b.pcId, pcName: b.pcName || b.pcId };
  try { localStorage.setItem(ADMIN_FLIGHT_BIND_KEY, JSON.stringify(m)); } catch { /* ignore */ }
  // Broadcast to every other PC via the shared audit_log channel. The
  // event carries the full binding map so a flight PC that boots later
  // gets the latest view in a single fetch (see syncAdminFlightBindingsFromRemote).
  void recordAuditEvent({
    type: "admin.flight.binding.set",
    actor: "super-admin",
    detail: { username: key, binding: b ?? null, map: m },
  });
}
export function listAdminFlightBindings(): AdminBindingMap {
  return readAdminMap();
}

// Pull the latest admin-published flight bindings from Supabase and cache
// them locally. The Super Admin writes the binding by calling
// setAdminFlightBindingFor above, which both updates their localStorage
// AND inserts an audit_log row containing the full map. Any other PC can
// recover the latest state by selecting the most recent
// admin.flight.binding.set event. This is the cross-PC channel that
// distinguishes the April 2026 implementation from the previous
// localStorage-only approach.
export async function syncAdminFlightBindingsFromRemote(): Promise<void> {
  if (!isLive() || !supabase) return;
  const { data, error } = await supabase
    .from("audit_log")
    .select("detail")
    .eq("type", "admin.flight.binding.set")
    .order("occurred_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return;
  const detail = (data as { detail?: Record<string, unknown> }).detail ?? {};
  const map = (detail.map ?? {}) as AdminBindingMap;
  if (map && typeof map === "object") {
    try {
      localStorage.setItem(ADMIN_FLIGHT_BIND_KEY, JSON.stringify(map));
    } catch { /* ignore */ }
  }
}

// ──────────────────────────────────────────────────────────────────────
// Squadron-commander → flight-commander group. Published by a Squadron
// Commander PC when it finishes Setup with a non-empty
// `rjaf.linkedFlightPcIds`. Any flight commander PC whose id is in
// `flightPcIds` picks this up on sign-in and auto-sets its local
// flight binding to the squadron commander PC — so the whole squadron
// group (ops PC + squadron commander + linked flight commanders) can
// message and coordinate without an additional admin step.
// ──────────────────────────────────────────────────────────────────────
export interface SquadronFlightGroup {
  squadronPcId: string;
  squadronPcName: string;
  flightPcIds: string[];
  publishedAt: string;
}

export async function publishSquadronFlightGroup(
  squadronPcId: string,
  squadronPcName: string,
  flightPcIds: string[],
): Promise<void> {
  if (!squadronPcId) return;
  const payload: SquadronFlightGroup = {
    squadronPcId,
    squadronPcName: squadronPcName || squadronPcId,
    flightPcIds: Array.from(new Set(flightPcIds.filter(Boolean))),
    publishedAt: nowIso(),
  };
  try {
    await recordAuditEvent({
      type: "xpc.squadron.flight.group.set",
      actor: squadronPcId,
      detail: payload as unknown as Record<string, unknown>,
    });
  } catch {
    // Silent — the registry heartbeat re-runs every 30s and will retry.
  }
}

// Called on every flight commander PC sign-in. Finds the most recent
// squadron group that lists THIS flight PC, and returns the squadron
// binding to apply. Returns null when no group claims this PC or when
// offline (the caller falls back to the admin-override path).
// Super Admin entry point: fetch the most recent group published for a
// given squadron PC id. Used by the Squadrons admin page so the edit
// dialog can pre-populate the flight-commander checkbox list and the
// admin can add/remove members post-setup without visiting the
// squadron commander PC.
export async function getLatestSquadronFlightGroup(
  squadronPcId: string,
): Promise<SquadronFlightGroup | null> {
  if (!isLive() || !supabase || !squadronPcId) return null;
  const { data, error } = await supabase
    .from("audit_log")
    .select("detail, occurred_at")
    .eq("type", "xpc.squadron.flight.group.set")
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (error || !data) return null;
  for (const row of data as { detail?: Record<string, unknown> }[]) {
    const d = row.detail ?? {};
    const sid = typeof (d as { squadronPcId?: unknown }).squadronPcId === "string"
      ? (d as { squadronPcId: string }).squadronPcId
      : "";
    if (sid !== squadronPcId) continue;
    const ids = Array.isArray((d as { flightPcIds?: unknown }).flightPcIds)
      ? ((d as { flightPcIds: unknown[] }).flightPcIds.filter(
          (x): x is string => typeof x === "string",
        ))
      : [];
    const name = typeof (d as { squadronPcName?: unknown }).squadronPcName === "string"
      ? (d as { squadronPcName: string }).squadronPcName
      : sid;
    const at = typeof (d as { publishedAt?: unknown }).publishedAt === "string"
      ? (d as { publishedAt: string }).publishedAt
      : nowIso();
    return { squadronPcId: sid, squadronPcName: name, flightPcIds: ids, publishedAt: at };
  }
  return null;
}

export async function syncSquadronFlightGroupForFlightPc(
  flightPcId: string,
): Promise<FlightBinding | null> {
  if (!isLive() || !supabase || !flightPcId) return null;
  const { data, error } = await supabase
    .from("audit_log")
    .select("detail, occurred_at")
    .eq("type", "xpc.squadron.flight.group.set")
    .order("occurred_at", { ascending: false })
    .limit(50);
  if (error || !data) return null;
  // Latest group (per squadron) wins — walk newest → oldest and return
  // the first one whose flightPcIds includes us.
  for (const row of data as { detail?: Record<string, unknown> }[]) {
    const d = row.detail ?? {};
    const ids = Array.isArray((d as { flightPcIds?: unknown }).flightPcIds)
      ? ((d as { flightPcIds: unknown[] }).flightPcIds.filter(
          (x): x is string => typeof x === "string",
        ))
      : [];
    if (!ids.includes(flightPcId)) continue;
    const sqId = typeof (d as { squadronPcId?: unknown }).squadronPcId === "string"
      ? (d as { squadronPcId: string }).squadronPcId
      : "";
    const sqName = typeof (d as { squadronPcName?: unknown }).squadronPcName === "string"
      ? (d as { squadronPcName: string }).squadronPcName
      : sqId;
    if (!sqId) continue;
    return { pcId: sqId, pcName: sqName };
  }
  return null;
}

export interface SquadronPC {
  id: string;             // canonical ecosystem id (squadron name, or
                          // commander-scope id e.g. "WING:NWAC")
  squadronName: string;   // human-readable label, e.g. "8 SQN"
  tier: PcTier;
  base?: string;          // e.g. "Marka"
  wing?: string;          // e.g. "RWAC"
  // Optional friendly device label the owner of this PC set in Setup /
  // Security (rjaf.pcDeviceName). When present, commander pickers prefer
  // this over the base suffix because operators asked to identify PCs by
  // "the name I gave the device", not by the airbase it happens to be at.
  deviceName?: string;
  lastSeen: string;       // ISO
}

export interface RegisteredPC extends SquadronPC {
  online: boolean;
  isSelf: boolean;
}

function readRegistry(): SquadronPC[] {
  return readJSON<SquadronPC[]>(REGISTRY_KEY, []);
}
function writeRegistry(rows: SquadronPC[]) {
  writeJSON(REGISTRY_KEY, rows);
}

// The local PC's own canonical id. Set by `registerLocalPC` — every page
// that filters by "is this for me?" (pending queue, schedule chain, the
// messages inbox) reads this value, so the same id flows from the writer
// (host PC submitting a pending entry) to the reader (home PC reviewing
// it). The id is the squadron name for squadron PCs, or a tier-prefixed
// id for commander tiers (e.g. "WING:NWAC", "BASE:Marka").
function localPcId(): string {
  return localStorage.getItem("rjaf.xpc.localId") ?? "";
}
export function getLocalPcId(): string {
  return localPcId();
}
export function setLocalPcId(id: string): void {
  try {
    if (id) localStorage.setItem("rjaf.xpc.localId", id);
  } catch { /* localStorage may be blocked in tests */ }
}

// Stable per-machine random suffix. Generated once on first request and
// cached in localStorage so the same physical PC always derives the same
// suffix across restarts. Used to disambiguate two PCs that happen to be
// signed in with the same account (e.g. two flight commander offices
// sharing one set of credentials) — without a suffix they would heartbeat
// to the same registry id and overwrite each other every 30 seconds. The
// canonical ops PC intentionally does NOT use this suffix because its id
// IS the squadron's address that other PCs route to.
export function getDeviceSuffix(): string {
  try {
    const existing = localStorage.getItem("rjaf.deviceSuffix");
    if (existing && /^[0-9a-f]{6}$/.test(existing)) return existing;
    let fresh = "";
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      fresh = crypto.randomUUID().replace(/-/g, "").slice(0, 6);
    } else {
      fresh = Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
    }
    localStorage.setItem("rjaf.deviceSuffix", fresh);
    return fresh;
  } catch {
    // localStorage blocked — return an in-process random so the session
    // still has a unique-ish suffix even if it can't be persisted.
    return Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, "0");
  }
}

export interface RegisterPcOpts {
  id: string;
  displayName: string;
  tier: PcTier;
  base?: string;
  wing?: string;
}

function rowToPc(r: Record<string, unknown>): SquadronPC {
  const id = String(r.id);
  // The xpc_registry table's tier CHECK constraint pre-dates the Flight
  // Commander tier and only accepts squadron/wing/base/hq. To keep the
  // schema unchanged we encode flight PCs in the id prefix ("FLIGHT:")
  // and write tier='squadron' to the DB; on read we recover the true
  // tier from the prefix here so the rest of the app sees "flight".
  let tier = (r.tier as PcTier) ?? "squadron";
  if (id.startsWith("FLIGHT:")) tier = "flight";
  return {
    id,
    squadronName: String(r.squadron_name ?? ""),
    tier,
    base: r.base ? String(r.base) : undefined,
    wing: r.wing ? String(r.wing) : undefined,
    deviceName: r.device_name ? String(r.device_name) : undefined,
    lastSeen: String(r.last_seen ?? nowIso()),
  };
}

export function registerLocalPC(opts: RegisterPcOpts | string, base?: string, wing?: string) {
  // Backwards-compat: an early form was `registerLocalPC(squadronName, base, wing)`
  // — that path is preserved by promoting the squadron name to both the
  // canonical id and the display name with tier="squadron".
  const o: RegisterPcOpts = typeof opts === "string"
    ? { id: opts, displayName: opts, tier: "squadron", base, wing }
    : opts;
  if (!o.id) return;
  localStorage.setItem("rjaf.xpc.localId", o.id);
  // Pick up the friendly device label the operator saved in Setup /
  // Security (localStorage `rjaf.pcDeviceName`) so commander pickers can
  // show "8SQN — Ops Cockpit-3" instead of repeating the base name.
  const deviceName = (() => {
    try { return localStorage.getItem("rjaf.pcDeviceName") || undefined; } catch { return undefined; }
  })();
  const entry: SquadronPC = {
    id: o.id,
    squadronName: o.displayName,
    tier: o.tier,
    base: o.base,
    wing: o.wing,
    deviceName,
    lastSeen: nowIso(),
  };
  // Mirror into localStorage so the offline fallback path (and a quick
  // first paint before the Supabase round-trip resolves) has data to show.
  const rows = readRegistry();
  const idx = rows.findIndex(r => r.id === o.id);
  if (idx >= 0) rows[idx] = { ...rows[idx], ...entry }; else rows.push(entry);
  writeRegistry(rows);
  // Fire-and-forget upsert into the shared registry. Failures are silent
  // — this runs every 30s anyway so a flaky write recovers on its own.
  // The PC-claim in xpc_user_pcs is now handled by ensureMyPcClaim()
  // with retry semantics, since it's the gate for every cross-PC RLS
  // policy (a missed claim = every send/receive fails with code 42501
  // "row violates row-level security policy").
  if (isLive()) {
    void ensureMyPcClaim(o.id);
    void (async () => {
      try {
        const dbTier = o.tier === "flight" ? "squadron" : o.tier;
        await supabase!.from("xpc_registry").upsert({
          id: o.id,
          squadron_name: o.displayName,
          tier: dbTier,
          base: o.base ?? null,
          wing: o.wing ?? null,
          device_name: deviceName ?? null,
          last_seen: entry.lastSeen,
        }, { onConflict: "id" });
      } catch {
        // Silent. Local mirror is authoritative until migrations land.
      }
    })();
  }
}

// ---------------------------------------------------------------------
// PC-claim management.
//
// Every write to xpc_messages / xpc_schedule_shares / xpc_pending is
// gated by the RLS policy `from_pc_id = ANY (xpc_my_pc_ids())`, where
// `xpc_my_pc_ids()` returns the array of pc_ids claimed by the current
// auth.uid in `xpc_user_pcs`. If the claim was never persisted (e.g.
// the heartbeat fired BEFORE supabase finished restoring the session,
// or the user signed in via signInWithPassword AFTER the first
// registerLocalPC tick), every cross-PC operation fails with the
// 42501 error users see as "Server error: row violates row-level
// security policy for table xpc_messages".
//
// `ensureMyPcClaim` is called from registerLocalPC (every 30s
// heartbeat), from useSendMessage / submit / decide / forward
// mutationFns (defensive, just before the write), and once from the
// auth flow right after signInWithPassword resolves. Each call retries
// the auth.getUser lookup for up to ~5s with backoff, then upserts the
// claim. A successful upsert is cached in-memory so subsequent calls
// for the same (uid,pcId) pair are no-ops.
// ---------------------------------------------------------------------

const claimedKeys = new Set<string>();

export async function ensureMyPcClaim(pcId: string | null | undefined): Promise<boolean> {
  if (!pcId || !isLive() || !supabase) return false;
  // Try up to 6 times spaced ~750ms apart (≈4.5s) for the supabase
  // session to settle after a fresh sign-in. Once we have a uid, the
  // upsert itself is idempotent and synchronous from the client's
  // point of view.
  let uid: string | undefined;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const { data } = await supabase.auth.getUser();
      uid = data?.user?.id;
      if (uid) break;
    } catch { /* network blip — retry */ }
    await new Promise(r => setTimeout(r, 750));
  }
  if (!uid) return false;
  const cacheKey = `${uid}::${pcId}`;
  if (claimedKeys.has(cacheKey)) return true;
  try {
    const { error } = await supabase.from("xpc_user_pcs").upsert(
      { user_id: uid, pc_id: pcId },
      { onConflict: "user_id,pc_id" },
    );
    if (error) {
      // Surface the failure to the console — silent failure here is
      // what kept the bug invisible in production for so long.
      console.warn("[xpc] PC claim upsert failed:", error.message, { pcId });
      return false;
    }
    claimedKeys.add(cacheKey);
    return true;
  } catch (e) {
    console.warn("[xpc] PC claim threw:", (e as Error)?.message);
    return false;
  }
}

export function useRegisteredPCs(): UseQueryResult<RegisteredPC[]> & { data: RegisteredPC[] } {
  const q = useQuery<RegisteredPC[]>({
    queryKey: ["xpc", "registry"],
    queryFn: async () => {
      const me = localPcId();
      const cutoff = Date.now() - ONLINE_WINDOW_MS;
      let rows: SquadronPC[] = [];
      if (isLive()) {
        rows = await liveOrLocal(
          async () => {
            // Defensive cap so the registry query stays fast even if the
            // table grows to 1000+ PCs (active or retired) over the life
            // of the deployment. Ordered by last_seen DESC so the most
            // recently active PCs always make the cut. The schema has a
            // matching index (xpc_registry_last_seen_idx) so this is a
            // cheap index scan, not a sequential scan.
            const { data, error } = await supabase!
              .from("xpc_registry")
              .select("*")
              .order("last_seen", { ascending: false })
              .limit(1000);
            if (error) throw error;
            return (data ?? []).map(rowToPc);
          },
          () => readRegistry(),
        );
      } else {
        rows = readRegistry();
      }
      return rows.map(r => ({
        ...r,
        online: new Date(r.lastSeen).getTime() >= cutoff,
        isSelf: r.id === me,
      }));
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
    retry: isLive() ? 1 : false,
  });
  return { ...q, data: q.data ?? [] } as UseQueryResult<RegisteredPC[]> & { data: RegisteredPC[] };
}

// ── 2. Cross-squadron pending sortie approvals ──────────────────────────
//
// When ops at the hosting squadron logs a sortie for a guest pilot whose
// home squadron is registered, the entry is queued here. The guest's
// squadron sees it in their Pending Approvals page. Accepting cascades
// into the calc engine on that PC; reject/edit/delete propagate the
// status back to the hosting squadron with an optional reason.
const PENDING_KEY = "rjaf.xpc.pending";

export type PendingStatus = "pending" | "accepted" | "rejected" | "edited" | "deleted";

export interface PendingSortie {
  id: string;
  // Squadron PC that hosted the flight (entered the sortie locally).
  hostingSquadronId: string;
  hostingSquadronName: string;
  // Squadron PC that owns the guest pilot — where the entry should be
  // approved and credited toward hours/currencies.
  homeSquadronId: string;
  homeSquadronName: string;
  // Snapshot of the guest pilot as the hosting ops officer typed them.
  guestPilotName: string;
  guestPilotMilitaryNumber?: string;
  // Which seat the guest occupied on the host's record. The home ops
  // officer fills `sortie[seat]Id` when accepting so the local calc
  // engine credits the right local pilot's totals/currencies/captain.
  guestSeat: "pilot" | "coPilot";
  // Snapshot of the sortie at submission time — enough for the home ops
  // officer to review without needing to round-trip back to the host.
  sortie: Omit<Sortie, "id">;
  submittedAt: string;
  submittedBy: string;
  status: PendingStatus;
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
  // When status === "edited", the home ops officer's revised payload.
  editedSortie?: Omit<Sortie, "id">;
}

function readPending(): PendingSortie[] {
  return readJSON<PendingSortie[]>(PENDING_KEY, []);
}
function writePending(rows: PendingSortie[]) {
  writeJSON(PENDING_KEY, rows);
}

function rowToPending(r: Record<string, unknown>): PendingSortie {
  return {
    id: String(r.id),
    hostingSquadronId: String(r.hosting_squadron_id),
    hostingSquadronName: String(r.hosting_squadron_name),
    homeSquadronId: String(r.home_squadron_id),
    homeSquadronName: String(r.home_squadron_name),
    guestPilotName: String(r.guest_pilot_name),
    guestPilotMilitaryNumber: r.guest_pilot_military_number ? String(r.guest_pilot_military_number) : undefined,
    guestSeat: r.guest_seat as "pilot" | "coPilot",
    sortie: (r.sortie ?? {}) as Omit<Sortie, "id">,
    submittedAt: String(r.submitted_at),
    submittedBy: String(r.submitted_by),
    status: r.status as PendingStatus,
    decidedAt: r.decided_at ? String(r.decided_at) : undefined,
    decidedBy: r.decided_by ? String(r.decided_by) : undefined,
    decisionReason: r.decision_reason ? String(r.decision_reason) : undefined,
    editedSortie: r.edited_sortie ? (r.edited_sortie as Omit<Sortie, "id">) : undefined,
  };
}

function pendingToRow(p: PendingSortie): Record<string, unknown> {
  return {
    id: p.id,
    hosting_squadron_id: p.hostingSquadronId,
    hosting_squadron_name: p.hostingSquadronName,
    home_squadron_id: p.homeSquadronId,
    home_squadron_name: p.homeSquadronName,
    guest_pilot_name: p.guestPilotName,
    guest_pilot_military_number: p.guestPilotMilitaryNumber ?? null,
    guest_seat: p.guestSeat,
    sortie: p.sortie,
    submitted_at: p.submittedAt,
    submitted_by: p.submittedBy,
    status: p.status,
    decided_at: p.decidedAt ?? null,
    decided_by: p.decidedBy ?? null,
    decision_reason: p.decisionReason ?? null,
    edited_sortie: p.editedSortie ?? null,
  };
}

export function usePendingApprovals(homeSquadronId: string | null | undefined): UseQueryResult<PendingSortie[]> & { data: PendingSortie[] } {
  const q = useQuery<PendingSortie[]>({
    queryKey: ["xpc", "pending", homeSquadronId ?? ""],
    queryFn: async () => {
      if (!homeSquadronId) return [];
      const localFallback = () => readPending()
        .filter(p => p.homeSquadronId === homeSquadronId && p.status === "pending")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      if (isLive()) {
        return await liveOrLocal(
          async () => {
            const { data, error } = await supabase!
              .from("xpc_pending")
              .select("*")
              .eq("home_squadron_id", homeSquadronId)
              .eq("status", "pending")
              .order("submitted_at", { ascending: false });
            if (error) throw error;
            return (data ?? []).map(rowToPending);
          },
          localFallback,
        );
      }
      return localFallback();
    },
    refetchInterval: 15_000,
    retry: isLive() ? 1 : false,
  });
  return { ...q, data: q.data ?? [] } as UseQueryResult<PendingSortie[]> & { data: PendingSortie[] };
}

// All pending entries across all squadrons — used by the mobile pilot
// view to surface "your ops officer must approve this" notifications.
export function useAllPending(): UseQueryResult<PendingSortie[]> & { data: PendingSortie[] } {
  const q = useQuery<PendingSortie[]>({
    queryKey: ["xpc", "pending", "all"],
    queryFn: async () => {
      const localFallback = () => readPending().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      if (isLive()) {
        return await liveOrLocal(
          async () => {
            const { data, error } = await supabase!
              .from("xpc_pending")
              .select("*")
              .order("submitted_at", { ascending: false });
            if (error) throw error;
            return (data ?? []).map(rowToPending);
          },
          localFallback,
        );
      }
      return localFallback();
    },
    refetchInterval: 15_000,
    retry: isLive() ? 1 : false,
  });
  return { ...q, data: q.data ?? [] } as UseQueryResult<PendingSortie[]> & { data: PendingSortie[] };
}

export function useSubmitPending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<PendingSortie, "id" | "submittedAt" | "status">) => {
      const row: PendingSortie = {
        ...input,
        id: genId("PND"),
        submittedAt: nowIso(),
        status: "pending",
      };
      if (isLive()) {
        // RLS gate on xpc_pending.insert is
        // (hosting_squadron_id = ANY (xpc_my_pc_ids())). The hosting
        // PC is the local PC submitting the cross-squadron sortie.
        await ensureMyPcClaim(row.hostingSquadronId);
        const { error } = await supabase!.from("xpc_pending").insert(pendingToRow(row));
        if (error) throw error;
      } else {
        const rows = readPending();
        rows.push(row);
        writePending(rows);
      }
      await recordAuditEvent({
        type: "xpc.pending.submitted",
        actor: input.submittedBy,
        detail: { id: row.id, host: input.hostingSquadronName, home: input.homeSquadronName, guest: input.guestPilotName },
      });
      return row;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["xpc", "pending"] });
    },
  });
}

// Sentinel stored in `guestPilotMilitaryNumber` when the home-squadron
// ops officer has actively reviewed a legacy entry and confirmed the
// hosting squadron cannot supply the visiting pilot's number. Treated as
// "explicitly unknown" so the entry stops appearing in the backfill
// queue but matchGuestPilot still refuses to do a name-only credit.
export const GUEST_MIL_UNKNOWN = "UNKNOWN";
export function isGuestMilUnknown(n: string | undefined | null): boolean {
  return (n ?? "").trim().toUpperCase() === GUEST_MIL_UNKNOWN;
}

// All guest entries (pending + accepted) for the home squadron whose
// guestPilotMilitaryNumber is genuinely missing — i.e. neither a real
// number nor the explicit-unknown sentinel. Drives the legacy backfill
// queue.
export function useGuestEntriesNeedingBackfill(homeSquadronId: string | null | undefined): UseQueryResult<PendingSortie[]> & { data: PendingSortie[] } {
  const q = useQuery<PendingSortie[]>({
    queryKey: ["xpc", "pending", "backfill", homeSquadronId ?? ""],
    queryFn: async () => {
      if (!homeSquadronId) return [];
      let rows: PendingSortie[] = [];
      if (isLive()) {
        const { data, error } = await supabase!
          .from("xpc_pending")
          .select("*")
          .eq("home_squadron_id", homeSquadronId)
          .in("status", ["pending", "accepted"])
          .order("submitted_at", { ascending: false });
        if (error) throw error;
        rows = (data ?? []).map(rowToPending);
      } else {
        rows = readPending()
          .filter(p => p.homeSquadronId === homeSquadronId && (p.status === "pending" || p.status === "accepted"))
          .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
      }
      return rows.filter(r => !(r.guestPilotMilitaryNumber ?? "").trim());
    },
    refetchInterval: 30_000,
    retry: isLive() ? 1 : false,
  });
  return { ...q, data: q.data ?? [] } as UseQueryResult<PendingSortie[]> & { data: PendingSortie[] };
}

// Stamp a military number (or the explicit-unknown sentinel) onto a
// historical guest entry. Records an audit event so the backfill is
// traceable alongside the original submission/decision events.
export function useBackfillGuestMilNumber() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      militaryNumber: string; // pass GUEST_MIL_UNKNOWN to mark unknown
      by: string;
    }) => {
      const value = input.militaryNumber.trim();
      if (!value) throw new Error("Military number required");
      let updated: PendingSortie | null = null;
      if (isLive()) {
        const { data, error } = await supabase!
          .from("xpc_pending")
          .update({ guest_pilot_military_number: value })
          .eq("id", input.id)
          .select()
          .single();
        if (error) throw error;
        updated = rowToPending(data);
      } else {
        const rows = readPending();
        const idx = rows.findIndex(r => r.id === input.id);
        if (idx < 0) throw new Error("Pending entry not found");
        rows[idx] = { ...rows[idx], guestPilotMilitaryNumber: value };
        writePending(rows);
        updated = rows[idx];
      }
      await recordAuditEvent({
        type: "xpc.pending.backfilled",
        actor: input.by,
        detail: {
          id: input.id,
          militaryNumber: value,
          markedUnknown: isGuestMilUnknown(value),
        },
      });
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["xpc", "pending"] });
    },
  });
}

export function useDecidePending() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      decision: "accepted" | "rejected" | "edited" | "deleted";
      decidedBy: string;
      reason?: string;
      editedSortie?: Omit<Sortie, "id">;
    }) => {
      const decidedAt = nowIso();
      let updated: PendingSortie | null = null;
      if (isLive()) {
        const { data, error } = await supabase!.from("xpc_pending").update({
          status: input.decision,
          decided_at: decidedAt,
          decided_by: input.decidedBy,
          decision_reason: input.reason ?? null,
          edited_sortie: input.editedSortie ?? null,
        }).eq("id", input.id).select().single();
        if (error) throw error;
        updated = rowToPending(data);
      } else {
        const rows = readPending();
        const idx = rows.findIndex(r => r.id === input.id);
        if (idx < 0) throw new Error("Pending entry not found");
        rows[idx] = {
          ...rows[idx],
          status: input.decision,
          decidedAt,
          decidedBy: input.decidedBy,
          decisionReason: input.reason,
          editedSortie: input.editedSortie,
        };
        writePending(rows);
        updated = rows[idx];
      }
      await recordAuditEvent({
        type: `xpc.pending.${input.decision}`,
        actor: input.decidedBy,
        detail: { id: input.id, reason: input.reason },
      });
      return updated;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["xpc", "pending"] });
    },
  });
}

// ── 3. Flight schedule sharing chain ────────────────────────────────────
//
// The chain is strictly Squadron → Wing → Base. A squadron PC cannot skip
// directly to base — the wing PC must approve / forward / hold first. Each
// PC's name is shown explicitly in the share dialog so the originator
// always knows where the sheet currently sits.
const SCHEDULE_SHARE_KEY = "rjaf.xpc.schedule";

// The tier stored on a schedule share row as it travels up (squadron →
// wing → base) or laterally (squadron ↔ flight). "flight" was added in
// v1.0.45 so a Flight Commander can compose and forward a sortie
// schedule to their parent Squadron Commander, and a Squadron Commander
// can publish a daily programme DOWN to one of their Flight Commanders
// for visibility / return-for-edit. The DB check constraint on
// xpc_schedule_shares.current_tier is widened to match.
export type ScheduleTier = "flight" | "squadron" | "wing" | "base";
export type ScheduleStatus = "draft" | "submitted" | "reviewed" | "approved" | "rejected" | "held" | "edited";

export interface ScheduleRow {
  id: string;
  ac: string;
  config: string;
  /** Free-form mission route, e.g. "OJAM-OJAQ-OJAM" or "Local". */
  route?: string;
  crew: string[];
  mission: string;
  takeoff: string;
  land: string;
  fuel: string;
}

// Full Flight Program snapshot — when an ops officer submits the daily
// flight schedule from the FlightProgram page, we ship the entire sheet
// (helo header + airbase/squadron + bands + briefing strip + A/C-needed
// strip + signatures) so the recipient sees the SAME paper, not a
// stripped-down summary table. Mirrors the Program interface in
// pages/FlightProgram.tsx; kept as a plain JSON shape so it travels in
// xpc_schedule_shares.program (jsonb).
export interface ScheduleProgramRow {
  dn: string;
  acType: string;
  toTime: string;
  pilot: string;
  coPilot: string;
  /** Legacy field — no longer rendered. Kept so old saved sheets parse. */
  crewMen?: string;
  msnDuty: string;
  duration: string;
  fuel: string;
  configuration: string;
  /** Free-form mission route. Optional so older saved sheets parse. */
  route?: string;
  remarks: string;
  atcTakeoff: string;
  atcLanding: string;
}
export interface ScheduleProgram {
  date: string;
  mode: "DAY" | "NIGHT" | "NVG" | "DAY_AND_NVG" | "DAY_AND_NIGHT";
  airbase: string;
  squadron: string;
  dayRows: ScheduleProgramRow[];
  nightRows: ScheduleProgramRow[];
  mainBriefer: string;
  briefTime: string;
  dayOps: string;
  nightOps: string;
  lecture: string;
  capte: string;
  nightBrief: string;
  reportingTime: string;
  acNeededDay: { main: string; stby: string };
  acNeededNight: { main: string; stby: string };
  fltCmdr: string;
  sqdnCmdr: string;
}

export interface ScheduleShare {
  id: string;
  date: string;
  originSquadronId: string;
  originSquadronName: string;
  // Where the sheet currently sits in the chain.
  currentTier: ScheduleTier;
  currentPcId: string | null;
  currentPcName: string | null;
  status: ScheduleStatus;
  rows: ScheduleRow[];
  // Snapshot of the rows as last seen by each tier — used to render diff
  // highlights when a downstream PC sends edits back upstream.
  baselineRows: ScheduleRow[];
  history: Array<{
    at: string;
    by: string;
    tier: ScheduleTier;
    action: ScheduleStatus;
    note?: string;
  }>;
  // Once edits round-trip, the originator sees them as a diff before
  // accepting. `editedRows` holds the proposed changes; once the
  // originator accepts they replace `rows` and `editedRows` clears.
  editedRows?: ScheduleRow[];
  editedBy?: string;
  // Full RJAF flight schedule sheet snapshot. Optional for backwards
  // compatibility with older shares that only carried the row list.
  program?: ScheduleProgram;
  editedProgram?: ScheduleProgram;
  // PCs (besides origin + current holder) that are allowed to view this
  // share once it has been approved — operator chose "visible to whole
  // chain so far". Populated as the sheet moves through tiers.
  chainPcIds?: string[];
  approvedAt?: string;
  approvedBy?: string;
}

function readShares(): ScheduleShare[] {
  return readJSON<ScheduleShare[]>(SCHEDULE_SHARE_KEY, []);
}
function writeShares(rows: ScheduleShare[]) {
  writeJSON(SCHEDULE_SHARE_KEY, rows);
}

function rowToShare(r: Record<string, unknown>): ScheduleShare {
  return {
    id: String(r.id),
    date: String(r.flight_date),
    originSquadronId: String(r.origin_squadron_id),
    originSquadronName: String(r.origin_squadron_name),
    currentTier: r.current_tier as ScheduleTier,
    currentPcId: r.current_pc_id ? String(r.current_pc_id) : null,
    currentPcName: r.current_pc_name ? String(r.current_pc_name) : null,
    status: r.status as ScheduleStatus,
    rows: (r.rows ?? []) as ScheduleRow[],
    baselineRows: (r.baseline_rows ?? []) as ScheduleRow[],
    history: (r.history ?? []) as ScheduleShare["history"],
    editedRows: r.edited_rows ? (r.edited_rows as ScheduleRow[]) : undefined,
    editedBy: r.edited_by ? String(r.edited_by) : undefined,
    program: r.program ? (r.program as ScheduleProgram) : undefined,
    editedProgram: r.edited_program ? (r.edited_program as ScheduleProgram) : undefined,
    chainPcIds: Array.isArray(r.chain_pc_ids) ? (r.chain_pc_ids as string[]) : undefined,
    approvedAt: r.approved_at ? String(r.approved_at) : undefined,
    approvedBy: r.approved_by ? String(r.approved_by) : undefined,
  };
}

function shareToRow(s: ScheduleShare): Record<string, unknown> {
  return {
    id: s.id,
    flight_date: s.date,
    origin_squadron_id: s.originSquadronId,
    origin_squadron_name: s.originSquadronName,
    current_tier: s.currentTier,
    current_pc_id: s.currentPcId,
    current_pc_name: s.currentPcName,
    status: s.status,
    rows: s.rows,
    baseline_rows: s.baselineRows,
    history: s.history,
    edited_rows: s.editedRows ?? null,
    edited_by: s.editedBy ?? null,
    program: s.program ?? null,
    edited_program: s.editedProgram ?? null,
    chain_pc_ids: s.chainPcIds ?? [],
    approved_at: s.approvedAt ?? null,
    approved_by: s.approvedBy ?? null,
    updated_at: nowIso(),
  };
}

export function useScheduleShares(forPcId: string | null): UseQueryResult<ScheduleShare[]> & { data: ScheduleShare[] } {
  const q = useQuery<ScheduleShare[]>({
    queryKey: ["xpc", "schedule", forPcId ?? ""],
    queryFn: async () => {
      const localFallback = () => {
        const all = readShares();
        if (!forPcId) return all;
        return all
          .filter(s =>
            s.currentPcId === forPcId
            || s.originSquadronId === forPcId
            || (s.status === "approved" && (s.chainPcIds ?? []).includes(forPcId))
          )
          .sort((a, b) => b.date.localeCompare(a.date));
      };
      if (isLive()) {
        return await liveOrLocal(
          async () => {
            let qry = supabase!.from("xpc_schedule_shares").select("*").order("flight_date", { ascending: false });
            if (forPcId) {
              qry = qry.or(
                `current_pc_id.eq.${forPcId},origin_squadron_id.eq.${forPcId},and(status.eq.approved,chain_pc_ids.cs.{${forPcId}})`,
              );
            }
            const { data, error } = await qry;
            if (error) throw error;
            return (data ?? []).map(rowToShare);
          },
          localFallback,
        );
      }
      return localFallback();
    },
    refetchInterval: 15_000,
    retry: isLive() ? 1 : false,
  });
  return { ...q, data: q.data ?? [] } as UseQueryResult<ScheduleShare[]> & { data: ScheduleShare[] };
}

export function useSubmitSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      date: string;
      originSquadronId: string;
      originSquadronName: string;
      rows: ScheduleRow[];
      // Wing PC that should review next.
      targetPcId: string;
      targetPcName: string;
      // Tier of the recipient — defaults to wing for legacy callers but
      // the FlightProgram Submit dialog passes the actual tier of the
      // chosen PC (squadron / wing / base) so the recipient sees the
      // share land in their inbox regardless of the chain step.
      targetTier?: ScheduleTier;
      submittedBy: string;
      // Optional full sheet snapshot — when present the recipient
      // renders the same RJAF flight schedule paper, not a stripped
      // table. The legacy `rows` payload is still derived for the
      // existing diff machinery.
      program?: ScheduleProgram;
    }) => {
      const share: ScheduleShare = {
        id: genId("SCH"),
        date: input.date,
        originSquadronId: input.originSquadronId,
        originSquadronName: input.originSquadronName,
        currentTier: input.targetTier ?? "wing",
        currentPcId: input.targetPcId,
        currentPcName: input.targetPcName,
        status: "submitted",
        rows: input.rows,
        baselineRows: input.rows,
        history: [{ at: nowIso(), by: input.submittedBy, tier: "squadron", action: "submitted", note: `→ ${input.targetPcName}` }],
        program: input.program,
        chainPcIds: [input.originSquadronId, input.targetPcId],
      };
      if (isLive()) {
        // RLS gate on xpc_schedule_shares.insert is
        // (origin_squadron_id = ANY (xpc_my_pc_ids())). Defensive
        // claim, same reasoning as useSendMessage.
        await ensureMyPcClaim(share.originSquadronId);
        const { error } = await supabase!.from("xpc_schedule_shares").insert(shareToRow(share));
        if (error) throw error;
      } else {
        const all = readShares();
        all.push(share);
        writeShares(all);
      }
      await recordAuditEvent({
        type: "xpc.schedule.submitted",
        actor: input.submittedBy,
        detail: { id: share.id, target: input.targetPcName },
      });
      return share;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xpc", "schedule"] }),
  });
}

export function useDecideSchedule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: {
      id: string;
      action: "approve" | "reject" | "hold" | "edit" | "forward";
      by: string;
      tier: ScheduleTier;
      note?: string;
      // For action=forward: the next PC up the chain (wing → base).
      forwardPcId?: string;
      forwardPcName?: string;
      // For action=edit: revised rows; defaults to sending back to the originator.
      editedRows?: ScheduleRow[];
      // For action=edit on a full-sheet share: the revised RJAF program
      // snapshot. Mirrors editedRows but carries the whole paper so the
      // originator's diff dialog can show what changed in context.
      editedProgram?: ScheduleProgram;
    }) => {
      // Load current state (Supabase or local).
      let cur: ScheduleShare;
      if (isLive()) {
        const { data, error } = await supabase!.from("xpc_schedule_shares").select("*").eq("id", input.id).single();
        if (error) throw error;
        cur = rowToShare(data);
      } else {
        const all = readShares();
        const found = all.find(s => s.id === input.id);
        if (!found) throw new Error("Schedule not found");
        cur = { ...found };
      }

      const push = (action: ScheduleStatus, note?: string) =>
        cur.history.push({ at: nowIso(), by: input.by, tier: input.tier, action, note });

      if (input.action === "approve") {
        cur.status = "approved";
        cur.approvedAt = nowIso();
        cur.approvedBy = input.by;
        // Operator chose: once approved, the sheet becomes visible to
        // every PC that has touched the chain so far. The chainPcIds
        // already accumulates everyone (origin + each forward target);
        // we just guarantee both endpoints are present.
        const ids = new Set<string>(cur.chainPcIds ?? []);
        ids.add(cur.originSquadronId);
        if (cur.currentPcId) ids.add(cur.currentPcId);
        cur.chainPcIds = Array.from(ids);
        push("approved", input.note);
      } else if (input.action === "reject") {
        cur.status = "rejected";
        cur.currentPcId = cur.originSquadronId;
        cur.currentPcName = cur.originSquadronName;
        cur.currentTier = "squadron";
        push("rejected", input.note);
      } else if (input.action === "hold") {
        cur.status = "held";
        push("held", input.note);
      } else if (input.action === "edit") {
        cur.status = "edited";
        cur.editedRows = input.editedRows ?? cur.rows;
        cur.editedProgram = input.editedProgram ?? cur.program;
        cur.editedBy = input.by;
        // Edits ALWAYS go back to the originating squadron — the operator
        // wants to re-approve the change before it propagates further.
        cur.currentPcId = cur.originSquadronId;
        cur.currentPcName = cur.originSquadronName;
        cur.currentTier = "squadron";
        push("edited", input.note ?? "edits returned to originator");
      } else if (input.action === "forward") {
        // Upward chain: Squadron → Wing → Base (no skipping).
        // Lateral chain: Flight ↔ Squadron (either end may forward back
        // to the other). Base is terminal.
        if (cur.currentTier === "wing") {
          cur.currentTier = "base";
        } else if (cur.currentTier === "squadron") {
          cur.currentTier = "wing";
        } else if (cur.currentTier === "flight") {
          // A flight-tier share forwards back to its originating
          // squadron for action.
          cur.currentTier = "squadron";
        } else {
          throw new Error("Already at base — nowhere to forward.");
        }
        cur.currentPcId = input.forwardPcId ?? null;
        cur.currentPcName = input.forwardPcName ?? null;
        cur.status = "reviewed";
        // Track every PC that has handled the share so the approve-time
        // visibility rule can include them.
        if (input.forwardPcId) {
          const ids = new Set<string>(cur.chainPcIds ?? []);
          ids.add(input.forwardPcId);
          cur.chainPcIds = Array.from(ids);
        }
        push("reviewed", `→ ${input.forwardPcName ?? ""}`);
      }

      if (isLive()) {
        const { error } = await supabase!.from("xpc_schedule_shares")
          .update(shareToRow(cur)).eq("id", cur.id);
        if (error) throw error;
      } else {
        const all = readShares();
        const idx = all.findIndex(s => s.id === cur.id);
        if (idx >= 0) all[idx] = cur;
        writeShares(all);
      }
      await recordAuditEvent({
        type: `xpc.schedule.${input.action}`,
        actor: input.by,
        detail: { id: cur.id, tier: input.tier },
      });
      return cur;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xpc", "schedule"] }),
  });
}

// Originator-side accept of the diff: replaces `rows` with `editedRows`.
export function useAcceptScheduleEdit() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string; by: string }) => {
      let cur: ScheduleShare;
      if (isLive()) {
        const { data, error } = await supabase!.from("xpc_schedule_shares").select("*").eq("id", input.id).single();
        if (error) throw error;
        cur = rowToShare(data);
      } else {
        const all = readShares();
        const found = all.find(s => s.id === input.id);
        if (!found) throw new Error("Schedule not found");
        cur = { ...found };
      }
      if (!cur.editedRows && !cur.editedProgram) return cur;
      if (cur.editedRows) {
        cur.rows = cur.editedRows;
        cur.baselineRows = cur.editedRows;
      }
      if (cur.editedProgram) {
        cur.program = cur.editedProgram;
      }
      cur.editedProgram = undefined;
      cur.editedRows = undefined;
      cur.status = "approved";
      cur.history.push({ at: nowIso(), by: input.by, tier: "squadron", action: "approved", note: "originator accepted edits" });
      if (isLive()) {
        const { error } = await supabase!.from("xpc_schedule_shares")
          .update(shareToRow(cur)).eq("id", cur.id);
        if (error) throw error;
      } else {
        const all = readShares();
        const idx = all.findIndex(s => s.id === cur.id);
        if (idx >= 0) all[idx] = cur;
        writeShares(all);
      }
      await recordAuditEvent({ type: "xpc.schedule.edits.accepted", actor: input.by, detail: { id: cur.id } });
      return cur;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xpc", "schedule"] }),
  });
}

// Diff helper used by the schedule review UI. Returns per-row classification
// against a baseline so the on-screen view can highlight added / changed /
// removed rows. The print stylesheet strips these classes so paper output
// is always clean.
export type DiffKind = "added" | "removed" | "changed" | "same";
export interface RowDiff {
  kind: DiffKind;
  next?: ScheduleRow;
  prev?: ScheduleRow;
  changedFields?: Array<keyof ScheduleRow>;
}
export function diffSchedule(prev: ScheduleRow[], next: ScheduleRow[]): RowDiff[] {
  const out: RowDiff[] = [];
  const prevById = new Map(prev.map(r => [r.id, r]));
  const nextById = new Map(next.map(r => [r.id, r]));
  for (const n of next) {
    const p = prevById.get(n.id);
    if (!p) { out.push({ kind: "added", next: n }); continue; }
    const changed: Array<keyof ScheduleRow> = [];
    (Object.keys(n) as Array<keyof ScheduleRow>).forEach(k => {
      const a = JSON.stringify(p[k]); const b = JSON.stringify(n[k]);
      if (a !== b) changed.push(k);
    });
    out.push({ kind: changed.length ? "changed" : "same", next: n, prev: p, changedFields: changed });
  }
  for (const p of prev) {
    if (!nextById.has(p.id)) out.push({ kind: "removed", prev: p });
  }
  return out;
}

// ── 4. Private messages (Sqn / Wing / Base only) ────────────────────────
//
// Bidirectional thread model. Flight Cmdr is excluded; Ops Pilot is
// excluded entirely (no UI on those PCs at all). Reply or mark-read moves
// the message into the recipient's history. Auto-delete is configurable
// with a hard ceiling of 50 days. Text only — no attachments.
const MESSAGES_KEY = "rjaf.xpc.messages";
const MESSAGE_RETENTION_KEY = "rjaf.xpc.messages.retention";
export const MESSAGE_RETENTION_MAX_DAYS = 50;

export type MessagePriority = "normal" | "medium" | "urgent";
export type MessageTier = "flight" | "squadron" | "wing" | "base";

export interface PrivateMessage {
  id: string;
  threadId: string;            // groups replies into a thread
  fromPcId: string;
  fromPcName: string;
  fromTier: MessageTier;
  fromUser: string;
  toPcId: string;
  toPcName: string;
  toTier: MessageTier;
  subject: string;
  body: string;
  priority: MessagePriority;
  sentAt: string;
  readAt?: string;
  // Once replied-to or explicitly marked read, the message moves to the
  // recipient's history view instead of their unread inbox.
  inHistory: boolean;
}

function readMessages(): PrivateMessage[] {
  return readJSON<PrivateMessage[]>(MESSAGES_KEY, []);
}
function writeMessages(rows: PrivateMessage[]) {
  writeJSON(MESSAGES_KEY, rows);
}

function rowToMessage(r: Record<string, unknown>): PrivateMessage {
  // Recover the flight tier from the id prefix — the DB CHECK constraint
  // doesn't allow 'flight' as a tier value yet, so flight PCs persist
  // their messages with tier='squadron' and we fix that up here.
  const fromPcId = String(r.from_pc_id);
  const toPcId   = String(r.to_pc_id);
  const fromTier: MessageTier = fromPcId.startsWith("FLIGHT:") ? "flight" : (r.from_tier as MessageTier);
  const toTier:   MessageTier = toPcId.startsWith("FLIGHT:")   ? "flight" : (r.to_tier as MessageTier);
  return {
    id: String(r.id),
    threadId: String(r.thread_id),
    fromPcId,
    fromPcName: String(r.from_pc_name),
    fromTier,
    fromUser: String(r.from_user),
    toPcId,
    toPcName: String(r.to_pc_name),
    toTier,
    subject: String(r.subject),
    body: String(r.body),
    priority: r.priority as MessagePriority,
    sentAt: String(r.sent_at),
    readAt: r.read_at ? String(r.read_at) : undefined,
    inHistory: Boolean(r.in_history),
  };
}

function messageToRow(m: PrivateMessage): Record<string, unknown> {
  // The xpc_messages tier CHECK constraint pre-dates the flight tier;
  // downgrade to 'squadron' on the wire and let rowToMessage recover
  // the true tier from the FLIGHT: id prefix on read.
  const fromTierDb = m.fromTier === "flight" ? "squadron" : m.fromTier;
  const toTierDb   = m.toTier   === "flight" ? "squadron" : m.toTier;
  return {
    id: m.id,
    thread_id: m.threadId,
    from_pc_id: m.fromPcId,
    from_pc_name: m.fromPcName,
    from_tier: fromTierDb,
    from_user: m.fromUser,
    to_pc_id: m.toPcId,
    to_pc_name: m.toPcName,
    to_tier: toTierDb,
    subject: m.subject,
    body: m.body,
    priority: m.priority,
    sent_at: m.sentAt,
    read_at: m.readAt ?? null,
    in_history: m.inHistory,
  };
}

export function getMessageRetentionDays(): number {
  const raw = localStorage.getItem(MESSAGE_RETENTION_KEY);
  const n = raw ? Number(raw) : 30;
  if (!Number.isFinite(n) || n <= 0) return 30;
  return Math.min(MESSAGE_RETENTION_MAX_DAYS, Math.floor(n));
}
export function setMessageRetentionDays(days: number) {
  const clamped = Math.min(MESSAGE_RETENTION_MAX_DAYS, Math.max(1, Math.floor(days)));
  localStorage.setItem(MESSAGE_RETENTION_KEY, String(clamped));
}

// Auto-purge messages older than the configured retention window. Called
// implicitly on every read; safe to call repeatedly.
//
// At 100+ PCs polling messages every ~10s, an unconditional remote DELETE
// on every fetch fires ~10 deletes/sec against `xpc_messages` even when
// nothing has expired. We throttle the remote delete to once per hour per
// browser session so the purge stays effectively maintenance-only at
// scale; the local localStorage purge still runs on every call so the
// PC's own UI doesn't keep stale entries around.
let lastRemotePurgeAt = 0;
const REMOTE_PURGE_INTERVAL_MS = 60 * 60 * 1000;
export function purgeExpiredMessages(): void {
  try {
    const rows = readMessages();
    const kept = purgeExpiredLocal(rows);
    if (kept.length !== rows.length) writeMessages(kept);
  } catch { /* localStorage may be unavailable in SSR/tests */ }
  if (isLive()) {
    const now = Date.now();
    if (now - lastRemotePurgeAt < REMOTE_PURGE_INTERVAL_MS) return;
    lastRemotePurgeAt = now;
    const days = getMessageRetentionDays();
    const cutoff = new Date(now - days * 86_400_000).toISOString();
    void supabase!.from("xpc_messages").delete().lt("sent_at", cutoff);
  }
}

function purgeExpiredLocal(rows: PrivateMessage[]): PrivateMessage[] {
  const days = getMessageRetentionDays();
  const cutoff = Date.now() - days * 86_400_000;
  return rows.filter(m => new Date(m.sentAt).getTime() >= cutoff);
}

export function useMessages(forPcId: string | null): {
  inbox: PrivateMessage[]; sent: PrivateMessage[]; history: PrivateMessage[];
} & UseQueryResult<PrivateMessage[]> {
  // v1.1.44: same logical-seat matching the Schedule Chain inbox uses
  // (see ScheduleChain.tsx v1.1.40). Tier-prefixed PC ids carry a
  // "#<deviceSuffix>" tail that regenerates whenever localStorage is
  // cleared — so messages addressed to the OLD suffix become invisible
  // to the same logical seat after a reimage. Match on "<TIER>:<base>"
  // ignoring the suffix so the inbox catches its own mail. Also mirror
  // Ops PC "<sqn>" with Sqn Cmdr "SQDNCMD:<sqn>" so private mail to
  // either lands on both inboxes.
  const logicalSeat = (() => {
    if (!forPcId) return null;
    const hashIdx = forPcId.indexOf("#");
    if (hashIdx < 0) return null;
    return forPcId.slice(0, hashIdx); // e.g. "FLIGHT:NO.8"
  })();
  const peerSquadronId = (() => {
    if (!forPcId) return null;
    if (forPcId.startsWith("SQDNCMD:")) return forPcId.slice("SQDNCMD:".length);
    if (!forPcId.includes(":")) return `SQDNCMD:${forPcId}`;
    return null;
  })();
  const matchesMe = (id: string | null | undefined): boolean => {
    if (!id || !forPcId) return false;
    if (id === forPcId) return true;
    if (peerSquadronId !== null && id === peerSquadronId) return true;
    if (logicalSeat !== null) {
      const hashIdx = id.indexOf("#");
      const otherSeat = hashIdx < 0 ? id : id.slice(0, hashIdx);
      if (otherSeat === logicalSeat) return true;
    }
    return false;
  };
  const q = useQuery<PrivateMessage[]>({
    queryKey: ["xpc", "messages", forPcId ?? ""],
    queryFn: async () => {
      if (!forPcId) return [];
      const localFallback = () => {
        const purged = purgeExpiredLocal(readMessages());
        writeMessages(purged);
        return purged
          .filter(m => matchesMe(m.fromPcId) || matchesMe(m.toPcId))
          .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
      };
      if (isLive()) {
        return await liveOrLocal(
          async () => {
            const days = getMessageRetentionDays();
            const cutoff = new Date(Date.now() - days * 86_400_000).toISOString();
            // Build an OR clause that covers strict id, peer-squadron
            // mirror, and tier-prefix LIKE patterns. Supabase's PostgREST
            // OR syntax requires comma-separated filters with no spaces.
            const orParts: string[] = [
              `from_pc_id.eq.${forPcId}`,
              `to_pc_id.eq.${forPcId}`,
            ];
            if (peerSquadronId !== null) {
              orParts.push(`from_pc_id.eq.${peerSquadronId}`, `to_pc_id.eq.${peerSquadronId}`);
            }
            if (logicalSeat !== null) {
              orParts.push(
                `from_pc_id.like.${logicalSeat}#*`,
                `to_pc_id.like.${logicalSeat}#*`,
                `from_pc_id.eq.${logicalSeat}`,
                `to_pc_id.eq.${logicalSeat}`,
              );
            }
            const { data, error } = await supabase!
              .from("xpc_messages")
              .select("*")
              .or(orParts.join(","))
              .gte("sent_at", cutoff)
              .order("sent_at", { ascending: false });
            if (error) throw error;
            return (data ?? []).map(rowToMessage);
          },
          localFallback,
        );
      }
      return localFallback();
    },
    refetchInterval: 15_000,
    retry: isLive() ? 1 : false,
  });
  const all = q.data ?? [];
  return {
    ...q,
    inbox: all.filter(m => matchesMe(m.toPcId) && !m.inHistory),
    sent: all.filter(m => matchesMe(m.fromPcId)),
    history: all.filter(m => matchesMe(m.toPcId) && m.inHistory),
  } as ReturnType<typeof useMessages>;
}

export function useSendMessage() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: Omit<PrivateMessage, "id" | "sentAt" | "inHistory" | "threadId"> & { threadId?: string }) => {
      const msg: PrivateMessage = {
        ...input,
        id: genId("MSG"),
        threadId: input.threadId ?? genId("THR"),
        sentAt: nowIso(),
        inHistory: false,
      };
      if (isLive()) {
        // RLS gate: every xpc_messages.insert requires from_pc_id to
        // appear in xpc_my_pc_ids() for the signed-in user. Without
        // this defensive claim, a heartbeat that hasn't yet completed
        // its first upsert will yield code 42501 ("row violates
        // row-level security policy for table xpc_messages") on the
        // very first send.
        await ensureMyPcClaim(msg.fromPcId);
        const { error } = await supabase!.from("xpc_messages").insert(messageToRow(msg));
        if (error) throw error;
      } else {
        const all = readMessages();
        all.push(msg);
        writeMessages(all);
      }
      await recordAuditEvent({
        type: "xpc.message.sent",
        actor: input.fromUser,
        detail: { id: msg.id, to: input.toPcName, priority: input.priority },
      });
      return msg;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xpc", "messages"] }),
  });
}

export function useMarkMessageRead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { id: string }) => {
      const readAt = nowIso();
      if (isLive()) {
        const { data, error } = await supabase!.from("xpc_messages")
          .update({ read_at: readAt, in_history: true })
          .eq("id", input.id).select().single();
        if (error) throw error;
        return data ? rowToMessage(data) : null;
      }
      const all = readMessages();
      const idx = all.findIndex(m => m.id === input.id);
      if (idx < 0) return null;
      all[idx] = { ...all[idx], readAt, inHistory: true };
      writeMessages(all);
      return all[idx];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xpc", "messages"] }),
  });
}

// ──────────────────────────────────────────────────────────────────────
// Squadron daily snapshot (xpc_squadron_snapshot) — v1.1.26
// ──────────────────────────────────────────────────────────────────────
// Each squadron's canonical Ops PC publishes a tiny daily picture of
// its roster + unavailable list to xpc_squadron_snapshot. Wing / Base /
// HQ commanders subscribe per-squadron and render that picture inside
// the squadron drill-down so they can see who's grounded today, who's
// on leave, and the headline roster — without phoning the squadron.
//
// RLS: only the canonical Ops PC for a squadron may UPSERT its own row
// (ops_pc_id = squadron_id AND ops_pc_id ∈ xpc_my_pc_ids()). Any
// authenticated user may SELECT.
export interface SquadronSnapshotPilot {
  id: string;
  callSign: string;
  name: string;
  flightName?: string | null;
  rank?: string | null;
  expDay?: string | null;
  expNight?: string | null;
  expNvg?: string | null;
  expIrt?: string | null;
  expMedical?: string | null;
}
export interface SquadronSnapshotUnavail {
  id: string;
  pilotId: string;
  pilotName: string;
  from: string;
  to: string;
  reason: string;
}
export interface SquadronSnapshotPayload {
  roster: SquadronSnapshotPilot[];
  unavailable: SquadronSnapshotUnavail[];
  counts: { pilots: number; unavailToday: number; expired: number; expiringSoon: number };
}
export interface SquadronSnapshotRow {
  squadronId: string;
  opsPcId: string;
  snapshotAt: string;
  payload: SquadronSnapshotPayload;
}

export async function publishSquadronSnapshot(
  squadronId: string,
  payload: SquadronSnapshotPayload,
): Promise<void> {
  if (!isLive() || !supabase || !squadronId) return;
  // Only the canonical Ops PC for this squadron is allowed to publish.
  const myId = getLocalPcId();
  if (myId !== squadronId) return;
  const row = {
    squadron_id: squadronId,
    ops_pc_id: squadronId,
    snapshot_at: nowIso(),
    payload: payload as unknown as Record<string, unknown>,
  };
  const { error } = await supabase
    .from("xpc_squadron_snapshot")
    .upsert(row, { onConflict: "squadron_id" });
  if (error) {
    // Silent — re-runs on the next tick.
    void recordAuditEvent({
      type: "xpc.squadron.snapshot.publish.error",
      actor: squadronId,
      detail: { message: error.message },
    });
  }
}

export function useSquadronSnapshot(
  squadronId: string | null | undefined,
): UseQueryResult<SquadronSnapshotRow | null> & { data: SquadronSnapshotRow | null } {
  const enabled = isLive() && !!squadronId;
  const q = useQuery<SquadronSnapshotRow | null>({
    queryKey: ["xpc", "squadron-snapshot", squadronId ?? "_"],
    queryFn: async () => {
      if (!isLive() || !supabase || !squadronId) return null;
      const { data, error } = await supabase
        .from("xpc_squadron_snapshot")
        .select("squadron_id, ops_pc_id, snapshot_at, payload")
        .eq("squadron_id", squadronId)
        .maybeSingle();
      if (error || !data) return null;
      return {
        squadronId: String(data.squadron_id),
        opsPcId: String(data.ops_pc_id),
        snapshotAt: String(data.snapshot_at),
        payload: (data.payload ?? { roster: [], unavailable: [], counts: { pilots: 0, unavailToday: 0, expired: 0, expiringSoon: 0 } }) as SquadronSnapshotPayload,
      };
    },
    enabled,
    staleTime: 30_000,
    refetchInterval: enabled ? 60_000 : false,
    retry: isLive() ? 1 : false,
  });
  return { ...q, data: q.data ?? null } as UseQueryResult<SquadronSnapshotRow | null> & { data: SquadronSnapshotRow | null };
}

// Role helper: which roles are allowed to use the messages UI at all.
// Commanders only — Squadron / Wing / Base. The squadron Ops Pilot
// (role="ops"), Ops Pilot deputies (role="deputy") and Flight Cmdrs
// are explicitly excluded: messages are a commander-tier channel, not
// an ops-floor tool.
export function canUseMessages(role: string | undefined, scope: string | undefined): boolean {
  if (role === "super_admin") return true;
  if (role === "commander") {
    return scope === "flight" || scope === "squadron" || scope === "wing" || scope === "base";
  }
  return false;
}

// Role helper: which roles see the schedule chain UI.
//
// v1.1.28 widening: the Ops Pilot is now a first-class participant
// in the schedule chain so the operations desk can both publish the
// daily flight programme to the linked Flight Commanders and to the
// Squadron Commander, AND receive returned/edited programmes back from
// either side. The Ops PC sits at "squadron" tier in the registry but
// has its own canonical id (= squadron code), so shares route to it
// exactly like to any other PC.
//
// The schedule sharing channels are:
//   Ops Pilot   ⇄ Flight Cmdr     (peer share within the squadron)
//   Ops Pilot   ⇄ Squadron Cmdr   (peer share within the squadron)
//   Flight Cmdr ─▶ Squadron Cmdr  (approve / reject)
//   Squadron Cmdr ─▶ Wing Cmdr    (approve / reject; on approve the
//                                  share auto-forwards down to Base)
//   Base Cmdr   (read-only, terminal recipient)
// HQ tier never participates.
export function canUseScheduleChain(role: string | undefined, scope: string | undefined): boolean {
  if (role === "super_admin") return true;
  if (role === "ops") return true; // Ops Pilot's PC — squadron-tier peer
  if (role === "commander") {
    return scope === "flight" || scope === "squadron"
        || scope === "wing"   || scope === "base";
  }
  return false;
}
