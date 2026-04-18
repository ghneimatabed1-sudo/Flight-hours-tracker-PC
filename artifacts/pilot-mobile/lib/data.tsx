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
import { generateSalt, hashPassword } from "./password";
import {
  clearLink,
  clearLock,
  loadLink,
  loadLock,
  loadSnapshot,
  saveLink,
  saveLock,
  saveSnapshot,
  type LinkRecord,
  type LockRecord,
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
  // Local device-lock state.
  // `hasPassword` is true when the pilot has already created a password.
  // `unlocked` is an in-memory flag that becomes true after the pilot types
  //   the correct password (or creates one). Cold-launch always starts
  //   `unlocked=false` so the app re-prompts on every open if a password is
  //   set.
  hasPassword: boolean;
  unlocked: boolean;
  linkAccount: (
    militaryNumber: string,
    code: string
  ) => Promise<{ ok: boolean; error?: LinkErrorCode }>;
  refresh: () => Promise<void>;
  unlink: () => Promise<void>;
  createPassword: (pw: string) => Promise<{ ok: boolean }>;
  verifyPassword: (pw: string) => Promise<{ ok: boolean }>;
  changePassword: (
    currentPw: string,
    newPw: string
  ) => Promise<{ ok: boolean; error?: "wrong_current" }>;
  signOut: () => void;
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
  const [lock, setLock] = useState<LockRecord | null>(null);
  // Fresh launch always starts locked — the pilot must enter their password
  // (if one is set) before seeing any hours. The flag flips to true after a
  // successful unlock or right after the password is created for the first
  // time.
  const [unlocked, setUnlocked] = useState(false);
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
      const [storedLink, storedSnap, storedLock] = await Promise.all([
        loadLink(),
        loadSnapshot(),
        loadLock(),
      ]);
      if (cancelled) return;
      setLink(storedLink);
      setSnapshot(storedSnap);
      setLock(storedLock);
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
    await clearLock();
    setLink(null);
    setSnapshot(null);
    setLock(null);
    setUnlocked(false);
    setLastError(null);
  }, []);

  const createPassword = useCallback(async (pw: string) => {
    const clean = pw.trim();
    if (clean.length < 4) return { ok: false };
    const salt = await generateSalt();
    const hash = await hashPassword(clean, salt);
    const rec: LockRecord = { salt, hash };
    await saveLock(rec);
    setLock(rec);
    setUnlocked(true);
    return { ok: true };
  }, []);

  const verifyPassword = useCallback(
    async (pw: string) => {
      if (!lock) return { ok: false };
      const h = await hashPassword(pw.trim(), lock.salt);
      if (h === lock.hash) {
        setUnlocked(true);
        return { ok: true };
      }
      return { ok: false };
    },
    [lock]
  );

  const changePassword = useCallback(
    async (currentPw: string, newPw: string) => {
      const clean = newPw.trim();
      if (clean.length < 4) return { ok: false as const };
      if (!lock) {
        // No existing password — treat as first-time setup.
        const salt = await generateSalt();
        const hash = await hashPassword(clean, salt);
        const rec: LockRecord = { salt, hash };
        await saveLock(rec);
        setLock(rec);
        setUnlocked(true);
        return { ok: true as const };
      }
      const current = await hashPassword(currentPw.trim(), lock.salt);
      if (current !== lock.hash) {
        return { ok: false as const, error: "wrong_current" as const };
      }
      const salt = await generateSalt();
      const hash = await hashPassword(clean, salt);
      const rec: LockRecord = { salt, hash };
      await saveLock(rec);
      setLock(rec);
      setUnlocked(true);
      return { ok: true as const };
    },
    [lock]
  );

  // Sign out locks the app but keeps the pilot-device pairing intact. On
  // re-entry the pilot types their password — no new pairing code needed.
  const signOut = useCallback(() => {
    setUnlocked(false);
  }, []);

  const value = useMemo<AppDataValue>(
    () => ({
      ready,
      link,
      snapshot,
      refreshing,
      lastError,
      remoteEnabled: supabaseConfigured,
      hasPassword: !!lock,
      unlocked,
      linkAccount,
      refresh,
      unlink,
      createPassword,
      verifyPassword,
      changePassword,
      signOut,
    }),
    [
      ready,
      link,
      snapshot,
      refreshing,
      lastError,
      lock,
      unlocked,
      linkAccount,
      refresh,
      unlink,
      createPassword,
      verifyPassword,
      changePassword,
      signOut,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAppData(): AppDataValue {
  const v = useContext(Ctx);
  if (!v) throw new Error("useAppData must be used inside <AppDataProvider>");
  return v;
}
