// Squadron registry — persistent, editable list of squadrons known to this PC.
//
// HISTORY (v1.0.42): Before this file existed, `mockData.squadrons` was an
// empty array hard-coded into the bundle, and there was NO UI to add a
// squadron. On a fresh install, the Super Admin would open License Keys,
// click Generate Key, see an empty squadron dropdown, and be permanently
// stuck — no key could be issued, so no other PC could ever be activated.
// Existing PCs only "worked" because they carried leftover squadron data
// from older builds that had seed entries.
//
// The Super Admin PC owns the master squadron list. When the Super Admin
// generates a license key for an Ops PC, the squadron metadata is baked
// into the activation payload, so commander/wing/HQ PCs receive their
// squadron context indirectly through the keys they activate.
//
// Storage: localStorage on the Super Admin PC under "rjaf.squadrons".
// We deliberately do NOT round-trip squadrons through Supabase yet because
// the publishable anon key cannot read RLS-protected tables and adding
// service-role credentials to a client bundle would leak admin access.

import { useEffect, useState, useSyncExternalStore } from "react";
import type { Squadron } from "./types";

const STORAGE_KEY = "rjaf.squadrons";
const CHANGE_EVENT = "rjaf:squadrons-changed";

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

export function addSquadron(input: CreateSquadronInput): { ok: boolean; error?: string; squadron?: Squadron } {
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  const base = input.base.trim();
  const wing = input.wing.trim();
  if (!name) return { ok: false, error: "name_required" };
  if (!code) return { ok: false, error: "code_required" };
  if (!base) return { ok: false, error: "base_required" };
  if (!wing) return { ok: false, error: "wing_required" };
  const list = read();
  if (list.some(s => s.code.toUpperCase() === code)) {
    return { ok: false, error: "duplicate_code" };
  }
  const sqn: Squadron = {
    id: `sqn-${code.toLowerCase()}-${Date.now().toString(36)}`,
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
  write([...list, sqn]);
  return { ok: true, squadron: sqn };
}

export function updateSquadron(id: string, patch: Partial<Squadron>): boolean {
  const list = read();
  const idx = list.findIndex(s => s.id === id);
  if (idx === -1) return false;
  list[idx] = { ...list[idx], ...patch, id: list[idx].id };
  write(list);
  return true;
}

export function deleteSquadron(id: string): boolean {
  const list = read();
  const next = list.filter(s => s.id !== id);
  if (next.length === list.length) return false;
  write(next);
  return true;
}

export function setSquadronEnabled(id: string, enabled: boolean): boolean {
  return updateSquadron(id, { enabled });
}

// React hook with cross-tab and same-tab live updates. Same-tab updates
// rely on the custom CHANGE_EVENT we dispatch in write(); cross-tab updates
// piggy-back on the standard `storage` event.
function subscribe(cb: () => void): () => void {
  const handler = () => cb();
  window.addEventListener(CHANGE_EVENT, handler);
  window.addEventListener("storage", handler);
  return () => {
    window.removeEventListener(CHANGE_EVENT, handler);
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
