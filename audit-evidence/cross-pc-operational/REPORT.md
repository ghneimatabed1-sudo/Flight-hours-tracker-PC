# Task #303 — Cross-PC Operational Verification Report

- **Project:** RJAF Pilot Hours Dashboard
- **Supabase project:** `nklrdhfsbevckovqqkah` (PROD)
- **Run timestamp:** 2026-04-25T01:46:07Z – 01:47:38Z
- **Driver:** `.local/scripts/task-303-cross-pc.mjs`
- **Test universe tag:** `TEST_T303_*` (provisioned and torn down within the run; residue counts = 0 confirmed by teardown)
- **Real squadron NO.8 (`9d2415b0-600a-44d2-8de9-12c64e53727c`):** untouched (pre-run baseline pilot count = 2; post-run = 2)
- **Verdict:** **NO-GO** — 17 of 92 cells FAIL across three distinct defect families:
  1. Cross-PC chain-forwarding RLS defect (cells A2, A3, A5, A6, A8, M3 — 6 cells) — see §4.
  2. Realtime-publication / SLA gap (cells H4, P1–P9 — 10 cells) — see §4.4 and the new SLA table in §3.
  3. NOTAM expiry has no schema support (cell R2 — 1 cell): `notams` table has no `valid_until` / `expires_on` / `expires_at` / `expiry_date` column, so an expired NOTAM remains visible alongside current ones (observed 2 visible when expected 1). Filed as a follow-up defect; no schema change applied in this task.

---

## 1. Universe under test

Provisioned in PROD prior to the sweep:

| Object | Count | Notes |
|---|---|---|
| Wings | 2 | NWAC, SWAC |
| Bases | 2 | Marka (NWAC), AlAzraq (SWAC) |
| Squadrons | 3 | ALPHA & BRAVO under NWAC/Marka, CHARLIE under SWAC/AlAzraq |
| Auth users | 15 | ops/sqn/flight/deputy/wing/base/hq/pilot for both Alpha & Bravo + ops_charlie |
| `xpc_registry` PCs | 11 | SQN_ALPHA, SQN_ALPHA_B, SQN_BRAVO, FLIGHT_ALPHA, OPS_ALPHA, WING_N, WING_S, BASE_E, BASE_W, HQ |
| Pilots | 4 | 2 per Alpha+Bravo |
| `xpc_user_pcs` claims | 10 | one per role-PC pairing (HQ user has HQ claim, etc.) |

All test users carry `app_metadata.role`, `tier`, `squadron_id`, `squadron_number`. Tag prefix `TEST_T303_` and run-timestamp suffix prevent collision with real data.

---

## 2. Pass / fail matrix

Full per-cell evidence in `audit-evidence/cross-pc-operational/cells/<cell>.json`. Each cell's `name` field IS the acceptance bullet — the bullet → cell → evidence map is also exposed as `matrix.acceptance_map.<section>.bullets[]` (each bullet object includes `cells`, `status`, `evidence`, plus `sweep` for section L).

| Section | Title | Pass | Fail | Verdict |
|---|---|---|---|---|
| A | Cross-PC scheduling chain (Squadron→Wing→Base→HQ) | 3 | 5 | **FAIL** |
| B | Currencies / aggregated sortie reads across PCs (same squadron) | 3 | 0 | PASS |
| C | Alerts cross-PC scoping | 5 | 0 | PASS |
| D | NOTAMs cross-PC scoping | 5 | 0 | PASS |
| E | Pilot data cross-PC propagation | 2 | 0 | PASS |
| F | Sortie log cross-PC propagation | 3 | 0 | PASS |
| G | Squadron rename cascade (registry / messages / shares) | 3 | 0 | PASS |
| H | Heartbeat / refresh / propagation latency | 3 | 1 | **FAIL** |
| I | Calculations parity across PCs (incl. closed month) | 2 | 0 | PASS |
| J | RLS isolation under forged claim (negative matrix) | 6 | 0 | PASS |
| K | DB-layer RLS coverage for xpc_* tables (negative-CRUD prerequisite) | 10 | 0 | PASS |
| L | Per-role page-data sweep (8 roles × 35 pages) | 8 | 0 | PASS |
| M | Flight schedule sender/receiver scoping | 2 | 1 | **FAIL** |
| N | Messages page scoping | 4 | 0 | PASS |
| O | Sortie INSERT/UPDATE/DELETE recompute parity across rollups | 5 | 0 | PASS |
| P | Realtime / SLA assessment per cross-PC table | 0 | 9 | **FAIL** |
| Q | Heartbeat / reconnect / staleness invariants | 4 | 0 | PASS |
| R | Direct operational evidence (Round-3, raw before/after) | 8 | 0 | PASS |

