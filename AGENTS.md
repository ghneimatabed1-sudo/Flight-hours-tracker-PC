# AGENTS.md — READ THIS FIRST

> **You are an AI agent (Replit Agent, Cursor, Claude Code, Aider, Cline, anything).**
> **This file is the 60-second briefing. Read it in full before touching any code.**
> If you skip it, you will repeat bugs that have already cost the operator time.

---

## What this project is

**Hawk Eye** (Arabic: عين الصقر) — flight-hours management system for the **Royal Jordanian Air Force (RJAF)**.
- **In production at NO.8 SQDN, King Abdullah II Airbase.** Real pilots, real sorties, real money.
- **pnpm monorepo** with three artifacts:
  - `artifacts/pilot-dashboard/` — React + Vite + Electron Windows desktop app (the main product, ~95% of complexity).
  - `artifacts/pilot-mobile/` — Expo React Native app for individual pilots.
  - `artifacts/api-server/` — small Express helper.
- **Backend:** Supabase (Postgres + REST + Auth). Project ref derived from `SUPABASE_URL`. Service-role key + Mgmt API token are in env.
- **Releases:** PC `.exe` published automatically by GitHub Actions to the **public** repo `Flight-hours-tracker-Releases`. Installed PCs auto-update by polling that repo. Source repo is `Flight-hours-tracker-PC`.
- **Designed for zero maintenance** across 15-20+ squadrons surviving personnel turnover. Operator wants to never have to babysit it.

## Mandatory reading before any change

1. **`DOMAIN.md`** — what every page, role, report, and number actually means in operational terms (Squadron Cmdr vs Wing Cmdr vs Base Cmdr, Monthly Report Forms 1-4, sortie definition, hour calculation, schedule chain, guest pilots, currency rules). **The functional encyclopedia.**
2. **`replit.md`** — full project overview, brand assets, and the **Domain Logic Memory** protocol.
3. **`.local/memory/README.md`** + the matching file in `.local/memory/` for the area you're touching. **These are the operator's settled rules — never re-decide them, never guess from code alone.**
4. **`.local/HAWK-EYE-OVERNIGHT-MASTER-REPORT.md`** — what was built, every version v1.1.75→present, what the simulation harness covers.

## Absolute do-nots (each one has bitten us; don't relearn)

