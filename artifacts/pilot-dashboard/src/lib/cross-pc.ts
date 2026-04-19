// Cross-PC workflow layer.
//
// This module backs the four ecosystem features that span more than one
// squadron PC: the squadron-PC registry, cross-squadron pending sortie
// approvals, the flight-schedule sharing chain (Squadron ↔ Wing ↔ Base),
// and Sqn/Wing/Base private messages.
//
// Storage is intentionally simple: a single localStorage namespace per
// channel ("rjaf.xpc.*"), polled by React Query so all open tabs / PCs that
// share the browser session stay in sync. When a real Supabase backend is
// wired up this file is the only one that needs to learn how to talk to it
// — every page consumes these hooks and treats them as the authoritative
// cross-PC source.
//
// The localStorage simulation is enough for the in-browser preview and
// the standalone Electron build that ships before the central server is
// stood up: every PC sees its own slice and the registry/sync hooks paper
// over the absence of a real link by treating known PCs as "registered but
// offline" until they sign back in.

import { useMutation, useQuery, useQueryClient, type UseQueryResult } from "@tanstack/react-query";
import type { Sortie } from "./mock";
import { recordAuditEvent } from "./supabase";

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
export type PcTier = "squadron" | "wing" | "base" | "hq";

export interface SquadronPC {
  id: string;             // canonical ecosystem id (squadron name, or
                          // commander-scope id e.g. "WING:NWAC")
  squadronName: string;   // human-readable label, e.g. "8 SQN"
  tier: PcTier;
  base?: string;          // e.g. "Marka"
  wing?: string;          // e.g. "RWAC"
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

export interface RegisterPcOpts {
  id: string;
  displayName: string;
  tier: PcTier;
  base?: string;
  wing?: string;
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
  const rows = readRegistry();
  const idx = rows.findIndex(r => r.id === o.id);
  const entry: SquadronPC = {
    id: o.id,
    squadronName: o.displayName,
    tier: o.tier,
    base: o.base,
    wing: o.wing,
    lastSeen: nowIso(),
  };
  if (idx >= 0) rows[idx] = { ...rows[idx], ...entry }; else rows.push(entry);
  writeRegistry(rows);
}

export function useRegisteredPCs(): UseQueryResult<RegisteredPC[]> & { data: RegisteredPC[] } {
  const q = useQuery<RegisteredPC[]>({
    queryKey: ["xpc", "registry"],
    queryFn: () => {
      const rows = readRegistry();
      const me = localPcId();
      const cutoff = Date.now() - ONLINE_WINDOW_MS;
      return rows.map(r => ({
        ...r,
        online: new Date(r.lastSeen).getTime() >= cutoff,
        isSelf: r.id === me,
      }));
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
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

export function usePendingApprovals(homeSquadronId: string | null | undefined): UseQueryResult<PendingSortie[]> & { data: PendingSortie[] } {
  const q = useQuery<PendingSortie[]>({
    queryKey: ["xpc", "pending", homeSquadronId ?? ""],
    queryFn: () => {
      if (!homeSquadronId) return [];
      return readPending()
        .filter(p => p.homeSquadronId === homeSquadronId && p.status === "pending")
        .sort((a, b) => b.submittedAt.localeCompare(a.submittedAt));
    },
    refetchInterval: 15_000,
  });
  return { ...q, data: q.data ?? [] } as UseQueryResult<PendingSortie[]> & { data: PendingSortie[] };
}

// All pending entries across all squadrons — used by the mobile pilot
// view to surface "your ops officer must approve this" notifications.
export function useAllPending(): UseQueryResult<PendingSortie[]> & { data: PendingSortie[] } {
  const q = useQuery<PendingSortie[]>({
    queryKey: ["xpc", "pending", "all"],
    queryFn: () => readPending().sort((a, b) => b.submittedAt.localeCompare(a.submittedAt)),
    refetchInterval: 15_000,
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
      const rows = readPending();
      rows.push(row);
      writePending(rows);
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
      const rows = readPending();
      const idx = rows.findIndex(r => r.id === input.id);
      if (idx < 0) throw new Error("Pending entry not found");
      rows[idx] = {
        ...rows[idx],
        status: input.decision,
        decidedAt: nowIso(),
        decidedBy: input.decidedBy,
        decisionReason: input.reason,
        editedSortie: input.editedSortie,
      };
      writePending(rows);
      await recordAuditEvent({
        type: `xpc.pending.${input.decision}`,
        actor: input.decidedBy,
        detail: { id: input.id, reason: input.reason },
      });
      return rows[idx];
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

export type ScheduleTier = "squadron" | "wing" | "base";
export type ScheduleStatus = "draft" | "submitted" | "reviewed" | "approved" | "rejected" | "held" | "edited";

export interface ScheduleRow {
  id: string;
  ac: string;
  config: string;
  crew: string[];
  mission: string;
  takeoff: string;
  land: string;
  fuel: string;
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
}

function readShares(): ScheduleShare[] {
  return readJSON<ScheduleShare[]>(SCHEDULE_SHARE_KEY, []);
}
function writeShares(rows: ScheduleShare[]) {
  writeJSON(SCHEDULE_SHARE_KEY, rows);
}

export function useScheduleShares(forPcId: string | null): UseQueryResult<ScheduleShare[]> & { data: ScheduleShare[] } {
  const q = useQuery<ScheduleShare[]>({
    queryKey: ["xpc", "schedule", forPcId ?? ""],
    queryFn: () => {
      const all = readShares();
      if (!forPcId) return all;
      return all
        .filter(s => s.currentPcId === forPcId || s.originSquadronId === forPcId)
        .sort((a, b) => b.date.localeCompare(a.date));
    },
    refetchInterval: 15_000,
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
      submittedBy: string;
    }) => {
      const share: ScheduleShare = {
        id: genId("SCH"),
        date: input.date,
        originSquadronId: input.originSquadronId,
        originSquadronName: input.originSquadronName,
        currentTier: "wing",
        currentPcId: input.targetPcId,
        currentPcName: input.targetPcName,
        status: "submitted",
        rows: input.rows,
        baselineRows: input.rows,
        history: [{ at: nowIso(), by: input.submittedBy, tier: "squadron", action: "submitted", note: `→ ${input.targetPcName}` }],
      };
      const all = readShares();
      all.push(share);
      writeShares(all);
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
    }) => {
      const all = readShares();
      const idx = all.findIndex(s => s.id === input.id);
      if (idx < 0) throw new Error("Schedule not found");
      const cur = { ...all[idx] };
      const push = (action: ScheduleStatus, note?: string) =>
        cur.history.push({ at: nowIso(), by: input.by, tier: input.tier, action, note });

      if (input.action === "approve") {
        cur.status = "approved";
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
        cur.editedBy = input.by;
        // Edits default to resending to the originator for confirmation.
        cur.currentPcId = cur.originSquadronId;
        cur.currentPcName = cur.originSquadronName;
        cur.currentTier = "squadron";
        push("edited", input.note ?? "edits returned to originator");
      } else if (input.action === "forward") {
        // Squadron → Wing → Base, never skip a tier.
        if (cur.currentTier === "wing") {
          cur.currentTier = "base";
        } else if (cur.currentTier === "squadron") {
          cur.currentTier = "wing";
        } else {
          throw new Error("Already at base — nowhere to forward.");
        }
        cur.currentPcId = input.forwardPcId ?? null;
        cur.currentPcName = input.forwardPcName ?? null;
        cur.status = "reviewed";
        push("reviewed", `→ ${input.forwardPcName ?? ""}`);
      }
      all[idx] = cur;
      writeShares(all);
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
      const all = readShares();
      const idx = all.findIndex(s => s.id === input.id);
      if (idx < 0) throw new Error("Schedule not found");
      const cur = { ...all[idx] };
      if (!cur.editedRows) return cur;
      cur.rows = cur.editedRows;
      cur.baselineRows = cur.editedRows;
      cur.editedRows = undefined;
      cur.status = "approved";
      cur.history.push({ at: nowIso(), by: input.by, tier: "squadron", action: "approved", note: "originator accepted edits" });
      all[idx] = cur;
      writeShares(all);
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
export type MessageTier = "squadron" | "wing" | "base";

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
export function purgeExpiredMessages(): void {
  try {
    const rows = readMessages();
    const kept = purgeExpired(rows);
    if (kept.length !== rows.length) writeMessages(kept);
  } catch { /* localStorage may be unavailable in SSR/tests */ }
}

function purgeExpired(rows: PrivateMessage[]): PrivateMessage[] {
  const days = getMessageRetentionDays();
  const cutoff = Date.now() - days * 86_400_000;
  return rows.filter(m => new Date(m.sentAt).getTime() >= cutoff);
}

export function useMessages(forPcId: string | null): {
  inbox: PrivateMessage[]; sent: PrivateMessage[]; history: PrivateMessage[];
} & UseQueryResult<PrivateMessage[]> {
  const q = useQuery<PrivateMessage[]>({
    queryKey: ["xpc", "messages", forPcId ?? ""],
    queryFn: () => {
      const purged = purgeExpired(readMessages());
      writeMessages(purged);
      if (!forPcId) return [];
      return purged
        .filter(m => m.fromPcId === forPcId || m.toPcId === forPcId)
        .sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    },
    refetchInterval: 15_000,
  });
  const all = q.data ?? [];
  return {
    ...q,
    inbox: all.filter(m => m.toPcId === forPcId && !m.inHistory),
    sent: all.filter(m => m.fromPcId === forPcId),
    history: all.filter(m => m.toPcId === forPcId && m.inHistory),
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
      const all = readMessages();
      all.push(msg);
      writeMessages(all);
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
      const all = readMessages();
      const idx = all.findIndex(m => m.id === input.id);
      if (idx < 0) return null;
      all[idx] = { ...all[idx], readAt: nowIso(), inHistory: true };
      writeMessages(all);
      return all[idx];
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["xpc", "messages"] }),
  });
}

// Role helper: which roles are allowed to use the messages UI at all.
// Sqn / Wing / Base only — Flight Cmdr and Ops Pilot are excluded
// entirely. The squadron-ops `ops` role is treated as "Sqn" for messaging
// because the squadron PC speaks for the squadron when no commander tier
// is signed in locally.
export function canUseMessages(role: string | undefined, scope: string | undefined): boolean {
  if (role === "super_admin") return true;
  if (role === "ops") return true; // squadron PC
  if (role === "commander") {
    return scope === "squadron" || scope === "wing" || scope === "base";
  }
  return false;
}

// Role helper: which roles see the schedule chain UI. Flight Cmdr is
// allowed to participate. Ops Pilot (deputy / flight commander on the
// squadron sub-account) sees nothing.
export function canUseScheduleChain(role: string | undefined, scope: string | undefined): boolean {
  if (role === "super_admin") return true;
  if (role === "ops") return true;
  if (role === "commander") {
    return scope === "flight" || scope === "squadron" || scope === "wing" || scope === "base";
  }
  return false;
}
