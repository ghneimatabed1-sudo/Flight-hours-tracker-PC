// Runtime error reporter — Task #265 Part F.
//
// LAN-only build: the cloud `runtime_error_capture` RPC is gone with
// the rest of the Supabase SDK. Every dashboard PC sits on a closed
// base LAN with no internet access, so there is no remote ingestion
// endpoint to forward errors to. Rather than buffering forever or
// guessing at a not-yet-built internal sink, we keep this module as
// a structured no-op: the API surface (`reportRuntimeError`) stays
// stable so the global error handler, route boundaries and console
// proxy can keep calling it without conditional checks, and a single
// console.warn is emitted per (name+message) so an operator running
// devtools still sees the crash. If/when an internal-API
// `/api/internal/runtime-errors` endpoint lands, swap the warn for
// a fire-and-forget POST to that route — the dedup/rate-limit
// machinery below is already wired in.

const DEDUP_WINDOW_MS = 60_000;
const MAX_REPORTS_PER_SESSION = 30;

const recentlyReported = new Map<string, number>();
let reportCount = 0;

function dedupKey(name: string, message: string): string {
  return `${name}::${message.slice(0, 80)}`;
}

function shouldReport(name: string, message: string): boolean {
  if (reportCount >= MAX_REPORTS_PER_SESSION) return false;
  const key = dedupKey(name, message);
  const lastSeen = recentlyReported.get(key);
  const now = Date.now();
  if (lastSeen && now - lastSeen < DEDUP_WINDOW_MS) return false;
  recentlyReported.set(key, now);
  return true;
}

export interface RuntimeErrorContext {
  source?: string;          // 'window.error' | 'unhandledrejection' | 'errorBoundary'
  componentStack?: string;
}

export function reportRuntimeError(err: unknown, ctx: RuntimeErrorContext = {}): void {
  try {
    const e = err instanceof Error ? err : new Error(typeof err === "string" ? err : JSON.stringify(err));
    const name = (e.name || "Error").slice(0, 64);
    const message = (e.message || "(no message)").slice(0, 1000);
    if (!shouldReport(name, message)) return;
    reportCount += 1;
    if (typeof console !== "undefined" && console.warn) {
      console.warn("[runtime-error]", {
        name,
        message,
        source: ctx.source ?? "unknown",
        componentStack: ctx.componentStack?.slice(0, 2000),
      });
    }
  } catch {
    // Reporter must never throw.
  }
}
