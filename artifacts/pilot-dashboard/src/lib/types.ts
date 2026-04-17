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
  lockedToDevice: string | null;
  lastSyncAt: string | null;
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
