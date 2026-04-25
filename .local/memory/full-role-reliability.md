# Full-role reliability hardening memory

## 2026-04-25 — Plan execution checkpoint

- Executed the full-role reliability hardening sequence in staged order: role matrix, wiring drift scan, targeted runtime checks, staged code hardening, and regression validation.
- Added a durable role-flow matrix artifact at:
  - `audit-evidence/2026-04-25/full-role-reliability/ROLE_FLOW_MATRIX.md`
- Confirmed and fixed one high-impact local/mock drift:
  - `src/pages/admin/Overview.tsx` previously read `pilots` from `mockData` and mixed mock/live assumptions.
  - It now reads pilots from the operational data hook (`usePilots`) so super-admin overview counts use the same live data source as the rest of the app.
- Validation run included:
  - dashboard smoke + translation + dash-pilots tests,
  - pilot transfer RPC integration test,
  - dashboard typecheck.
- Supabase advisor re-check completed to confirm current security/performance lint state after hardening pass.

## Operator-facing lesson captured

- Super-admin overview widgets must never rely on static mock arrays when Supabase is configured; this creates false readiness signals for org-wide command visibility and masks real cross-PC drift.
