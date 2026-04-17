import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { demoSnapshot, DEMO_LINK_CODE, DEMO_MILITARY_NUMBER } from "./mockData";
import {
  clearLink,
  loadLink,
  loadSnapshot,
  saveLink,
  saveSnapshot,
  type LinkRecord,
} from "./storage";
import {
  fetchPilotSnapshotRemote,
  linkPilotRemote,
  supabase,
  supabaseConfigured,
} from "./supabase";
import type { PilotSnapshot } from "./types";

type LinkErrorCode =
  | "not_found"
  | "bad_code"
  | "revoked"
  | "supabase_not_configured"
  | "generic";

interface AppDataValue {
  ready: boolean;
  link: LinkRecord | null;
  snapshot: PilotSnapshot | null;
  refreshing: boolean;
  lastError: string | null;
  remoteEnabled: boolean;
  linkAccount: (
    militaryNumber: string,
    code: string
  ) => Promise<{ ok: boolean; error?: LinkErrorCode }>;
  refresh: () => Promise<void>;
  unlink: () => Promise<void>;
}

const Ctx = createContext<AppDataValue | null>(null);

// Background sync interval. The mobile client polls direct table reads under
// its per-pilot Supabase auth session (RLS scopes them to the signed-in
// pilot). Polling keeps the dependency surface small; pull-to-refresh
// remains for on-demand updates.
const POLL_MS = 15_000;

export function AppDataProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(false);
  const [link, setLink] = useState<LinkRecord | null>(null);
  const [snapshot, setSnapshot] = useState<PilotSnapshot | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  // Latest link kept in a ref so the polling/realtime closures always see the
  // current token without resubscribing on every state change.
  const linkRef = useRef<LinkRecord | null>(null);
  linkRef.current = link;

  const applyRefresh = useCallback(async (rec: LinkRecord) => {
    if (!rec.pilotId) return;
    const r = await fetchPilotSnapshotRemote(rec.pilotId);
    if (r.ok && r.snapshot) {
      setSnapshot(r.snapshot);
      await saveSnapshot(r.snapshot);
      setLastError(null);
    } else if (r.error === "revoked") {
      setLastError("revoked");
      await clearLink();
      setLink(null);
      setSnapshot(null);
    } else if (r.error) {
      setLastError(r.error);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [storedLink, storedSnap] = await Promise.all([
        loadLink(),
        loadSnapshot(),
      ]);
      if (cancelled) return;
      setLink(storedLink);
      setSnapshot(storedSnap);
      setReady(true);

      if (storedLink && supabaseConfigured && storedLink.pilotId) {
        // The Supabase client restores the persisted auth session from
        // SecureStore on its own; just verify it is still valid before
        // attempting a read so we surface revoked sessions cleanly.
        const { data } = (await supabase?.auth.getSession()) ?? { data: null };
        if (data?.session) {
          await applyRefresh(storedLink);
        } else {
          setLastError("revoked");
          await clearLink();
          setLink(null);
          setSnapshot(null);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applyRefresh]);

  // Background sync: only active while linked against a real Supabase
  // project. Demo mode skips this since the cached snapshot never changes.
  useEffect(() => {
    if (!link || !supabaseConfigured || !link.pilotId) return;

    let stopped = false;
    const interval = setInterval(() => {
      const current = linkRef.current;
      if (!stopped && current) void applyRefresh(current);
    }, POLL_MS);

    return () => {
      stopped = true;
      clearInterval(interval);
    };
  }, [link, applyRefresh]);

  const linkAccount = useCallback(
    async (militaryNumber: string, code: string) => {
      setLastError(null);
      const mn = militaryNumber.trim();
      const cd = code.trim();

      if (!mn || !cd) return { ok: false, error: "generic" as const };

      if (supabaseConfigured) {
        const r = await linkPilotRemote(mn, cd);
        if (!r.ok || !r.snapshot) {
          const err = (r.error as LinkErrorCode) ?? "generic";
          setLastError(err);
          return { ok: false, error: err };
        }
        const linkRec: LinkRecord = {
          militaryNumber: mn,
          pilotId: r.snapshot.profile.id,
          linkedAt: new Date().toISOString(),
          squadronId: r.squadronId,
        };
        await saveLink(linkRec);
        await saveSnapshot(r.snapshot);
        setLink(linkRec);
        setSnapshot(r.snapshot);
        return { ok: true };
      }

      // Demo mode (no Supabase configured).
      if (mn !== DEMO_MILITARY_NUMBER) {
        setLastError("not_found");
        return { ok: false, error: "not_found" as const };
      }
      if (cd !== DEMO_LINK_CODE) {
        setLastError("bad_code");
        return { ok: false, error: "bad_code" as const };
      }
      const linkRec: LinkRecord = {
        militaryNumber: mn,
        pilotId: demoSnapshot.profile.id,
        linkedAt: new Date().toISOString(),
      };
      await saveLink(linkRec);
      await saveSnapshot(demoSnapshot);
      setLink(linkRec);
      setSnapshot(demoSnapshot);
      return { ok: true };
    },
    []
  );

  const refresh = useCallback(async () => {
    if (!link) return;
    setRefreshing(true);
    try {
      if (supabaseConfigured && link.pilotId) {
        await applyRefresh(link);
      } else {
        const next: PilotSnapshot = {
          ...demoSnapshot,
          fetchedAt: new Date().toISOString(),
        };
        setSnapshot(next);
        await saveSnapshot(next);
      }
    } finally {
      setRefreshing(false);
    }
  }, [link, applyRefresh]);

  const unlink = useCallback(async () => {
    if (supabaseConfigured) {
      try {
        await supabase?.auth.signOut();
      } catch {
        // Best-effort: even if the network sign-out fails we still want to
        // wipe local state below.
      }
    }
    await clearLink();
    setLink(null);
    setSnapshot(null);
    setLastError(null);
  }, []);

  const value = useMemo<AppDataValue>(
    () => ({
      ready,
      link,
      snapshot,
      refreshing,
      lastError,
      remoteEnabled: supabaseConfigured,
      linkAccount,
      refresh,
      unlink,
    }),
    [ready, link, snapshot, refreshing, lastError, linkAccount, refresh, unlink]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used inside <AppDataProvider>");
  return v;
}
