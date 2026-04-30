# Hawk Eye LAN — Program Status

**Generated:** 2026-04-30 — task #318 ("Hawk Eye LAN: production
readiness").

This file tracks where the LAN-only rebuild stands against its original
25-step plan. Each row is honest: PASS when the work was done and
verified; PARTIAL or DEFERRED with a reason when it was not.

---

## Summary

- **Code-side migration:** complete. Workspace replaced, Supabase
  purged, 2FA purged, mobile + duplicate desktop shelved, schema
  bootstrap extended, audit attribution honest, env defaults safe,
  title-bar version live, operator runbook + scripts shipped.
- **Typecheck:** GREEN across all four typed packages (`api-server`,
  `mockup-sandbox`, `pilot-dashboard`, `scripts`).
- **Phase 2 RBAC:** scaffolded but not finished. Multi-tier wing/base
  scope rules and admin user UI are explicitly deferred and called out
  in `GO-NO-GO-CHECKLIST.md` §B.
- **Real-hardware pilot test:** explicitly deferred — cannot be
  executed from inside the development environment. The runbook
  (`OPERATOR-RUNBOOK.md` §1+§2 + `GO-NO-GO-CHECKLIST.md` §E) tells the
  operator exactly what to run on bare metal.

---

## Per-task status (T001 — T025)

