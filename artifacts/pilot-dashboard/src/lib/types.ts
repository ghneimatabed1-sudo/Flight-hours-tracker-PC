export type Role = "super_admin" | "commander" | "ops" | "deputy" | "admin";

export type CommanderScope = "squadron" | "wing" | "base" | "hq";

export interface User {
  id?: string;
  username: string;
  displayName: string;
  role: Role;
  scope?: CommanderScope;
  squadronIds?: string[];
}

export interface Squadron {
  id: string;
  name: string;
  nameAr: string;
  code: string;
  base: string;
  baseAr: string;
  wing: string;
  wingAr: string;
  enabled: boolean;
  keyHolder: string | null;
}

export interface Pilot {
  id: string;
  callSign: string;
  rank: string;
  rankAr: string;
  fullName: string;
  fullNameAr: string;
  squadronId: string;
  monthlyHours: number;
  grandTotalHours: number;
  nvgTotalHours: number;
  dayCurrencyDate: string;
  nightCurrencyDate: string;
  irtCurrencyDate: string;
  medicalCurrencyDate: string;
}

export interface LicenseKey {
  id: string;
  squadronId: string;
  keyPreview: string;
  status: "active" | "revoked" | "locked";
  issuedAt: string;
  // ISO date string when this key stops being valid, or null for "never expires".
  // The desktop client refuses activation past this date and existing
  // installations are signed out on next license check.
  expiresAt: string | null;
  lockedToDevice: string | null;
  lastSyncAt: string | null;
}

// License-key validity durations the super admin can pick when issuing a key.
export type LicenseDuration = "1d" | "2d" | "1m" | "3m" | "6m" | "1y" | "3y" | "never";

export function addDuration(fromIsoDate: string, d: LicenseDuration): string | null {
  if (d === "never") return null;
  const t = new Date(fromIsoDate);
  if (Number.isNaN(t.getTime())) return null;
  switch (d) {
    case "1d": t.setDate(t.getDate() + 1); break;
    case "2d": t.setDate(t.getDate() + 2); break;
    case "1m": t.setMonth(t.getMonth() + 1); break;
    case "3m": t.setMonth(t.getMonth() + 3); break;
    case "6m": t.setMonth(t.getMonth() + 6); break;
    case "1y": t.setFullYear(t.getFullYear() + 1); break;
    case "3y": t.setFullYear(t.getFullYear() + 3); break;
  }
  return t.toISOString().slice(0, 10);
}

export interface AuditEntry {
  id: string;
  timestamp: string;
  user: string;
  role: Role | "ops_officer";
  action: string;
  target: string;
  ip: string;
}

export type CurrencyStatus = "current" | "warning" | "expired";
