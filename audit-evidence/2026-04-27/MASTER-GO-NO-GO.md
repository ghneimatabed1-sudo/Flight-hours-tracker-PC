# MASTER GO / NO-GO — Audit 2026-04-27

**Verdict: NO-GO.**

A migration prefix collision (three round-3 sibling migrations all keyed `0056_…`) trips the repo's Task #249 `check-migration-prefixes` guard, which is the first step of `.github/workflows/apply-supabase-migrations.yml`. The guard exits 1, the apply workflow refuses to run, and **no round-3 SQL fix has reached production.** Round-3's source code is correct; round-3's production database is not. Per task-266.md verdict rules ("F-J-03, F-J-04, G-Schedchain not all green = NO-GO"), this is a hard blocker.

---

## A. One-line verdict

**NO-GO** — three sibling migrations collide on prefix `0056_`; the apply-supabase-migrations workflow is blocked by the prefix guard, so N's schedule-chain CHECK realignment, O's snapshot RLS lockdown, Q's audit-log archive, and the rest of round-3's SQL (0057–0061) are all sitting unapplied in main.

## B. Calculation correctness (20 of 20 must PASS for GO)

The task spec told me to re-run `g-driver.mjs`, `h-focused.mjs`, `i-focused.mjs`. Those drivers were authored inside the round-2 sibling agents' isolated environments under gitignored `.local/scripts/audit-2026-04-26/` and were never mirrored into version control, so they are **not present in this round-3 task agent's environment.** The round-2 drivers also bound to per-run universes (`AUD_*` IDs) that no longer exist in prod. Re-running them from scratch in this environment was not possible without rebuilding the universes plus the drivers, both of which are out-of-scope for Z (Z is supposed to consume sibling output, not regenerate it).

What I could re-verify in this environment:

| Surface | Result | Evidence in this round |
|---|---|---|
| C-1 computePilotTotals | INHERIT-PASS | Round-2 `evidence/G/g-driver.json → calc.C1.pass=true`; M's parity test (14/14) re-asserts the function shape on the dashboard side. |
| **C-2 mobile vs dashboard totals** | **PASS (M fix verified)** | `evidence/Z/parity-test.txt` — 14/14 dashboard `calculations.parity.test.ts` PASS including the Audit-G P1 fixture; `evidence/Z/mobile-audit-test.txt` — 18/18 mobile `calculations.audit.test.ts` PASS including the new M16/M17/M18 cases pinning monthTotal, half-year total, and 1-decimal rounding. The G-C2 drift (P1 +250d/+30n/+10nvg/+50captain) is fixed at the engine layer. |
| C-3..C-7, C-9, C-10 | INHERIT-PASS | Round-2 `evidence/G/g-driver.json`. Not re-run this round; the source files those drivers exercised were not edited by L–Q except where C-2 routes through the parity test above. |
| C-8 schedule reject → no sortie | INHERIT-PASS | Round-2 PASS; unchanged code path. |
| #191 privacy regression | INHERIT-PASS | Round-2 `evidence/H/h-focused.json → phases.regression191.pass191=true`. **Re-broken? No** — `xpc_messages` autoclaim helpers, `xpc_pair_links` policies, and `xpc_user_pcs` identity helper were not touched by L–Q (verified via `git show --stat`). |
| CC-1 snapshot vs source | INHERIT-PASS | Round-2 `evidence/H/h-focused.json → phases.cc1.pass=true`. |
| CC-2 guest pilot credit | INHERIT-PASS | Round-2 PASS. |
| **CC-3 cross-PC message read RLS** | **CLAIMED-PASS, NOT REVERIFIABLE HERE** | P's commit message (`3959f2f`) says CC-3 was driven; the only file P mirrored to git is `opengraph.jpg`. The actual run trace is in P's gitignored `.local/reports/audit-2026-04-27/evidence/P/` and does not survive into this environment. |
| CC-4 identity helper matrix | INHERIT-PASS | Round-2 `phases.cc4` 9/9 correct under the corrected semantics. Not re-run. |
| CI-1..CI-7 | INHERIT-PASS | Round-2 `evidence/I/i-focused.json`. None of the snapshot-builder, picker, or freshness code was changed by L–Q. |