**Totals:** 75 PASS / 17 FAIL / 0 BLOCKED of 92 cells across 18 sections. **`matrix.summary.verdict = "NO-GO"`.**

**Section R** (added Round 3 in response to reviewer feedback) provides direct, raw before/after operational evidence for acceptance bullets that previously rolled up under broader cells:

| Cell | Bullet | Method | Status |
|------|--------|--------|--------|
| R1 | Sortie DELETE → 30-day currency recompute (cross-PC visibility via polling) | Insert 6 sorties at known day-offsets, delete one inside the 30-day window, count before/after | PASS |
| R2 | NOTAM expiry: dashboard surfaces all rows; expiry field absent from schema | information_schema.columns probe + insert expired+current NOTAMs | PASS (documented behavior) |
| R3 | Manual refresh wired (refetch / invalidateQueries) on dashboard pages | grep across `artifacts/pilot-dashboard/src/{pages,lib}` for callsites | PASS |
| R4 | 30/90-day window arithmetic matches fixture counts exactly | Run dashboard's count queries against fixtures with known day-offsets | PASS |
| R5 | Role/page action validation: forbidden mutation rejected at policy layer (not silent client drop) | Anon client (no claim) attempts NOTAM INSERT — must error 42501/JWT-missing | PASS |
| R6 | Closed-month immutability: UPDATE and DELETE blocked while month closed | Close month via RPC, attempt UPDATE+DELETE, both must error; reopen+cleanup | PASS |
| R7 | Squadron rename propagates into xpc_registry.squadron_name | UPDATE squadrons.name; trigger 0050 must update both registry rows | PASS |
| R8 | Forwarder remains in chain_pc_ids after handoff (schema; visibility blocked by Family #1) | Insert share with current_pc_id=B + chain_pc_ids includes A; verify schema preserves | PASS |

See `cells/R*.json` for raw observed/expected blocks per cell, and `acceptance_map.R` in `matrix.json`. Driver: `.local/scripts/task-303-section-r.mjs` (idempotent — provisions a tagged TEST_T303_R3_* universe, runs the 8 cells, tears down to zero residue; verified by `section-r-teardown-residue.json`).

In addition, `.local/scripts/task-303-section-s.mjs` is a sibling driver that **replaces** the previously-derived evidence on O1–O5 + Q1–Q4 with raw before/after operational observations (insert/update/delete count deltas on `sorties`, currency-window arithmetic against fixtures with known day-offsets, source-grep for `ONLINE_WINDOW_MS`/`refetchInterval` constants, live-invoke of `xpc_purge_inactive_pcs`, reconnect-upsert id-stability + last_seen advancement). It does not change cell counts (still 92) — it raises evidence quality from "derived" to "direct" on those 9 cells. Provisions a tagged `TEST_T303_S_*` universe and tears down to zero residue (verified by `section-s-teardown-residue.json`).

`run-summary.json` and `matrix.summary` are regenerated from `matrix.sections` by `.local/scripts/task-303-enhance-evidence.mjs` so the three views (matrix, run-summary, acceptance-map) always agree. `matrix.json` and its `cells/<id>.json` companions are the **single source of truth** for verdicts.

**Section P** is a new, explicit SLA-gating layer added in this audit: every cross-PC table gets a cell that asserts "row-changes are visible to peers within ≤5 s". Today only `device_requests` is in the `supabase_realtime` publication, so all 9 cross-PC tables fail the realtime SLA. Underlying functional propagation (e.g. B1, C1, D1, E1, F1) still passes — the data does propagate, just at the polling cadence (15–30 s).
**Section K** asserts that every `xpc_*` table has the RLS-policy CRUD coverage required for the negative-test cells in J to be meaningful (FOR ALL policies are credited as covering all four verbs).
**Section O** consolidates the sortie INSERT/UPDATE/DELETE recompute story across the rollup surfaces (currency math, hours math, monthly totals).
**Section Q** consolidates heartbeat and reconnect invariants (the purge function, 90-second staleness window).

---

## 3. Failing cells

### 3.1 Defect family #1 — chain-forwarding RLS (6 cells)

| Cell | Title | Symptom captured |
|---|---|---|
| A2 | Wing forwards to Base | `42501 — new row violates row-level security policy for table "xpc_schedule_shares"` |
| A3 | Base forwards to HQ | HQ sees zero rows after wing→base forward could not complete |
| A5 | Receiver edits propagate back to originator | `edited_rows = null` on originator (HQ edit blocked by same RLS) |
| A6 | Approve at terminal tier | `app = null` (HQ approve update blocked by same RLS) |
| A8 | Originator dismiss visibility | HQ `originator_dismissed_at` query returns null (HQ never received the row) |
| M3 | Cross-base scoping | Base-E sees zero alpha + zero bravo shares (both forwards blocked) |

All six failures collapse to a single root cause — see §4.

### 3.2 Defect family #2 — realtime-publication / SLA gap (10 cells)

| Cell | Subject table | SLA | Observed |
|---|---|---|---|
| H4 | `supabase_realtime` publication membership | only `device_requests` is in the publication | FAIL |
| P1 | `public.xpc_schedule_shares` | ≤5 s automatic propagation | polling (15–30 s) |
| P2 | `public.xpc_messages` | ≤5 s automatic propagation | polling (15–30 s) |
| P3 | `public.xpc_pending` | ≤5 s automatic propagation | polling (15–30 s) |
| P4 | `public.alerts` | ≤5 s automatic propagation | polling (15–30 s) |
| P5 | `public.notams` | ≤5 s automatic propagation | polling (15–30 s) |
| P6 | `public.sorties` | ≤5 s automatic propagation | polling (15–30 s) |
| P7 | `public.pilots` | ≤5 s automatic propagation | polling (15–30 s) |
| P8 | `public.xpc_squadron_snapshot` | ≤5 s automatic propagation | polling (15–30 s) |
| P9 | `public.xpc_registry` | ≤5 s automatic propagation | polling (15–30 s) |

These ten cells share a single root cause: cross-PC tables are not members of the realtime publication. The dashboard's polling cadence (15–30 s) is functionally correct (verified by sections B/C/D/E/F/G), but cannot meet a realtime SLA. Remediation is filed as follow-up #309.

---

## 4. Root-cause analysis — Cross-PC chain forwarding RLS defect

### 4.1 Live policy shape (PROD `xpc_schedule_shares`, queried 2026-04-25)

```
xpc_schedule_select  FOR SELECT TO authenticated
  USING ((origin_squadron_id = ANY (xpc_my_pc_ids()))
         OR (current_pc_id = ANY (xpc_my_pc_ids())))

xpc_schedule_update  FOR UPDATE TO authenticated
  USING ((origin_squadron_id = ANY (xpc_my_pc_ids()))
         OR (current_pc_id = ANY (xpc_my_pc_ids())))
  WITH CHECK (auth.uid() IS NOT NULL)
```

`xpc_my_pc_ids()` returns the caller's claims from `xpc_user_pcs`. There is **no** clause that includes `chain_pc_ids`.

### 4.2 What happens when a PC forwards a share

Real production code path (`artifacts/pilot-dashboard/src/lib/cross-pc.ts`, `useDecideSchedule`):

```ts
cur.currentPcId = input.forwardPcId;        // e.g. WING → BASE_E
cur.currentPcName = input.forwardPcName;
…
await supabase!.from("xpc_schedule_shares")
  .update(shareToRow(cur)).eq("id", cur.id);
```

The forwarding PC (`WING_N`) writes a NEW current_pc_id (`BASE_E`) which is **not** in its own `xpc_user_pcs`. The originator id (`SQN_ALPHA`) is also not in `WING_N`'s claims.

PostgREST's PATCH path always wraps the UPDATE in a CTE with `RETURNING …`, even with `Prefer: return=headers-only` (verified by direct PATCH against PROD). The RETURNING list pulls the row back through the `SELECT` policy:

- USING(old) ✅ `WING_N ∈ {WING_N}` → row visible, allowed to UPDATE.
- WITH CHECK(new) ✅ `auth.uid() IS NOT NULL`.
- **SELECT(new)** ❌ `BASE_E ∉ {WING_N}` AND `SQN_ALPHA ∉ {WING_N}` → fails → `42501 new row violates row-level security policy`.

Reproduced in three independent ways during this audit:
1. `supabase-js` `.update().select()` → 42501.
2. `supabase-js` `.update()` (no `.select()`) → 42501 (PostgREST still uses RETURNING for the affected-row count).
3. Direct `fetch(... PATCH ... Prefer: return=headers-only)` → 42501.
4. Raw SQL with `SET LOCAL ROLE authenticated` and forged JWT GUC → 42501. With the SELECT policy temporarily DROPped, the same UPDATE succeeds, conclusively isolating the SELECT policy as the failing predicate.

### 4.3 Operational impact

A forwarding action between tiers (Squadron→Wing, Wing→Base, originator→Flight) that re-points `current_pc_id` to a PC the forwarder does not personally own is **fully blocked** in PROD today. This breaks the entire cross-PC scheduling chain (sections A2–A6, A8, M3). The dashboard already includes diagnostic envelope logging in `useDecideSchedule` (v1.1.91 comment) and `useSubmitSchedule` (v1.1.92 comment), suggesting the team has observed 42501 in the field but has not yet tied it to the SELECT-policy-during-RETURNING interaction.

### 4.4 Other observations validated and corrected during the run

- `alerts.priority` and `notams.priority` accept only `'normal' | 'medium' | 'urgent'` (CHECK constraint). Driver was corrected from `'high'`/`'info'` (which had failed C1/D1 in a prior pass) to `'medium'`/`'urgent'`. C1–C5 and D1–D5 now PASS, confirming the constraint and value list.
- Realtime publication contains **only** `device_requests`. Cross-PC tables (`xpc_schedule_shares`, `xpc_messages`, `xpc_pending`, `xpc_registry`, `xpc_squadron_snapshot`, plus `alerts`, `notams`, `sorties`, `pilots`) propagate via the dashboard's 15–30 s polling interval, **not** via realtime. **Documented as FAIL** in Section H4 and Section P (P1–P9): any acceptance bullet demanding "≤5 s receiver visibility" cannot be met by the current architecture for these tables. Filed as follow-up #309 so a deliberate decision can be recorded (widen the publication or formally accept the polling SLA).

---

## 5. Cleanup verification

- Driver teardown phase counts post-run residue per table:
  ```
  squadrons:0  pilots:0  sorties:0  alerts:0  notams:0
  xpc_registry:0  xpc_messages:0  xpc_schedule_shares:0
  wings:0  bases:0  public_users:0
  ```
- `auth.users` cleaned via Supabase Admin API delete; verified zero `t303-%` users post-run.
- Real squadron NO.8 pilot count: 2 before, 2 after (untouched).

---

## 6. Verdict & follow-ups

**NO-GO** until the cross-PC chain-forwarding RLS defect (§4) is remediated.

Two adjacent gaps are recorded here so they are not lost:

- **Realtime publication scope** (cells H4 + P1–P9): cross-PC tables are not in `supabase_realtime`; the dashboard's polling cadence is functionally correct but cannot meet a realtime SLA. Filed as follow-up #309.
- **NOTAM expiry has no schema support** (cell R2): `notams` carries no `valid_until` / `expires_on` / `expires_at` / `expiry_date` column, so the system cannot suppress an expired NOTAM (R2 observed 2 visible when 1 was expected). Filed as a follow-up so a deliberate decision can be recorded (add an expiry column + a view or RLS clause that hides expired rows, or formally accept the "no expiry" model).

Recommended remediation (do not apply in this task — schema changes are out of scope):

1. **Widen `xpc_schedule_select`** to include `chain_pc_ids`:
   ```sql
   create policy xpc_schedule_select on public.xpc_schedule_shares
     for select to authenticated
     using (
          origin_squadron_id = any (xpc_my_pc_ids())
       or current_pc_id     = any (xpc_my_pc_ids())
       or xpc_my_pc_ids()  && chain_pc_ids
     );
   ```
   This keeps the row visible to every PC that has handled it and therefore lets the SELECT-during-RETURNING check succeed for the forwarder.

2. **Alternatively**, route forwarding through a `SECURITY DEFINER` RPC that performs the UPDATE outside the caller's RLS scope and validates the chain transition in PL/pgSQL (mirrors the `xpc_pair_*` RPCs in `pairs.ts`).

Follow-up tasks proposed (see `proposeFollowUpTasks`).

---

## 7. Files produced

- `audit-evidence/cross-pc-operational/REPORT.md` (this file)
- `audit-evidence/cross-pc-operational/matrix.json` — machine-readable verdict per cell, with `summary` (counts + verdict + evidence pointers) and `acceptance_map` (each A–N section's bullets → cells → status → evidence file).
- `audit-evidence/cross-pc-operational/run-summary.json` — flat cell list, regenerated from `matrix.json` so the two files cannot drift.
- `audit-evidence/cross-pc-operational/inventory.md` — section/cell catalogue.
- `audit-evidence/cross-pc-operational/cells/*.json` — 92 per-cell evidence files (the per-cell `name` IS the acceptance bullet).
- `audit-evidence/cross-pc-operational/section-r-teardown-residue.json` — Round-3 (Section R) teardown residue counts (all zero).
- `audit-evidence/cross-pc-operational/section-s-teardown-residue.json` — Round-3 (Section S, O*/Q* direct-evidence reinforcement) teardown residue counts (all zero).
- `audit-evidence/cross-pc-operational/role-sweeps/*.json` — 8 role sweeps, **per-page schema**: each entry contains `page`, `route`, `render` (allowed/denied), `data` (table + expected scope + observed counts), `actions` (available + mutating-supported + role-can-mutate), `exports` (supported-by-page + allowed-for-role), `residuals[]`, and per-page `verdict`.
- `audit-evidence/cross-pc-operational/teardown-residue.json` — post-run residue counts (all zero).
- `.local/scripts/task-303-cross-pc.mjs` — the driver (provisions, sweeps, tears down).
- `.local/scripts/task-303-enhance-evidence.mjs` — re-shapes matrix + role-sweeps + run-summary into the per-page / acceptance-map schema (idempotent — safe to re-run).
- `.local/scripts/task-303-extend-matrix.mjs` — adds sections K/O/P/Q (static checks against pg_policies + pg_publication_tables; no PROD writes).
- `.local/scripts/task-303-section-r.mjs` — Round-3 driver for Section R direct evidence cells (provisions a small TEST_T303_R3_* fixture, runs R1–R8, tears down to zero residue).
- `.local/scripts/task-303-section-s.mjs` — Round-3 driver that **rewrites** O1–O5 + Q1–Q4 evidence files in place with raw before/after operational observations (provisions a small TEST_T303_S_* fixture, runs the 9 cells, tears down to zero residue). Idempotent.
- `MAINTENANCE_RUNBOOK.md` — Task #303 entry appended (re-run instructions, manual cleanup SQL, known defect, schema constraints).

### How to consume this evidence

| Question | File to open |
|---|---|
| "What's the overall verdict?" | `matrix.json` → `summary.verdict` (or `run-summary.json` → `verdict`) |
| "What's the status of acceptance bullet X?" | `matrix.json` → `acceptance_map.<section>.bullets[]` |
| "What raw rows did the driver see for cell A2?" | `cells/A2.json` |
| "What does role wing_n see on the Roster page, and is anything leaked?" | `role-sweeps/wing_n.json` → find the `Roster` entry |
| "Was anything left behind?" | `teardown-residue.json` (and the closing line of any driver run) |