1. **Never test RLS policies with the service-role key.** Service role bypasses RLS, so every test passes and every real user fails. Use the anon key + a real signed-in session, OR use the audit script (below).
2. **Never write an UPDATE/ALL RLS policy without an explicit `WITH CHECK`.** Postgres silently reuses `USING` for the new row → "new row violates row-level security policy" (error 42501) the moment any UPDATE changes a column referenced by USING. Real bug, v1.1.89, took down all schedule-forwarding for every role. Default to `with check (true)` and let application code (in `src/lib/cross-pc.ts`) gate transitions.
3. **Never use `psql "$DATABASE_URL"` for migrations.** `DATABASE_URL` points to the Replit-local Postgres, NOT Supabase. **Apply migrations via the Supabase Management API:**
   ```js
   const REF = process.env.SUPABASE_URL.match(/https:\/\/([^.]+)/)[1];
   await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
     method: "POST",
     headers: { Authorization: `Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
     body: JSON.stringify({ query: sql })
   });
   ```
4. **Never bump the dashboard version manually expecting it to drive a release.** The CI workflow `dashboard-windows-installer.yml` auto-bumps the patch above the latest published release. Just push to `main` — bump only if you intentionally want a minor/major bump.
5. **Never edit `artifact.toml` or `.replit` directly** — use the artifact skills.
6. **Never hardcode squadron names.** Every operator deploys their own squadron. The system is squadron-portable; preserve that.
7. **Never delete data without an explicit operator request.** Even "looks orphaned" rows might be backups for a PC that's been offline.
8. **Never let `DOMAIN.md` go stale.** It is a contract with the operator. After ANY change that affects what a page does, what a role sees, what a number means, what a report contains, or how a flow works (schedule chain, guest pilots, currency, sortie fields, hour calc, role permissions, menu items, etc.) — open `DOMAIN.md` in the same change, update the affected section, and commit it together with the code. Same applies to `.local/memory/<area>.md` for the area touched. Documentation drift is a bug.

## Safety nets you can run any time

| Command | What it checks |
|---|---|
| `node .local/tests/rls-policy-audit.mjs` | Scans every public.* policy for the WITH-CHECK gap. Exit 0 = safe, 1 = problem, names the table. |
| `node .local/tests/cross-pc-e2e.mjs` | Runs the full Squadron→Wing→Base→HQ chain + messages across the live Supabase. ~30 checks. |
| `node .local/tests/guest-pilot-e2e.mjs` | Hosting Ops → Home Ops guest-pilot handoff (pending → accept/reject/edit/backfill). 8 checks. |
| `pnpm --filter @workspace/pilot-dashboard exec tsx supabase/tests/test-pilot-transfer-rpc.ts` | Inter-squadron pilot transfer via the `transfer_pilot` RPC (migration 0053). Asserts pilot + sorties + currencies/leaves/unavailable/link_codes/devices all re-home, paired audit rows land, authority gate rejects foreign-squadron callers, super-admin works from anywhere, and the UI predicates from `pilot-transfer-policy.ts` (the same module Roster.tsx + PilotDetail.tsx import) still match. 11 checks. |
| `pnpm --filter @workspace/pilot-dashboard exec tsx .local/tests/full-simulation.ts` | 11-surface calculation engine simulation. ~115 checks. |

**After any change that touches RLS, schema, or cross-PC code, re-run the relevant tests above.**

## Architecture in 6 lines

- Each Squadron PC = one Electron app, talks to Supabase with the **anon key** + a Supabase Auth session bound to that PC's claimed `pc_id`s.
- `xpc_my_pc_ids()` returns the array of `pc_id`s the signed-in user owns; every cross-PC RLS policy references it.
- Schedule chain: row in `xpc_schedule_shares` with `current_tier` and `current_pc_id` moves through Squadron → Wing → Base → HQ; statuses: `draft|submitted|reviewed|approved|rejected|held|edited`.
- Messages: `xpc_messages` between any two PCs; archive after 3 months by `purge_archived_messages()`.
- Guest pilots: hosting squadron logs sortie → row in `xpc_pending` with `home_squadron_id` → home Ops sees pending → accepts → hours flow into home pilot's totals via `computePilotTotals()`.
- 4 daily Supabase pg_cron jobs (purge inactive PCs, archived messages, dead link codes, audit log) — see migration `0032_retention_cleanup_jobs.sql`.

## When in doubt

- **Ask the operator** before any destructive action, before changing settled domain rules, or before re-architecting.
- **Speak plain English** in chat (the operator is non-technical). Save jargon for code comments.
- **Update `replit.md`** for architecture changes. **Update or create a `.local/memory/<area>.md`** for any new domain rule the operator settles. **Append to this file** for any new "do not" you learn the hard way.

---

## Memory-update protocol — do this WITHOUT being asked

Every commit that changes behaviour MUST also update memory in the same commit. The operator should never have to say "update your memory". Treat this as part of the work, not a follow-up.

**Checklist before every `git commit`:**
1. Did this change affect what a page does, what a role sees, what a number means, what a report contains, or how a flow works? → Open **`DOMAIN.md`** and update the matching section. Add a "v1.x.xx — what changed" line in the relevant subsection if the contract moved.
2. Did this change settle a new operator-stated rule, fix a previously-mysterious bug, or alter a settled feature? → Open or create **`.local/memory/<area>.md`** and append a Change Log entry with the date.
3. Did this change introduce a new "do not" the next agent must avoid? → Append it to the **Absolute do-nots** list in this file (with the version that introduced the lesson).
4. Did this change touch architecture (new tables, new tiers, new artifacts, new external services)? → Update **`replit.md`** Architecture section.
5. Are migrations involved? → Add the migration number + one-line summary to the **Recent fixes** list below.

**Default commit-message footer template (use it):**
```
DOMAIN.md updated: §X.Y (or N/A — explain why)
.local/memory/<area>.md updated: yes (or N/A — explain why)
AGENTS.md do-nots updated: yes (or N/A — explain why)
```

If any of those four say N/A, that's fine — but you must consciously decide N/A, not silently skip.

---

## Recent fixes — concrete lessons (most recent first)

### v1.1.126 (2026-04-25) — Super Admin overview de-mocked + role-hardening audit artifacts
- `src/pages/admin/Overview.tsx` no longer imports seed `mockData.pilots` / `mockData.licenseKeys`; it now reads pilot counts + expiry status from `usePilots()` (shared data layer) so the Super Admin overview reflects live squadron state instead of local seed drift.
- Added audit evidence + role-flow matrix under `audit-evidence/2026-04-25/full-role-reliability/` as the baseline for future role-regression passes.
- **Lesson:** any admin surface that summarizes operational state must consume the same Supabase-backed hooks as ops/commander pages; seed arrays are acceptable only for explicit demo-only paths.

### v1.1.96 (2026-04-23) — Wing→Base forward + Base.approve final archive
- Operator-stated chain (DOMAIN.md §7.1) is now wired end-to-end: ops→sqn→wing→base→base.approve = final archive. Wing.approve without Base forward is also valid (saves the day for that squadron).
- The Wing→Base forward UI was already in `ScheduleChain.tsx:651-700`; the only blocker was a `throw` in `cross-pc.ts:1659` saying "Wing tier shares are terminal". Removing it opened the path.
- **Lesson:** before adding new UI, search for what's already wired. The UI was complete a release earlier and just needed the back-end transition unblocked.

### v1.1.95 (2026-04-23) — Bulletproof RLS + audit_log was the real killer
- The persistent 42501 the operator kept hitting after Wing edit-bounce was NOT the schedule_shares policy — it was the `audit_log` INSERT policy. `audit_log WITH CHECK` required `squadron_id = squadron_id()`, where `squadron_id()` reads `app_metadata.squadron_id` from the JWT. Wing-tier and most ops users have no such claim → function returned NULL → comparison flipped to NULL → treated as FALSE → 42501. The audit insert fires immediately AFTER the schedule update inside `useDecideSchedule`, so the failure surfaced as if the schedule write had been rejected.
- Migration `0036_xpc_bulletproof_rls.sql`: dropped sentinel guards on all `xpc_*` WITH CHECK; relaxed `audit_log` INSERT WITH CHECK to bare `auth.uid() IS NOT NULL`.
- `recordAuditEvent()` now swallows + logs failures so audit problems can never again masquerade as a real-action failure.
- **Lesson:** when an action does N writes and ONE fails, the user's toast names the LAST failed table — but the FIRST failure could be N-1 steps earlier. Always trace every write in a mutation, not just the named one. And audits must NEVER throw.

### v1.1.94 (2026-04-23) — Universal autoclaim trigger across xpc_* tables
- Migration `0035_xpc_universal_autoclaim_rls.sql`: BEFORE INSERT/UPDATE triggers on `xpc_schedule_shares`, `xpc_messages`, `xpc_pending`, `xpc_squadron_snapshot` auto-claim the actor's PC seat in `xpc_user_pcs` so the row is immediately visible to them via `xpc_my_pc_ids()`.

### v1.1.93 (2026-04-23) — Initial robust insert (was insufficient on its own — see 1.1.95)
- Migration `0034_robust_schedule_insert_rls.sql`: first attempt at autoclaim. Necessary but not sufficient — see v1.1.95 for the real root cause.

**When you ship a new version, append a short entry above. This list is the running changelog the next agent reads first.**
