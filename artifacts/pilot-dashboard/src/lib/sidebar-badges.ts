import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/lib/auth";
import {
  getLocalPcId,
  makePcMatcher,
  useScheduleShares,
  useMessages,
  usePendingApprovals,
  canViewFinalSchedules,
} from "@/lib/cross-pc";

export type SidebarBadgeMap = Record<string, number>;

// v1.1.105 — "last seen" bookkeeping for the Final Schedules page.
// Base, HQ, Flight Cmdr and Sqn Cmdr don't get a ball-in-their-court
// schedule chain pulse (they're read-only archive viewers), so we
// give them the same red-highlight treatment Ops enjoys by counting
// every Wing-approved schedule that has arrived since they last
// opened the Final Schedules page. Storing the "seen" marker in
// localStorage keeps the state per-device, which is what the user
// expects for a desktop operator.
const K_LAST_SEEN_FINALS = "rjaf.lastSeenFinals";
const EVT_LAST_SEEN_FINALS = "rjaf:finals-seen";

export function markFinalSchedulesSeen(): void {
  try {
    window.localStorage.setItem(K_LAST_SEEN_FINALS, new Date().toISOString());
    window.dispatchEvent(new Event(EVT_LAST_SEEN_FINALS));
  } catch {
    /* private mode / storage disabled — badge will just not clear */
  }
}

function readLastSeenFinals(): string {
  try {
    return window.localStorage.getItem(K_LAST_SEEN_FINALS) ?? "1970-01-01T00:00:00Z";
  } catch {
    return "1970-01-01T00:00:00Z";
  }
}

export function useSidebarBadges(): SidebarBadgeMap {
  const { user, squadron } = useAuth();

  const myTier =
    (user?.role as string | undefined) === "flight_cmdr" ? "flight"
    : user?.scope === "flight" ? "flight"
    : user?.scope === "wing" ? "wing"
    : user?.scope === "base" ? "base"
    : user?.scope === "hq" ? "hq"
    : "squadron";

  const canonicalId = getLocalPcId();
  const fallbackId = myTier === "squadron"
    ? (squadron?.name ?? user?.username ?? "")
    : `${myTier.toUpperCase()}:${user?.displayName ?? user?.username ?? "CMD"}`;
  const myPcId = canonicalId || fallbackId || null;

  const homeSquadronId = squadron?.name ?? null;

  // Base/HQ/Flight/Sqn Cmdrs can all read the Wing-approved archive.
  // Only pull the broader rollup when this user is actually allowed
  // to view it — avoids extra traffic for Ops/Flight peers who don't
  // see the page.
  const finalsViewer = canViewFinalSchedules(user?.role, user?.scope);

  const sharesQ = useScheduleShares(myPcId, { viewAllApproved: finalsViewer });
  const messagesQ = useMessages(myPcId);
  const pendingQ = usePendingApprovals(homeSquadronId);

  const matchesMe = useMemo(() => makePcMatcher(myPcId), [myPcId]);

  // Reactively track the "Final Schedules last opened" timestamp so
  // the red dot clears the moment the user visits that page, and
  // re-arms whenever a newer Wing-approved schedule lands.
  const [lastSeenFinals, setLastSeenFinals] = useState<string>(() => readLastSeenFinals());
  useEffect(() => {
    const sync = () => setLastSeenFinals(readLastSeenFinals());
    window.addEventListener(EVT_LAST_SEEN_FINALS, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVT_LAST_SEEN_FINALS, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  return useMemo(() => {
    const shares = sharesQ.data ?? [];
    const inbox = messagesQ.inbox ?? [];
    const pending = pendingQ.data ?? [];

    // Schedule chain: ball-in-my-court rows the user has not yet acted on.
    // Approved / rejected terminals don't count — they're history.
    const chainCount = shares.filter(s =>
      s.currentPcId !== null
      && matchesMe(s.currentPcId)
      && s.status !== "approved"
      && s.status !== "rejected",
    ).length;

    // Messages: inbox items still unread (no readAt) and not yet archived
    // to history. useMessages already filters out in-history items.
    const messageCount = inbox.filter(m => !m.readAt).length;

    // Pending guest approvals: every row is awaiting an Ops decision.
    const pendingCount = pending.length;

    // Final Schedules: count Wing-approved schedules that arrived
    // (approvedAt) AFTER this PC last opened the archive page. Gives
    // Base / HQ / Flight Cmdr / Sqn Cmdr the same unread-style red
    // highlight Ops sees on /schedule-chain + /messages. Only counts
    // when the user has access to the page in the first place — no
    // point in computing it for Ops/deputies who don't see it.
    const finalsCount = finalsViewer
      ? shares.filter(s =>
          s.status === "approved"
          && !!s.approvedAt
          && s.approvedAt > lastSeenFinals,
        ).length
      : 0;

    return {
      "/schedule-chain": chainCount,
      "/messages": messageCount,
      "/pending": pendingCount,
      "/final-schedules": finalsCount,
    };
  }, [sharesQ.data, messagesQ.inbox, pendingQ.data, matchesMe, finalsViewer, lastSeenFinals]);
}
