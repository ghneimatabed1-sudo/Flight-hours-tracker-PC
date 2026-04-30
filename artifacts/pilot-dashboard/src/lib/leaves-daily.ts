import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  deleteInternalUnavailableDay,
  fetchInternalUnavailableRows,
  isLanSessionLoginEnabled,
  postInternalUnavailableUpsertDay,
} from "./internal-migration";

export const OTHER_TYPE_ID = "other";
const TYPES_KEY = "rjaf.leaves.types.v2";
const DEFAULT_TYPES: LeaveType[] = [
  { id: "leave", name: "Leave", color: "#22c55e" },
  { id: "morning-leave", name: "Morning Leave", color: "#84cc16" },
  { id: "crew-rest", name: "Crew Rest", color: "#3b82f6" },
  { id: "outside-duty", name: "Outside Duty", color: "#a855f7" },
  { id: "sick", name: "Sick", color: "#ef4444" },
  { id: OTHER_TYPE_ID, name: "Other", color: "#eab308" },
];

export interface LeaveType {
  id: string;
  name: string;
  color: string;
}

export interface LeaveEntry {
  id: string;
  pilotId: string;
  typeId: string;
  from: string;
  to: string;
  note?: string;
}

function loadTypes(): LeaveType[] {
  try {
    const raw = localStorage.getItem(TYPES_KEY);
    if (!raw) return DEFAULT_TYPES;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return DEFAULT_TYPES;
    const typed = parsed.filter((x): x is LeaveType =>
      x && typeof x.id === "string" && typeof x.name === "string" && typeof x.color === "string");
    if (!typed.some((t) => t.id === OTHER_TYPE_ID)) typed.push(DEFAULT_TYPES[DEFAULT_TYPES.length - 1]);
    return typed;
  } catch {
    return DEFAULT_TYPES;
  }
}

function saveTypes(types: LeaveType[]): void {
  try { localStorage.setItem(TYPES_KEY, JSON.stringify(types)); } catch { /* noop */ }
}

function parseReason(reason: string | null | undefined): { typeId: string; note?: string } {
  const raw = (reason ?? "").trim();
  if (!raw) return { typeId: "leave" };
  const idx = raw.indexOf(":");
  if (idx < 0) return { typeId: raw.toLowerCase() };
  const typeId = raw.slice(0, idx).trim().toLowerCase() || OTHER_TYPE_ID;
  const note = raw.slice(idx + 1).trim();
  return note ? { typeId, note } : { typeId };
}

function buildReason(typeId: string, note?: string): string {
  const t = (typeId || "leave").trim().toLowerCase();
  const n = (note ?? "").trim();
  return n ? `${t}: ${n}` : t;
}

export function useLeaveTypes() {
  return useQuery<LeaveType[]>({
    queryKey: ["leave_types"],
    queryFn: async () => loadTypes(),
    initialData: loadTypes(),
    staleTime: Infinity,
  });
}

export function useUpsertLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (next: LeaveType) => {
      const all = loadTypes();
      const idx = all.findIndex((t) => t.id === next.id);
      if (idx >= 0) all[idx] = next;
      else all.push(next);
      saveTypes(all);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave_types"] }),
  });
}

export function useDeleteLeaveType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (id === OTHER_TYPE_ID) return;
      saveTypes(loadTypes().filter((t) => t.id !== id));
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leave_types"] }),
  });
}

export function useLeaveEntries() {
  return useQuery<LeaveEntry[]>({
    queryKey: ["leave_entries"],
    queryFn: async () => {
      if (isLanSessionLoginEnabled()) {
        const rows = await fetchInternalUnavailableRows();
        if (!rows) return [];
        return rows.map((r) => {
          const decoded = parseReason((r.reason as string | null | undefined));
          return {
            id: String(r.id ?? ""),
            pilotId: String(r.pilot_id ?? ""),
            from: String(r.from_date ?? ""),
            to: String(r.to_date ?? ""),
            typeId: decoded.typeId || "leave",
            note: decoded.note,
          };
        });
      }
      // LAN-only build: no remote source outside the internal data
      // plane. Demo mode (cloud session disabled) returns an empty list.
      return [];
    },
    initialData: [],
    retry: false,
  });
}

export function useSetLeaveEntry() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pilotId: string; dayIso: string; typeId: string; note?: string }) => {
      if (isLanSessionLoginEnabled()) {
        const out = await postInternalUnavailableUpsertDay({
          pilot_id: input.pilotId,
          day_iso: input.dayIso,
          reason: buildReason(input.typeId, input.note),
        });
        if (!out.ok) throw new Error(out.error);
        return;
      }
      // LAN-only build: writes outside the internal plane are dropped
      // silently — demo mode never persists.
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave_entries"] });
      qc.invalidateQueries({ queryKey: ["unavailable"] });
      qc.invalidateQueries({ queryKey: ["leaves"] });
    },
  });
}

export function useSetAvailableForDay() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: { pilotId: string; dayIso: string }) => {
      if (isLanSessionLoginEnabled()) {
        const out = await deleteInternalUnavailableDay({
          pilot_id: input.pilotId,
          day_iso: input.dayIso,
        });
        if (!out.ok) throw new Error(out.error);
        return;
      }
      // LAN-only build: writes outside the internal plane are dropped
      // silently — demo mode never persists.
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["leave_entries"] });
      qc.invalidateQueries({ queryKey: ["unavailable"] });
      qc.invalidateQueries({ queryKey: ["leaves"] });
    },
  });
}

export function useDeleteLeaveForDay() {
  return useSetAvailableForDay();
}