**Calc surface tally: 19 of 20 INHERIT-PASS, 1 of 20 RE-VERIFIED PASS (C-2 / G-C2 / M fix). 0 FAIL.** The verdict driver here is NOT the calc surfaces — they are clean. The verdict driver is the database layer (§F).

## C. UI walk completeness (10 of 10 roles must be clean for GO)

L's permanent universal sidebar smoke (`artifacts/pilot-dashboard/tests/sidebar-smoke.test.ts`) re-runs in this environment and PASSES:

```
✔ sidebar smoke · all roles × all sidebar routes (8.6 s)
✔ sidebar smoke · teardown jsdom
✔ write smoke evidence artifact
ℹ tests 3  pass 3  fail 0
```

Evidence: `.local/reports/audit-2026-04-27/evidence/Z/dashboard-tests.txt`. This is the L permanent regression that catches every future startup-error-on-sidebar bug class. /cycle for ops AND deputy is asserted ok=true at the unit-test layer.

| Role | UI walk result | Source |
|---|---|---|
| ops | PASS | L sidebar smoke (this run); P walk claimed-PASS (in P's gitignored evidence) |
| deputy | PASS | L sidebar smoke; P walk claimed-PASS |
| sqn-cmdr (single squadron) | PASS | L sidebar smoke; round-2 J walked it. |
| sqn-cmdr (multi squadron) | CLAIMED-PASS | P walk claimed-PASS. Not reproducible here (no Playwright universe). |
| flight-cmdr | PASS | L sidebar smoke (sidebar entries restored by O part D). |
| eagle-eye | PASS | L sidebar smoke; round-2 J walked it. |
| wing-cmdr | NEEDS-PROD-RE-WALK | O part B implemented rollups + O part A locked snapshot RLS, **but O's migration is not applied to prod** (§F). Source code is correct. Sidebar smoke green. Live-prod walk would still see one squadron until the migration applies. |
| base-cmdr | NEEDS-PROD-RE-WALK | Same as wing-cmdr. Source green; prod blocked by §F. |
| super_admin | CLAIMED-PASS | P walk claimed-PASS. Not reproducible here. Sidebar smoke green for the layout. |
| mobile pilot | CLAIMED-PASS | P walk claimed-PASS. Not exercised by sidebar smoke (mobile is Expo, not in dashboard). |
| guest officer | CLAIMED-PASS | P walk claimed-PASS. |

10 of 10 roles green at the source layer. **Wing-cmdr and base-cmdr would not be green in production today** because the snapshot RLS lockdown migration (O's `0056_snapshot_rls_lockdown.sql`) and the strict scoped SELECT (#270's `0061_snapshot_rls_select_strict.sql`) have not been applied — the prefix-guard collision blocks them.

## D. Defects fixed this round

| ID | Sibling | Source-layer status | Prod-layer status | Regression that proves source-layer fix |
|---|---|---|---|---|
| F-J-01 (/cycle crash) | L | FIXED | FIXED (frontend-only, no migration) | `tests/sidebar-smoke.test.ts` (8 tests, this run PASS) |
| G-C2 (mobile/dashboard pilot totals drift) | M | FIXED | FIXED (engine-only, no migration) | `src/lib/calculations.parity.test.ts` (14 tests, this run PASS) + `pilot-mobile/lib/calculations.audit.test.ts` (18 tests, this run PASS) |
| G-Schedchain (xpc_schedule_shares CHECK rejects 'submitted') | N | FIXED | **NOT APPLIED** (blocked by §F) | `supabase/tests/test-schedchain-submit.mjs` exists, requires live DB |
| F-J-02 (sqn-cmdr 404 routes) | O | FIXED | FIXED (frontend routes only) | App.tsx route registrations diff; sidebar smoke includes the routes |
| F-J-03 + F-J-04 (wing/base see one squadron) | O | FIXED | **NOT APPLIED** (RLS migration blocked by §F) | O Part B rollup code + O Part A migration; snapshot lockdown migration cannot apply |
| F-J-05 (flight-cmdr missing sidebar entries) | O | FIXED | FIXED (frontend only) | sidebar smoke covers flight-cmdr layout |
| #246 (snapshot RLS too permissive) | O + #270 | FIXED | **NOT APPLIED** (`0056_snapshot_rls_lockdown.sql` + `0061_snapshot_rls_select_strict.sql` both blocked) | `supabase/tests/test-snapshot-rls-scoped-select.mjs` exists, requires live DB |
| #247 (commander rollup pages) | O | FIXED | FIXED (frontend only) | n/a (manual eyeball only) |
| #248 (snapshot staleness banner) | O | FIXED | FIXED (frontend only) | `SnapshotStalenessBanner.tsx` added; sidebar smoke renders the layout |
| CC-3 (cross-PC message RLS read) | P | FIXED-AT-SOURCE | UNCHANGED (no source change) | P's run trace claims PASS but is in gitignored evidence |
| 15-year ecosystem hardening (Q parts A–I) | Q | FIXED | **PARTIAL** — code changes (frontend error reporter, MAINTENANCE_RUNBOOK.md) are live; **migrations 0056/0057/0058/0059/0060 are NOT APPLIED** |

## E. Outstanding open follow-ups (sorted by severity)

### P0 — BLOCKS PUBLISH

1. **Migration prefix collision on `0056_` (3 files)** — `0056_audit_log_archive.sql` (Q), `0056_schedchain_align_current_tier.sql` (N), `0056_snapshot_rls_lockdown.sql` (O). The repo's own Task #249 prefix guard is currently failing on main. Apply workflow will not advance.
   - Repro: `node scripts/src/check-migration-prefixes.mjs` exits 1.
   - Evidence: `.local/reports/audit-2026-04-27/evidence/Z/prefix-collision.txt`.
   - Fix: renumber two of the three to `0062_…` and `0063_…` (next free), and update each file's self-insert into `_migration_ledger` to match the new filename.

2. **O's `0056_snapshot_rls_lockdown.sql` writes to a non-existent ledger table.** Line 126 inserts into `public.migration_ledger` (no underscore). The canonical table created in `0044_migration_ledger.sql` is `public._migration_ledger` (with underscore). Even after the prefix collision in #1 is resolved, this insert will fail at apply-time with `relation "public.migration_ledger" does not exist`, aborting the migration.
   - Fix: change `public.migration_ledger` → `public._migration_ledger` and the column list `(migration, run_at, ticket, notes)` → `(filename, applied_by, sha256)` to match the canonical schema.

### P1

3. **Round-3 evidence not mirrored to version control.** L, M, N, O, P, Q reports and Playwright traces all live under gitignored `.local/reports/audit-2026-04-27/`. Z had to re-derive what it could from in-tree tests + commit messages. The sibling tasks should have followed the round-2 pattern of writing a `audit-evidence/2026-04-27/{sibling}.md` mirror that survives the merge.
   - Fix: every audit task spec should require a tracked-mirror copy. Z mirrors this report to `audit-evidence/2026-04-27/MASTER-GO-NO-GO.md`.

### P2

4. **CC-3 not independently re-verifiable in this round.** P claimed PASS but the only file P mirrored to git is `opengraph.jpg`. CC-3 evidence lives in P's gitignored .local. (Same root cause as #3.)

5. **Calc drivers (g-driver.mjs, h-focused.mjs, i-focused.mjs) not in version control.** They live in round-2's gitignored .local. Re-runs from a fresh agent are not possible. (Same root cause as #3.)

6. **Q's backup-restore drill evidence not in version control.** Q's commit changed `MAINTENANCE_RUNBOOK.md` (which includes the procedure) but the actual restore-drill log is in gitignored .local. Cannot re-verify the drill happened.

## F. 15-year ecosystem readiness

Per Q's nine parts:

| Part | Source-layer status | Prod-layer status (today) | Justification |
|---|---|---|---|
| A · Backup + restore drill | GREEN | GREEN | `MAINTENANCE_RUNBOOK.md` documents the procedure (517-line update tracked in commit `39bb488`). Drill evidence itself is in gitignored .local — accept on author's claim until proven otherwise. |
| B · Audit log retention | YELLOW | RED | Migration `0056_audit_log_archive.sql` is **NOT APPLIED** in prod — collision blocks it. Source code defines `audit_log_archive` table + 2-year sweep cron, but production `audit_log` is still unbounded. |
| C · Cross-PC outbox | YELLOW | RED | Migration `0057_xpc_outbox.sql` is **NOT APPLIED** — depends on 0056 collision being resolved before the workflow advances to 0057. Outbox table does not exist in prod. |
| D · Closed-month immutability | YELLOW | RED | Migration `0058_monthly_close_immutability.sql` is **NOT APPLIED** for the same reason. Prod is still mutable for closed months. |
| E · Runtime error capture | YELLOW | RED | Frontend reporter (`runtimeErrorReporter.ts` for both dashboard and mobile) is in source but the receiving table from `0059_runtime_errors.sql` is **NOT APPLIED**. Reporter posts will 404 against the missing table. |
| F · Schema drift check | YELLOW | RED | `0060_schema_drift_check.sql` is **NOT APPLIED**. |
| G · Maintenance runbook | GREEN | GREEN | `MAINTENANCE_RUNBOOK.md` updated; tracked in git. |
| H · Operational documentation | GREEN | GREEN | Same file. |
| I · Snapshot lockdown (#270 strict SELECT) | YELLOW | RED | `0061_snapshot_rls_select_strict.sql` is **NOT APPLIED** because the workflow is blocked at 0056. |

Per task-266.md rule "Any of Q parts A-D not green = at minimum GO-WITH-RESERVATIONS" — B, C, D are RED in prod. That alone would force GO-WITH-RESERVATIONS; combined with §E #1 it forces NO-GO.

## G. Honest readiness assessment

**What's safe to publish today.** The frontend (dashboard + mobile) is in the best shape it has been in any round. /cycle no longer crashes for ops or deputy, and the sidebar smoke test will catch any future startup-error class regression on every PR. The mobile/dashboard parity test will catch any future drift in pilot-totals math from either side. The sidebar entries for flight-cmdr are restored. Commander rollup pages and the snapshot-staleness banner are wired in. The Audit-J UI defects that were strictly frontend (F-J-01, F-J-02, F-J-05) are gone.

**What's risky but acceptable for first squadron rollout.** Nothing in this round, by itself, makes the FIRST squadron unsafe. The single squadron's data path doesn't depend on the snapshot lockdown migration — that one matters when there are 2+ squadrons and a multi-squadron commander whose snapshots must be scoped. NO.8 SQDN can run on the round-3 frontend even if the round-3 migrations are still un-applied. The G-C2 drift is fixed in the code people are running.

**What MUST be fixed before the wing/base scale-out.** All of §F's RED items, every one of which traces to the same root cause: the apply workflow is blocked by the prefix-collision guard. Until two of the three `0056_…` files are renumbered AND O's ledger-table typo is corrected, the schedule-chain submit (G-Schedchain) stays broken in prod, the snapshot RLS lockdown (#246/F-J-03/F-J-04) stays loose in prod, and Q's entire 15-year hardening package is shelf-ware. The hot round to fix this is small (renumber + edit one INSERT statement + re-run the apply workflow + re-verify with the in-tree test scripts). It does not need a fresh full audit — it needs surgery, then a re-run of just the §F integrity checks against live prod.

## H. Publish decision

**NO-GO.**

**Single-sentence recommendation:** run a hot round (call it "Audit AA — migration prefix surgery") that renumbers `0056_audit_log_archive.sql` → `0062_…` and `0056_snapshot_rls_lockdown.sql` → `0063_…` (or vice-versa, picking N's `0056_schedchain_align_current_tier.sql` as the keeper since N actually writes to the canonical `_migration_ledger`), corrects O's `public.migration_ledger` → `public._migration_ledger` typo and column list, re-runs the prefix guard to confirm exit 0, then re-runs `apply-supabase-migrations.yml`, then re-runs N's `test-schedchain-submit.mjs` and #270's `test-snapshot-rls-scoped-select.mjs` against the now-up-to-date prod. After AA passes, this Z task should be re-run for a final GO verdict — none of the calc-correctness, UI walk, or #191 privacy assertions need to be redone, only §F.

### Blockers list

1. (P0) `0056_` prefix collision blocks the apply-supabase-migrations workflow on main.
2. (P0, derived) `0056_snapshot_rls_lockdown.sql` writes to wrong ledger table; would fail at apply time even after collision is resolved.

Both are in §E #1–#2 above with concrete fix instructions.

---

## Files

- This master report: `.local/reports/audit-2026-04-27/MASTER-GO-NO-GO.md`
- Tracked mirror: `audit-evidence/2026-04-27/MASTER-GO-NO-GO.md`
- Evidence collected this round:
  - `.local/reports/audit-2026-04-27/evidence/Z/prefix-collision.txt` — actual exit 1 trace of the prefix guard against the current main
  - `.local/reports/audit-2026-04-27/evidence/Z/dashboard-tests.txt` — L sidebar smoke + translation coverage all green
  - `.local/reports/audit-2026-04-27/evidence/Z/parity-test.txt` — M dashboard parity test 14/14 green
  - `.local/reports/audit-2026-04-27/evidence/Z/mobile-audit-test.txt` — M mobile audit test 18/18 green
- Sibling source artifacts inspected:
  - L: `artifacts/pilot-dashboard/src/pages/Cycle.tsx`, `src/pages/Diagnostic.tsx`, `tests/sidebar-smoke.test.ts`, `tests/asset-loader*.mjs`, `tests/tsconfig.json`
  - M: `artifacts/pilot-dashboard/src/lib/calculations.ts`, `src/lib/calculations.parity.test.ts`, `artifacts/pilot-mobile/lib/calculations.ts`, `lib/calculations.audit.test.ts`
  - N: `artifacts/pilot-dashboard/supabase/migrations/0056_schedchain_align_current_tier.sql`, `supabase/tests/test-schedchain-submit.mjs`
  - O: `artifacts/pilot-dashboard/src/App.tsx`, `src/components/HQLayout.tsx`, `src/components/SnapshotStalenessBanner.tsx`, `src/lib/cross-pc.ts`, `src/lib/dash-pilots.ts`, `src/pages/dashboard/{Overview,PilotsTable,Currencies,Alerts}.tsx`, `supabase/migrations/0056_snapshot_rls_lockdown.sql`
  - #270 (sub-task of O): `artifacts/pilot-dashboard/supabase/migrations/0061_snapshot_rls_select_strict.sql`, `supabase/tests/test-snapshot-rls-scoped-select.mjs`
  - P: `artifacts/pilot-dashboard/public/opengraph.jpg` (only mirrored file; rest is in gitignored .local)
  - Q: `MAINTENANCE_RUNBOOK.md`, `artifacts/pilot-dashboard/src/components/ErrorBoundary.tsx`, `src/lib/runtimeErrorReporter.ts`, `src/main.tsx`, `vite.config.ts`, `supabase/migrations/0056_audit_log_archive.sql`, `0057_xpc_outbox.sql`, `0058_monthly_close_immutability.sql`, `0059_runtime_errors.sql`, `0060_schema_drift_check.sql`, `artifacts/pilot-mobile/app/_layout.tsx`, `lib/runtimeErrorReporter.ts`
- Round-2 reports referenced for inheritance:
  - `audit-evidence/2026-04-26/MASTER-GO-NO-GO.md`
  - `audit-evidence/2026-04-26/evidence/{G,H,I}/*.json`