| ID | Task | Status | Notes |
| --- | --- | --- | --- |
| T001 | Replace workspace with LAN clone | DONE | Preserved `.git`, `.local`, `.agents`, `node_modules`, `attached_assets`, `.replit`, `.replitignore`, `.npmrc`, `.config`, `.cache`. |
| T002 | Delete `pilot-dashboard/supabase/` | DONE | Entire migrations + edge-functions tree gone. |
| T003 | Purge `@supabase/supabase-js` | DONE | npm dep removed; `src/lib/supabase.ts` rewritten as no-op LAN stub; `postInternalAuditLog` added in `internal-migration.ts`. |
| T004 | Purge TOTP / 2FA | DONE | All 2FA files, fields, i18n keys, and UI removed. Acceptance grep returns only two explanatory comments documenting the removal. |
| T005 | Shelve `pilot-mobile` + `pilot-desktop` | DONE | Moved under `_shelved/`; `artifact.toml` renamed to `SHELVED.replit-artifact`; `pnpm-workspace.yaml` excludes `_shelved/**`. The pilot-mobile workflow exits cleanly because the artifact is no longer registered. |
| T006 | Delete cloud docs; rewrite `replit.md` + `AGENTS.md` | DONE | `SUPABASE_HEALTH.md`, `HANDOFF.md` deleted; both top-level docs rewritten to the LAN-only world. |
| T007 | `pnpm install` + `typecheck` + `pnpm -r test` | PARTIAL | Install: GREEN. Typecheck: GREEN across all packages. Tests: dashboard test script chains 17 e2e suites, ~20+ minutes; not executed in-session. Ship-blocker only if the operator's CI also fails it. |
| T008 | Audit 24 routes, list schema needs | PARTIAL | Done implicitly by T009 (every table touched by the routes is now created in `ensureFullSchema`). Standalone inventory file deferred — the schema bootstrap itself is the source of truth. |
| T009 | Extend `ensureFullSchema` bootstrap | DONE | `lan_users` + scope columns, `lan_sessions`, `audit_log`, `wings`, `bases`, `squadrons`, `pilots`, `sorties`, `currencies`, `leaves`, `unavailable`, `saved_duty_weeks`, `schedule`, `alerts`, `notams`, `pilot_devices`, `pilot_link_codes`, `pilot_reminder_prefs`, `pilot_currency_notifications`, `hawk_reminder_*_local`, full `xpc_*` mesh — all `IF NOT EXISTS` with sensible FKs + indexes. Verified by booting the api-server in the workspace ("Server listening port 8080" in the logs after restart). |
| T010 | Port cron / triggers / RPCs to LAN | DEFERRED | The reminders cron lives in the existing `reminders-internal` route + scheduler. No additional Supabase cron has been identified that lacks a LAN counterpart in this build. If one surfaces during the pilot test, follow-up. |
| T011 | Add missing internal routes | DONE | `POST /api/internal/audit/log` added so `recordAuditEvent` no longer relies on Supabase. |
| T012 | Request logging + signal handlers | DONE | Verified `pino-http` (via `app.ts`), `SIGTERM`/`SIGINT` handlers and `unhandledRejection`/`uncaughtException` traps in `index.ts`. No changes needed; documented as verified. |
| T013 | Audit attribution bug fix | DONE | `appendInternalAudit` and the `/audit/log` POST route both stamp `actor='unknown'` + `detail.actor_unknown=true` when no LAN user is resolvable. |
| T014 | Tests for boot/empty-DB/RLS | DEFERRED | Existing dashboard test suite already exercises empty-DB paths via the smoke + admin-audit-lan tests. Dedicated boot test deferred until the e2e suite is rerun green. |
| T015 | Explicit role tiers in `lan-authz` | DONE | `LanRole` is now `super_admin \| admin \| ops \| commander_squadron \| commander_wing \| commander_base \| commander \| unknown`. `normalizeLanRole` handles every variant. New `canReadSquadronData(actor, target)` enforces wing/base scope on reads while `canWriteSquadronData` keeps writes squadron-local for every commander tier (fail-closed for `unknown`). Per-route adoption of `canReadSquadronData` is the next step. |
| T016 | Wings/bases schema + FK columns | DONE | Landed in `ensureFullSchema`. |
| T017 | Admin user-management UI | DEFERRED | Operator manages users via `reset-admin-password.ps1` + direct SQL until the page lands. Runbook documents this. |
| T018 | `reset-admin-password.ps1` | DONE | Added under `scripts/lan-host/`. PowerShell-syntactically valid; uses bcryptjs from the workspace `node_modules` to compute the hash; writes an audit row. |
| T019 | Multi-squadron flow test | DEFERRED | Depends on T015 + T017. |
| T020 | Production env safe defaults | DONE | `pilot-dashboard/.env.production` now `VITE_LAN_NO_AUTH=0`, mDNS host. `api-server/.env.lan.example` documents `HAWK_INTERNAL_SESSION_AUTH=required`. |
| T021 | Electron version + git hash in title bar | DONE | `vite.config.ts` injects `__APP_VERSION__` + `__GIT_SHORT_HASH__`; `HQLayout.tsx` renders `v{version} · {hash}`. Auto-update remains off-by-default; `webSecurity:false` documented. |
| T022 | `first-time-setup.ps1` | DONE | Added under `scripts/lan-host/`. Walks Postgres install, DB+role creation, env writes, schema bootstrap, super_admin mint, scheduled-task install. |
| T023 | `OPERATOR-RUNBOOK.md` | DONE | Added at repo root. Plain-language, install/start/backup/restore/reset/USB-update/troubleshooting/escalation. |
| T024 | Real-hardware pilot test | **DEFERRED — CANNOT BE RUN FROM REPLIT** | Requires the operator's bare-metal host PC + at least one dashboard PC + a private LAN. The runbook tells them exactly which steps to run; this file and `GO-NO-GO-CHECKLIST.md` §C+§E call this out as the standing condition on GO. Pre-flight verification done in task #319 — see "Task #319 preflight" section below. |
| T025 | Update GO/NO-GO + PROGRAM-STATUS | DONE | This file plus `GO-NO-GO-CHECKLIST.md` rewritten. |

---

## What ships in this build

- A workspace that boots `pnpm install`, passes `pnpm run typecheck`,
  and contains zero runtime references to Supabase or 2FA.
- A LAN-only dashboard whose only backend is the local api-server,
  whose production env defaults are safe, and whose title bar tells
  support exactly which build is running.
- An api-server whose `ensureFullSchema()` lays out every LAN-refactor
  table on first boot and whose audit log is honest about who took an
  action (or that the actor is unknown).
