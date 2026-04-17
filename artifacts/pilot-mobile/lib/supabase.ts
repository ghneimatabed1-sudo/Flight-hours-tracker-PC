import {
  createClient,
  type SupabaseClient,
  type SupportedStorage,
} from "@supabase/supabase-js";
import * as SecureStore from "expo-secure-store";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";

import type { PilotProfile, PilotSnapshot, SortieRecord } from "./types";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

// SecureStore-backed storage adapter so the persisted Supabase auth session
// (access + refresh tokens) is stored in the OS keychain on device. Web falls
// back to AsyncStorage since SecureStore is unavailable there.
const secureStorage: SupportedStorage = {
  getItem: (key: string) =>
    Platform.OS === "web"
      ? AsyncStorage.getItem(key)
      : SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) =>
    Platform.OS === "web"
      ? AsyncStorage.setItem(key, value)
      : SecureStore.setItemAsync(key, value),
  removeItem: (key: string) =>
    Platform.OS === "web"
      ? AsyncStorage.removeItem(key)
      : SecureStore.deleteItemAsync(key),
};

export const supabase: SupabaseClient | null =
  supabaseConfigured && url && anonKey
    ? createClient(url, anonKey, {
        auth: {
          // Persist the per-pilot session so the app can read pilots/sorties
          // under RLS without re-running the link flow on every cold start.
          storage: secureStorage,
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: false,
          storageKey: "rjaf.auth.v1",
        },
      })
    : null;

interface PilotRow {
  id: string;
  rank: string;
  name: string;
  arabic_name: string | null;
  unit: string | null;
  phone: string | null;
  squadron_id: string;
  data: Record<string, unknown> | null;
}

interface SortieRow {
  id: string;
  date: string;
  pilot_id: string;
  co_pilot_id: string | null;
  data: Record<string, unknown> | null;
}

