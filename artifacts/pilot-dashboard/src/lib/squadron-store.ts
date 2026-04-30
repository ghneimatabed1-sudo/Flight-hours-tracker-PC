// Squadron registry — persistent, editable list of squadrons known to this PC.
//
// LAN-only (task #318): the master squadron list lives in the api-server
// Postgres database on the Super Admin host PC and is read via the
// internal HTTP API (see `refreshSquadronsFromDb` -> `fetchInternalSquadronsList`).
// We mirror the result into localStorage under "rjaf.squadrons" so the
// dashboard renders instantly on next load and so other tabs see updates
// without refetching. There is no cloud sync — the Supabase fall-through
// has been removed. Writes from this UI update the local cache only;
// the canonical multi-PC sync path is "edit on Super Admin host -> ops
// PCs pull on next refresh".

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Squadron } from "./types";
import { fetchInternalSquadronsList } from "@/lib/internal-migration";

const STORAGE_KEY = "rjaf.squadrons";
const CHANGE_EVENT = "rjaf:squadrons-changed";
const DB_CHANGE_EVENT = "rjaf:squadrons-db-changed";

/**
 * Maps REST / internal-API squadron rows to UI records. Exported for unit
 * tests and shared with the internal migration read path.
 */
export function squadronsFromRemoteRows(
  rows: ReadonlyArray<{
    id: string;
    number: string;
    name: string;
    base: string;
    wing?: string | null;
    wing_id?: string | null;
    base_id?: string | null;
  }>,
): Squadron[] {
  return rows.map((r) => fromRow(r));
}

function fromRow(row: {
  id: string;
  number: string;
  name: string;
  base: string;
  wing?: string | null;
  wing_id?: string | null;
  base_id?: string | null;
}): Squadron {
  const nm = String(row.name ?? "").trim();
  const base = String(row.base ?? "").trim();
  const wing = String(row.wing ?? "").trim();
  const wingId = String(row.wing_id ?? "").trim();
  const baseId = String(row.base_id ?? "").trim();
  return {
    id: String(row.id),
    name: nm,
    nameAr: nm,
    code: String(row.number ?? "").trim().toUpperCase(),
    base,
    baseAr: base,
    wing: wing || "—",
    wingAr: wing || "—",
    enabled: true,
    keyHolder: null,
    wingId: wingId.length > 0 ? wingId : null,
    baseId: baseId.length > 0 ? baseId : null,
  };
}

function read(): Squadron[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((x): x is Squadron =>
      x && typeof x === "object" && typeof x.id === "string" && typeof x.name === "string"
    );
  } catch {
    return [];
  }
}

function write(list: Squadron[]): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    /* quota / private mode — silently ignore so UI doesn't crash */
  }
}

export function listSquadrons(): Squadron[] {
  return read();
}

export async function refreshSquadronsFromDb(): Promise<Squadron[]> {
  // LAN-only: read the master squadron list from the internal API.
  // The previous Supabase fall-through has been removed.
  const internalRows = await fetchInternalSquadronsList();
  if (internalRows !== null && internalRows.length > 0) {
    const mapped = squadronsFromRemoteRows(internalRows);
    write(mapped);
    window.dispatchEvent(new Event(DB_CHANGE_EVENT));
    return mapped;
  }
  return read();
}

export function getSquadron(id: string): Squadron | undefined {
  return read().find(s => s.id === id);
}

export interface CreateSquadronInput {
  name: string;
  nameAr?: string;
  code: string;
  base: string;
  baseAr?: string;
  wing: string;
  wingAr?: string;
}

export async function addSquadron(input: CreateSquadronInput): Promise<{ ok: boolean; error?: string; squadron?: Squadron }> {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const base = input.base.trim();
  const wing = input.wing.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (!code) return { ok: false, error: "code_required" };
  if (!base) return { ok: false, error: "base_required" };
  if (!wing) return { ok: false, error: "wing_required" };
  const sqn: Squadron = {
    id: crypto.randomUUID(),
    name,
    nameAr: (input.nameAr ?? "").trim() || name,
    code,
    base,
    baseAr: (input.baseAr ?? "").trim() || base,
    wing,
    wingAr: (input.wingAr ?? "").trim() || wing,
    enabled: true,
    keyHolder: null,
  };
  // Writes go to the local cache only; the master squadron list is owned
  // by the Super Admin host PC and surfaces to Ops PCs through the
  // internal API on next `refreshSquadronsFromDb`.
  const list = read();
  if (list.some(s => s.code.toUpperCase() === code)) {
    return { ok: false, error: "duplicate_code" };
  }
  write([...list, sqn]);
  return { ok: true, squadron: sqn };
}

export async function updateSquadron(id: string, patch: Partial<Squadron>): Promise<boolean> {
  // Writes update the local cache only; see header comment.
  const list = read();
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch, id: list[idx].id };
  write(list);
  return true;
}

export async function deleteSquadron(id: string): Promise<boolean> {
  // Writes update the local cache only; see header comment.
  const list = read();
  const next = list.filter(s => s.id !== id);
  if (next.length === list.length) return false;
  write(next);
  return true;
}

export async function setSquadronEnabled(id: string, enabled: boolean): Promise<boolean> {
  return updateSquadron(id, { enabled });
}

// React hook with cross-tab and same-tab live updates. Same-tab updates
// rely on the custom CHANGE_EVENT we dispatch in write(); cross-tab updates
// piggy-back on the standard `storage` event.
function subscribe(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener(DB_CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
    window.removeEventListener(DB_CHANGE_EVENT, handler);
    window.removeEventListener("storage", handler);
  };
}

// useSyncExternalStore needs a stable snapshot reference between unchanged
// reads or React 18 will warn "getSnapshot should be cached". We memoize
// based on the JSON string of the underlying storage.
let cachedRaw: string | null = null;
let cachedList: Squadron[] = [];
function getSnapshot(): Squadron[] {
  const raw = typeof window !== "undefined" ? localStorage.getItem(STORAGE_KEY) : null;
  if (raw === cachedRaw) return cachedList;
  cachedRaw = raw;
  cachedList = read();
  return cachedList;
}
function getServerSnapshot(): Squadron[] {
  return [];
}

export function useSquadrons(): Squadron[] {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// Convenience hook for pages that only want enabled squadrons (the typical
// dropdown filter when issuing licenses or routing pilots).
export function useEnabledSquadrons(): Squadron[] {
  const all = useSquadrons();
  // Recompute only when `all` reference changes (useSyncExternalStore caches it).
  const [filtered, setFiltered] = useState<Squadron[]>(() => all.filter(s => s.enabled));
  useEffect(() => {
    setFiltered(all.filter(s => s.enabled));
  }, [all]);
  return filtered;
}
