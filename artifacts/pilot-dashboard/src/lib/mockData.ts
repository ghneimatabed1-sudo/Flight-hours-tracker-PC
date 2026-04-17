import type { AuditEntry, LicenseKey, Pilot, Squadron, User } from "./types";

// Fresh install: no seeded squadrons, pilots, commanders, or audit entries.
// The Super Admin creates real data through the UI (or via Supabase once the
// backend is configured). These exports must stay present — the app imports
// them by name — but they start empty.

export const squadrons: Squadron[] = [];
export const pilots: Pilot[] = [];
export const commanders: User[] = [];
export const auditLog: AuditEntry[] = [];

// Install-activation key baked into every distribution so a fresh PC install
// can be unlocked without requiring a previous Super Admin to have minted one
// first. The key is NOT bound to a specific operator — anyone installing on
// a new PC types it with their own username during first-time activation.
// The Super Admin can (and should) issue additional per-operator keys from
// the LicenseKeys admin page once the app is up.
//
// Stored in the registry with the `_fullKey` field so lookupLicenseKey() can
// match the exact string the operator types. Never expires.
export const licenseKeys: LicenseKey[] = [
  {
    id: "seed-install-key",
    squadronId: "",
    keyPreview: "MG3H…HM22",
    status: "active",
    issuedAt: "2026-01-01T00:00:00.000Z",
    expiresAt: null,
    // @ts-expect-error — _fullKey is a private registry-only field consumed by
    // license-registry.ts; it is intentionally absent from the LicenseKey type.
    _fullKey: "MG3H7HM22",
  } as LicenseKey,
];

export const SUPER_ADMIN: User = {
  id: "u-admin",
  username: "admin",
  displayName: "System Owner",
  role: "super_admin",
  squadronIds: [],
};