interface SquadronRow {
  id: string;
  number: string;
  name: string;
  base: string;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function rowsToSnapshot(
  pilot: PilotRow,
  squadron: SquadronRow | null,
  sorties: SortieRow[]
): PilotSnapshot {
  const d = pilot.data ?? {};
  const expiry = (d.expiry as Record<string, string> | undefined) ?? {};
  const profile: PilotProfile = {
    id: pilot.id,
    militaryNumber: pilot.id,
    name: pilot.name,
    arabicName: pilot.arabic_name ?? "",
    rank: pilot.rank,
    unit: pilot.unit ?? "",
    squadron: squadron ? `${squadron.number} ${squadron.name}` : "",
    phone: pilot.phone ?? undefined,
    openingDay: num(d.openingDay),
    openingNight: num(d.openingNight),
    openingNvg: num(d.openingNvg),
    openingCaptain: num(d.openingCaptain),
    openingSim: num(d.openingSim),
    expiry: {
      day: str(expiry.day) ?? "",
      night: str(expiry.night) ?? "",
      irt: str(expiry.irt) ?? "",
      medical: str(expiry.medical) ?? "",
      sim: str(expiry.sim) ?? "",
    },
  };

  const records: SortieRecord[] = sorties.map((s) => {
    const sd = s.data ?? {};
    const day = num(sd.day1) + num(sd.day2) + num(sd.dayDual);
    const night = num(sd.night1) + num(sd.night2) + num(sd.nightDual);
    const cap =
      sd.captain === pilot.id || sd.captainPilotId === pilot.id;
    const total = num(sd.actual) || day + night + num(sd.nvg) + num(sd.sim);
    return {
      id: s.id,
      date: s.date,
      acType: str(sd.acType) ?? "",
      acNumber: str(sd.acNumber) ?? "",
      sortieType: str(sd.sortieType) ?? "",
      name: str(sd.name) ?? "",
      pilotIsCaptain: Boolean(cap),
      day,
      night,
      nvg: num(sd.nvg),
      sim: num(sd.sim),
      total,
    };
  });

  return { profile, sorties: records, fetchedAt: new Date().toISOString() };
}

export type LinkErrorCode =
  | "not_found"
  | "bad_code"
  | "revoked"
  | "supabase_not_configured"
  | "generic";

export interface PilotSession {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in?: number;
  token_type?: string;
}

export interface LinkResult {
  ok: boolean;
  error?: LinkErrorCode;
  pilotId?: string;
  squadronId?: string;
  session?: PilotSession;
  snapshot?: PilotSnapshot;
}

function classifyError(message?: string): LinkErrorCode {
  const m = (message ?? "").toLowerCase();
  if (m.includes("invalid_credentials") || m.includes("not_found"))
    return "bad_code";
  if (m.includes("unauthorized") || m.includes("revoked")) return "revoked";
  return "generic";
}

/**
 * Calls the `link-pilot-device` edge function which validates the one-time
 * code and provisions a per-pilot Supabase auth user. The returned session is
 * what subsequent reads authenticate as — the anon key alone cannot read any
 * pilot row under the new RLS policies.
 */
export async function linkPilotRemote(
  militaryNumber: string,
  code: string
): Promise<LinkResult> {
  if (!supabase || !url || !anonKey) {
    return { ok: false, error: "supabase_not_configured" };
  }
  let res: Response;
  try {
    res = await fetch(`${url}/functions/v1/link-pilot-device`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: anonKey,
        authorization: `Bearer ${anonKey}`,
      },
      body: JSON.stringify({ mil: militaryNumber.trim(), code: code.trim() }),
    });
  } catch {
    return { ok: false, error: "generic" };
  }

  let payload: LinkEdgeResponse;
  try {
    payload = (await res.json()) as LinkEdgeResponse;
  } catch {
    return { ok: false, error: "generic" };
  }
  if (!res.ok || !payload.ok || !payload.session || !payload.pilotId) {
    return { ok: false, error: classifyError(payload.error) };
  }

  // Activate the session on the local client so direct selects below succeed.
  const { error: setErr } = await supabase.auth.setSession({
    access_token: payload.session.access_token,
    refresh_token: payload.session.refresh_token,
  });
  if (setErr) return { ok: false, error: "generic" };

  const snap = await fetchPilotSnapshotRemote(payload.pilotId);
  if (!snap.ok || !snap.snapshot) return { ok: false, error: "generic" };

  return {
    ok: true,
    pilotId: payload.pilotId,
    squadronId: payload.squadronId,
    session: payload.session,
    snapshot: snap.snapshot,
  };
}

interface LinkEdgeResponse {
  ok?: boolean;
  error?: string;
  pilotId?: string;
  squadronId?: string;
  session?: PilotSession;
}

/**
 * Reads the pilot's own row and sorties under RLS. The signed-in pilot's JWT
 * carries `app_metadata.pilot_id`, and the `pilots_self_select` /
 * `sorties_self_select` policies scope SELECT to that pilot only.
 */
export async function fetchPilotSnapshotRemote(
  pilotId: string
): Promise<LinkResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };

  const { data: pilotRow, error: pilotErr } = await supabase
    .from("pilots")
    .select("id, rank, name, arabic_name, unit, phone, squadron_id, data")
    .eq("id", pilotId)
    .maybeSingle();
  if (pilotErr) return { ok: false, error: classifyError(pilotErr.message) };
  if (!pilotRow) return { ok: false, error: "revoked" };

  const [{ data: squadronRow }, { data: sortieRows, error: sortiesErr }] =
    await Promise.all([
      supabase
        .from("squadrons")
        .select("id, number, name, base")
        .eq("id", (pilotRow as PilotRow).squadron_id)
        .maybeSingle(),
      supabase
        .from("sorties")
        .select("id, date, pilot_id, co_pilot_id, data")
        .or(`pilot_id.eq.${pilotId},co_pilot_id.eq.${pilotId}`)
        .order("date", { ascending: false }),
    ]);

  if (sortiesErr) return { ok: false, error: classifyError(sortiesErr.message) };

  return {
    ok: true,
    snapshot: rowsToSnapshot(
      pilotRow as PilotRow,
      (squadronRow as SquadronRow | null) ?? null,
      (sortieRows as SortieRow[] | null) ?? []
    ),
  };
}
