// LAN-only build: the outbox used to drain queued mutations against
// the cloud Supabase REST endpoints. With the cloud SDK removed there
// is no remote target to flush to — every write now goes through the
// internal API on the local host PC, which is reachable as long as the
// LAN is up. The exports below are kept as no-ops so existing call
// sites continue to compile and behave predictably (enqueue is a
// silent drop, pending returns the legacy queue contents in case any
// browser still has localStorage rows from the cloud era).

export interface QueuedMutation {
  id: string;
  table: string;
  op: "insert" | "update" | "delete";
  payload: Record<string, unknown>;
  match?: Record<string, unknown>;
  createdAt: number;
}

const KEY = "rjaf.outbox";

function read(): QueuedMutation[] {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]") as QueuedMutation[]; }
  catch { return []; }
}

export function enqueue(_m: Omit<QueuedMutation, "id" | "createdAt">): void {
  /* no-op in LAN mode — writes go directly through the internal API */
}

export function pending(): QueuedMutation[] {
  return read();
}

export async function flushOutbox(): Promise<{ flushed: number; failed: number }> {
  return { flushed: 0, failed: 0 };
}

export function startOutboxWorker(): void {
  /* no-op in LAN mode */
}
