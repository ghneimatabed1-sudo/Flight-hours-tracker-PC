import type { AuditEntry, LicenseKey, Pilot, Squadron, User } from "./types";

// Fresh install: no seeded squadrons, pilots, keys, commanders, or audit entries.
// The Super Admin creates real data through the UI (or via Supabase once the
// backend is configured). These exports must stay present — the app imports
// them by name — but they start empty.

export const squadrons: Squadron[] = [];
export const pilots: Pilot[] = [];
export const licenseKeys: LicenseKey[] = [];
export const commanders: User[] = [];
export const auditLog: AuditEntry[] = [];

export const SUPER_ADMIN: User = {
  id: "u-admin",
  username: "admin",
  displayName: "System Owner",
  role: "super_admin",
  squadronIds: [],
};
