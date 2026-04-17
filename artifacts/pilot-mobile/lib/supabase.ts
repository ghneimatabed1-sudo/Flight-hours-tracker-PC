import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { PilotProfile, PilotSnapshot, SortieRecord } from "./types";

const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = supabaseConfigured
  ? createClient(url as string, anonKey as string, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

interface SnapshotPayload {
  token?: string;
  pilot: {
    id: string;
    rank: string;
    name: string;
    arabicName: string | null;
    unit: string | null;
    phone: string | null;
    data: Record<string, unknown> | null;
  };
  squadron: {
    id: string;
    number: string;
    name: string;
    base: string;
  } | null;
  sorties: Array<{
    id: string;
    date: string;
    data: Record<string, unknown> | null;
  }>;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.length > 0 ? v : undefined;
}

function payloadToSnapshot(p: SnapshotPayload): PilotSnapshot {
  const d = p.pilot.data ?? {};
  const expiry = (d.expiry as Record<string, string> | undefined) ?? {};
  const profile: PilotProfile = {
    id: p.pilot.id,
    militaryNumber: p.pilot.id,
    name: p.pilot.name,
    arabicName: p.pilot.arabicName ?? "",
    rank: p.pilot.rank,
    unit: p.pilot.unit ?? "",
    squadron: p.squadron ? `${p.squadron.number} ${p.squadron.name}` : "",
    phone: p.pilot.phone ?? undefined,
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

  const sorties: SortieRecord[] = p.sorties.map((s) => {
    const sd = s.data ?? {};
    const day = num(sd.day1) + num(sd.day2) + num(sd.dayDual);
    const night = num(sd.night1) + num(sd.night2) + num(sd.nightDual);
    const cap =
      sd.captain === p.pilot.id || sd.captainPilotId === p.pilot.id;
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

  return { profile, sorties, fetchedAt: new Date().toISOString() };
}

export type LinkErrorCode =
  | "not_found"
  | "bad_code"
  | "revoked"
  | "supabase_not_configured"
  | "generic";

export interface LinkResult {
  ok: boolean;
  error?: LinkErrorCode;
  token?: string;
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
 * Server-side link verification. The mobile client never reads the link code
 * from the database; it sends military number + code to a SECURITY DEFINER
 * RPC which validates them and returns an opaque device token plus the
 * initial snapshot.
 */
export async function linkPilotRemote(
  militaryNumber: string,
  code: string
): Promise<LinkResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await supabase.rpc("link_pilot_device", {
    p_mil: militaryNumber.trim(),
    p_code: code.trim(),
  });
  if (error) return { ok: false, error: classifyError(error.message) };
  const payload = data as SnapshotPayload | null;
  if (!payload || !payload.token) return { ok: false, error: "generic" };
  return {
    ok: true,
    token: payload.token,
    snapshot: payloadToSnapshot(payload),
  };
}

/**
 * Fetch the latest snapshot for a previously linked device. RLS on
 * pilots/sorties blocks direct selects from the anon key; this RPC is the
 * only read path the mobile client ever uses.
 */
export async function fetchPilotSnapshotRemote(
  token: string
): Promise<LinkResult> {
  if (!supabase) return { ok: false, error: "supabase_not_configured" };
  const { data, error } = await supabase.rpc("pilot_snapshot", {
    p_token: token,
  });
  if (error) return { ok: false, error: classifyError(error.message) };
  const payload = data as SnapshotPayload | null;
  if (!payload) return { ok: false, error: "generic" };
  return { ok: true, snapshot: payloadToSnapshot(payload) };
}