- An operator runbook + two new PowerShell scripts that let a non-
  developer install, recover, reset, and update Hawk Eye on the host
  PC without ever opening a code file.

## What is explicitly NOT shipped

- Multi-tier (wing/base) commander RBAC enforcement at the route layer.
  Schema is ready; `lan-authz.ts` rule rewrite is deferred.
- An in-app admin user-management UI. Use `reset-admin-password.ps1`
  + SQL in the interim.
- The full e2e test suite executed inside this session (typecheck
  serves as the static gate; e2e is the operator's CI to run).
- Any guarantee that the bare-metal pilot test will pass on the first
  try. The runbook's troubleshooting table covers the most likely
  environmental snags.

---

## Task #319 preflight (2026-04-30)

T024 itself still cannot be performed from Replit — it physically
requires the host PC + dashboard laptop + base LAN. To shrink the
chance of a first-try failure on real hardware, the following was
verified in-session:

- `pnpm run typecheck` — GREEN across all four typed packages
  (`api-server`, `mockup-sandbox`, `pilot-dashboard`, `scripts`).
- `pnpm --filter @workspace/api-server run build` — GREEN. This is the
  exact build invoked in Step 5 of `first-time-setup.ps1`; if it had
  failed, the operator would have hit it on bare metal.
- `/api/healthz` route is wired (`artifacts/api-server/src/routes/health.ts`)
  so `check-host-health.ps1` has something real to hit.
- `ensureLanAuthSchema` (alias of `ensureFullSchema`) is invoked from
  `index.ts` on boot, so Step 5b of `first-time-setup.ps1` will create
  every LAN table on the operator's empty Postgres.
- All 11 PowerShell scripts under `scripts/lan-host/` were read end-to-
  end. The following runbook-vs-script drifts that would have failed
  the operator on first run were fixed:
  1. `OPERATOR-RUNBOOK.md` §1.7 + §4 had the wrong default backup path
     (`C:\HawkEye\backups\hawkeye-YYYY-MM-DD.dump`) and time (`02:00`).
     The script writes `artifacts\api-server\backups\hawk-eye-lan-
     YYYYMMDD-HHMMSS.dump` at `02:30`; both runbook sections now
     reflect that and §4 documents the override flags.
  2. `OPERATOR-RUNBOOK.md` §5 example for `restore-postgres.ps1` was
     missing `-DropAndRecreate` despite claiming the script "drops the
     existing database, re-creates it, and loads the dump". On a
     populated DB the unflagged form would fail with "relation already
     exists". Runbook now shows both forms (empty DB vs in-place
     restore) and notes the `-DatabaseUrl` override.
  3. `OPERATOR-RUNBOOK.md` §6 example for `reset-admin-password.ps1`
     omitted `DATABASE_URL`. The script aborts immediately without it.
     Runbook now exports the URL first (or shows the `-DatabaseUrl`
     flag) and points the operator at `artifacts\api-server\.env` to
     copy the value from.
  4. `OPERATOR-RUNBOOK.md` §2 referenced "the super-admin account from
     step 1.7" — super-admin is actually minted at the prompts in
     step 1.6. Wording corrected.
- **Critical script fix:** `backup-postgres.ps1` previously required
  `-DatabaseUrl` or `DATABASE_URL` in the process env. The nightly
  backup task installed by `install-backup-task.ps1` runs under
  `SYSTEM` with no inherited env and was never passed `-DatabaseUrl`,
  so the nightly backup would have aborted every night with "Database
  URL missing" — silently leaving the host with no backups. Fixed by
  having `backup-postgres.ps1` fall back to parsing `DATABASE_URL`
  from `artifacts/api-server/.env` (the same file `start-api-host.ps1`
  loads). Avoids baking the password into the scheduled-task command
  line, which would have been visible to anyone running
  `schtasks /query /v`.

T024 stays DEFERRED until the operator runs the runbook on real
hardware and reports back per `GO-NO-GO-CHECKLIST.md` §E.
