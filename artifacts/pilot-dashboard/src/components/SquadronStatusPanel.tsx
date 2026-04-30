// SquadronStatusPanel — sidebar widget shown only on aggregator
// (Wing/Base) PCs. Polls `/api/aggregate/peers/health` every 30s and
// renders one row per peer squadron with an online/offline dot and
// the timestamp of the last successful pull.
//
// The panel renders nothing until the first response arrives (avoids
// flashing "no peers" on a slow network). Errors / disabled API
// surface as a single line so the operator notices the box is dead
// instead of seeing it stay empty forever.

import { useEffect, useRef, useState } from "react";
import {
  fetchAggregatePeersHealth,
  type PeerHealthStatus,
} from "@/lib/internal-migration";
import { useI18n } from "@/lib/i18n";

const REFRESH_MS = 30_000;

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  const d = new Date(t);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

interface State {
  loaded: boolean;
  peers: PeerHealthStatus[] | null;
  error: string | null;
}

export function SquadronStatusPanel() {
  const { t } = useI18n();
  const [state, setState] = useState<State>({
    loaded: false,
    peers: null,
    error: null,
  });
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    let cancelled = false;
    async function tick() {
      try {
        const r = await fetchAggregatePeersHealth();
        if (cancelled || !mounted.current) return;
        if (r === null) {
          setState({
            loaded: true,
            peers: null,
            error: "unavailable",
          });
        } else {
          setState({ loaded: true, peers: r, error: null });
        }
      } catch (e) {
        if (cancelled || !mounted.current) return;
        setState({
          loaded: true,
          peers: null,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    void tick();
    const handle = window.setInterval(tick, REFRESH_MS);
    return () => {
      cancelled = true;
      mounted.current = false;
      window.clearInterval(handle);
    };
  }, []);

  return (
    <section
      className="px-3 py-2 mt-2 border-t border-sidebar-border text-xs"
      data-testid="squadron-status-panel"
      aria-label={t("squadronStatusHeading")}
    >
      <h2 className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60 mb-1">
        {t("squadronStatusHeading")}
      </h2>
      {!state.loaded && (
        <div className="text-sidebar-foreground/60">{t("loading")}</div>
      )}
      {state.loaded && state.error === "unavailable" && (
        <div className="text-sidebar-foreground/60">
          {t("squadronStatusUnavailable")}
        </div>
      )}
      {state.loaded && state.error && state.error !== "unavailable" && (
        <div className="text-rose-300">{state.error}</div>
      )}
      {state.loaded && state.peers && state.peers.length === 0 && (
        <div className="text-sidebar-foreground/60">
          {t("squadronStatusEmpty")}
        </div>
      )}
      {state.loaded && state.peers && state.peers.length > 0 && (
        <ul className="space-y-1">
          {state.peers.map(p => (
            <li
              key={p.peer_squadron_id}
              className="flex items-center gap-2 min-w-0"
              data-testid={`squadron-status-row-${p.squadron_id}`}
            >
              <span
                className={`h-2 w-2 rounded-full shrink-0 ${
                  p.status === "online" ? "bg-emerald-400" : "bg-rose-500"
                }`}
                aria-hidden
              />
              <span className="truncate flex-1">
                {p.squadron_name || p.squadron_id}
              </span>
              <span className="text-sidebar-foreground/60 shrink-0">
                {p.status === "online"
                  ? t("squadronStatusOnline")
                  : `${t("squadronStatusOffline")} · ${formatTime(p.last_success_at)}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default SquadronStatusPanel;
