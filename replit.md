# Hawk Eye — LAN production-readiness build

## Overview

Hawk Eye (عين الصقر) is a flight-hours management system for the Royal
Jordanian Air Force (RJAF). This workspace is the **LAN-only** rebuild
that supersedes the legacy Supabase / cloud build. Everything inside it
is designed to run on a private base network with **no internet access,
no Supabase, no two-factor codes, and no cloud telemetry**.

Single-product, three packages:

- `artifacts/pilot-dashboard/` — React + Vite + Electron Windows desktop
  app. The main product. Used by Squadron Operations Officers and
  Commanders inside HQ. Talks to one and only one backend: the local
  api-server on the LAN.
- `artifacts/api-server/` — Express server providing the entire backend:
  LAN auth (`lan_users` + `lan_sessions`), Postgres-backed reads/writes,
  audit log, reminder scheduler, and cross-PC messaging. Bound to a
  single physical "host PC" on the squadron LAN.
- `artifacts/mockup-sandbox/` — design preview surface. Not deployed.

Shelved (kept under `artifacts/_shelved/` for reference only, not built
or registered as artifacts):

- `pilot-mobile` — Expo app from the cloud build. Deferred; mobile is
  not part of the current LAN production scope.
- `pilot-desktop` — duplicate Electron build superseded by the dashboard
  artifact.

## Architecture

- **Storage:** local Postgres on the host PC. The api-server's
  `ensureFullSchema()` (alias for the back-compat `ensureLanAuthSchema`)
  is called on every boot and idempotently creates `lan_users`,
  `lan_sessions`, `audit_log`, `wings`, `bases`, plus the wing/base FK
  columns on `lan_users`. Domain tables (pilots, sorties, monthly
  reports, schedule rows) ship through the legacy migration runner the
  host scripts apply on first install.
- **Auth:** username + password. Passwords stored as bcrypt(12) hashes.
  Sessions are server-side rows in `lan_sessions` with a token returned
  to the dashboard. There is no JWT, no refresh token, no recovery
  code, no TOTP. Password resets happen on the host PC via
  `scripts/lan-host/reset-admin-password.ps1`.
- **Authorization:** `artifacts/api-server/src/lib/lan-authz.ts` enforces
  per-route role + squadron checks. Multi-tier scopes (commander_wing,
  commander_base) are scaffolded; UI for managing wings/bases lands
  incrementally.
- **Audit:** every write route calls `appendInternalAudit()`. When the
  request has no resolved LAN user (dev-no-auth mode or pre-bring-up
  bootstrap), the row is tagged `actor_unknown:true` so an operator can
  grep for un-attributed writes.
- **Networking:** every dashboard PC uses `VITE_INTERNAL_API_URL` to
  reach the host. Production default is the mDNS name
  `http://hawk-host.local:3847` so re-IPing the host doesn't brick
  every install. There are zero external HTTP calls in production code.
- **Auto-update:** disabled by default. `RJAF_ENABLE_AUTO_UPDATE` must
  be explicitly set to `1` to enable polling, which only makes sense if
  the squadron explicitly opts in to a cloud-hosted update channel.

## Operator workflow

The host PC operator (a non-developer base IT person) runs a single
PowerShell script and follows the runbook:

1. `scripts/lan-host/first-time-setup.ps1` — interactive wizard that
   creates the Postgres DB, writes both `.env.production` files, boots
   the api-server briefly so `ensureFullSchema()` lays out tables,
   mints the first super_admin, and registers the api-server +
   nightly-backup scheduled tasks.
2. `OPERATOR-RUNBOOK.md` — the day-to-day guide: install/start/backup/
   restore/reset/USB-update steps in plain language.
3. `scripts/lan-host/reset-admin-password.ps1` — when an operator
   forgets their password.

## Production safety defaults

- `VITE_LAN_NO_AUTH=0` in `.env.production`. Setting this to `1`
  bypasses all login and is for single-engineer dev boxes only.
- `HAWK_INTERNAL_SESSION_AUTH=required` in
  `artifacts/api-server/.env.lan.example`. Setting this to `optional`
  is only safe during the first-boot bootstrap window before any
  super_admin exists.
- `webSecurity: false` is set on the Electron main BrowserWindow because
  the dashboard loads from `file://` (the packaged renderer) and needs
  to issue plain `fetch()` calls into the LAN api-server without CORS
  preflight games. This is acceptable in the LAN threat model — the
  client and server live on the same private RFC1918 network behind a
  base firewall; there is no third-party origin to defend against.
  Documented and reviewed in `OPERATOR-RUNBOOK.md`.
- The title bar shows the build version + git short hash so support can
  unambiguously identify which build a given install is running.

## What was removed in this build

- `artifacts/pilot-dashboard/supabase/` (entire migrations + edge
  functions tree).
- `@supabase/supabase-js` npm dependency.
- TOTP / recovery-code surfaces (`lib/totp.ts`,
  `components/RecoveryCodesLowBanner.tsx`, `components/ui/input-otp.tsx`,
  every 2FA i18n key, every `requires2fa` / `pendingTotp` /
  `recoveryCodes*` AuthCtx field, the 2FA UI in Login + Security +
  Reminders + ReminderLog).
- Cloud-only docs (`SUPABASE_HEALTH.md`, `HANDOFF.md`).

`artifacts/pilot-dashboard/src/lib/supabase.ts` is preserved as a
no-op stub so legacy call sites still type-check; new code MUST NOT
introduce additional `supabase.X` reads.

## Repo conventions

- pnpm monorepo, TypeScript strict, contract-first OpenAPI + Orval
  codegen for new server routes (legacy routes are hand-written).
- `scripts/lan-host/*.ps1` are the only blessed surface for host PC
  side-effects. Do not invent ad-hoc one-shot scripts.
- Audit-log writes MUST go through `appendInternalAudit()` (server) or
  `recordAuditEvent()` / `postInternalAuditLog()` (dashboard) so the
  `actor_unknown` flag is consistently applied.

## User preferences

- Communication style: every change explained.
- Workflow: iterative.
- Data preservation: existing pilots, sorties, monthly summaries, ops
  accounts and squadron settings MUST survive every release.
- Code changes: pre-existing TypeScript errors stay untouched unless
  directly related to the current task.
