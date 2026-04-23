import { useMemo } from "react";
import { useAuth } from "@/lib/auth";
import {
  getLocalPcId,
  makePcMatcher,
  useScheduleShares,
  useMessages,
  usePendingApprovals,
} from "@/lib/cross-pc";

export type SidebarBadgeMap = Record<string, number>;

export function useSidebarBadges(): SidebarBadgeMap {
  const { user, squadron } = useAuth();

  const myTier =
    (user?.role as string | undefined) === "flight_cmdr" ? "flight"
    : user?.scope === "flight" ? "flight"
    : user?.scope === "wing" ? "wing"
    : user?.scope === "base" ? "base"
    : "squadron";

  const canonicalId = getLocalPcId();
  const fallbackId = myTier === "squadron"
    ? (squadron?.name ?? user?.username ?? "")
    : `${myTier.toUpperCase()}:${user?.displayName ?? user?.username ?? "CMD"}`;
  const myPcId = canonicalId || fallbackId || null;

  const homeSquadronId = squadron?.name ?? null;

  const sharesQ = useScheduleShares(myPcId);
  const messagesQ = useMessages(myPcId);
  const pendingQ = usePendingApprovals(homeSquadronId);

  const matchesMe = useMemo(() => makePcMatcher(myPcId), [myPcId]);

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

    return {
      "/schedule-chain": chainCount,
      "/messages": messageCount,
      "/pending": pendingCount,
    };
  }, [sharesQ.data, messagesQ.inbox, pendingQ.data, matchesMe]);
}
