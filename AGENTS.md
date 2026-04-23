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

1. **`replit.md`** — full project overview, brand assets, and the **Domain Logic Memory** protocol.
2. **`.local/memory/README.md`** + the matching file in `.local/memory/` for the area you're touching. **These are the operator's settled rules — never re-decide them, never guess from code alone.**
3. **`.local/HAWK-EYE-OVERNIGHT-MASTER-REPORT.md`** — what was built, every version v1.1.75→present, what the simulation harness covers.

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

## Safety nets you can run any time

| Command | What it checks |
|---|---|
| `node .local/tests/rls-policy-audit.mjs` | Scans every public.* policy for the WITH-CHECK gap. Exit 0 = safe, 1 = problem, names the table. |
| `node .local/tests/cross-pc-e2e.mjs` | Runs the full Squadron→Wing→Base→HQ chain + messages across the live Supabase. ~30 checks. |
| `node .local/tests/guest-pilot-e2e.mjs` | Hosting Ops → Home Ops guest-pilot handoff (pending → accept/reject/edit/backfill). 8 checks. |
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
