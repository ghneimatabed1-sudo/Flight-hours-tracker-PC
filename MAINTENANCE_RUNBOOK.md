# Hawk Eye — Maintenance Runbook
**Audience:** RJAF squadron operations officers and the super
admin. Plain English, no developer jargon.
**Goal:** keep the system healthy from squadron #1 (NO.8 SQDN) to
squadron #20 over a 15-year service life with no Replit Agent in
the loop.

---

## How the system fits together (one paragraph)

Hawk Eye runs as a desktop dashboard (Windows installer) on each
operations PC, plus a phone app (iOS/Android) for pilots. All PCs
in your squadron share data through a central Supabase database in
the cloud. Each PC is identified by a unique fingerprint and joins
the network by being **paired** to the other PCs it should talk to
— pairings are explicit, not automatic. The super admin (currently
Major Eyad) is the only one who can change the pairing matrix.

---

## Adding a new squadron (e.g. squadron #2 — NO.10 SQDN)

Do these steps in order. Stop and call IT if any step does not
behave as described.

### 1. Create the squadron row
1. Open the dashboard on a PC that is logged in as **super_admin**.
2. Go to **Settings → Squadrons → Add Squadron**.
3. Enter:
   - **Squadron name** (e.g. NO.10 SQDN)
   - **Squadron number** (e.g. 10)
   - **Wing** — pick from the dropdown (must exist already; if not,
     add it from **Settings → Wings** first)
   - **Base** (e.g. King Abdullah II Airbase)
4. Save. Confirm the squadron appears in the dropdown on the
   Pilots page.

### 2. Issue a license key for the squadron's first PC
1. Settings → **License Keys → Issue Key**.
2. Pick the squadron you just created. Pick role **ops**.
3. Copy the 12-character key. Hand it to the squadron's ops
   officer in person — never email or SMS.

### 3. Install the dashboard on the squadron's PC
1. Download the latest `HawkEye-Setup-vX.Y.Z.exe` from the shared
   IT drive. Always use the newest version.
2. Run the installer. When the dashboard first opens, paste the
   license key.
3. The dashboard will register this PC, name it (default
   `PC-XXXXXX`), and show the operations dashboard.

### 4. Pair the new PC to HQ
On the **super_admin** PC:
1. Settings → **Connection Map**.
2. Find the new PC in the registered list. Click **Pair → to HQ**.
3. Set **permanent: true**. Save.

The new squadron is now visible on the HQ dashboard.

### 5. Add commanders for the squadron
1. On the new PC, log in as ops.
2. Settings → **Commanders → Add**.
3. Pick role **commander**, scope **squadron**.
4. **IMPORTANT — known limitation (defect D1, fixed by follow-up
   task):** until D1 is fixed, the commander you create here only
   exists on this PC. After the fix lands, the commander will be
   automatically synced to every paired PC.

### 6. Backfill the pilot roster
Either:
- Type each pilot in via **Pilots → Add Pilot**, OR
- Import a roster CSV via **Pilots → Import → CSV** (template
  available from Settings → Help).

### 7. Verify
- Log in as the squadron commander on a different PC. Confirm you
  see the pilot list.
- On the HQ dashboard, confirm the new squadron appears in the
  squadron-strength widget.

---

## Per-role smoke test (quarterly)

Once per quarter, walk through this list. Tick each row in your
ops log. If anything is off, raise a ticket with IT.

| Role          | Steps |
| ------------- | ----- |
| super_admin   | Log in. 2FA prompts. Sidebar shows: Dashboard, Squadrons, Wings, Bases, License Keys, Connection Map, Commanders, Audit Log, Settings. |
| commander HQ  | Log in. Sidebar shows: Dashboard, every squadron's pilots (read-only). |
| commander sqn | Log in. Sidebar shows: Dashboard, your squadron's pilots, your reports. No other squadron visible. |
| ops           | Log in. Sidebar shows: Dashboard, Pilots (write), Sorties (write), Reports, Settings (limited). |
| pilot mobile  | Log in on phone. Sees own hours, currencies, expiries, reminders. Cannot edit anything. |
| guest         | Open the dashboard without logging in. Pick "Guest" → enter name and military number. Sees own profile only. |

---

## Monthly housekeeping

| Task | Frequency | Where |
| ---- | --------- | ----- |
| Review expiring currencies (next 60 days) | weekly | Dashboard top widget |
| Run end-of-month report (Forms 1–4 + Arabic roster) | monthly | Reports → Monthly Wizard |
| Confirm GitHub Actions migration workflow ran green | every push of a new migration | GitHub repo → Actions tab |
| Confirm Supabase backups are happening | monthly | Supabase project dashboard → Backups |
| Walk the per-role smoke test above | quarterly | — |
| Replace TOTP secret if a super-admin device is lost | as needed | Settings → Super Admin → Reset 2FA |
| Run the **Backup Restore Drill** (R-A) | annually | see below |
| Run **Secret Rotation** (R-E) | every 12 months | see below |
| Review **runtime_errors digest** in audit log | weekly | Audit Log → filter `ops.runtime_errors.digest` |

---

## Reading the audit log

Every meaningful write goes into the `audit_log` table — pair
creates, pair revokes, license-key activations, commander
provisioning, frozen-record edits, super-admin 2FA changes.

To read it (super admin only):
1. Open the dashboard logged in as super_admin.
2. Settings → **Audit Log**.
3. Filter by date range, by acting user, or by action type.
4. Export to CSV with the **Export** button — useful for
   compliance reviews.

The audit log is **append-only**. No one — not even the super
admin — can edit or delete an entry through the dashboard. If a
row looks wrong, raise a ticket; do not try to "correct" it.

Useful audit `type` filters introduced by Task #265:

| `type` | What it means |
| ------ | ------------- |
| `ops.audit_log.size`           | Daily size snapshot of the audit log table. |
| `ops.audit_log.alert`          | Audit log breached the size threshold (5M rows / 2 GiB). Investigate. |
| `ops.outbox.alert`             | A cross-PC outbox row has been retried >8 times without success. |
| `ops.runtime_errors.digest`    | Daily roll-up of UI crashes from the dashboard + mobile apps. |
| `ops.schema.drift`             | Live Postgres schema diverged from the previous day's snapshot. |
| `ops.backup.completed`         | Daily ping confirming the backup window elapsed. |
| `monthly.report.close`         | A squadron month was closed. |
| `monthly.report.reopen`        | A closed squadron month was re-opened by super_admin. |

---

## What the cron jobs do

The system runs the following scheduled jobs in Supabase. All are
declared in migration files; do not register or unschedule them by
hand.

| Job | When | What it does |
| --- | ---- | ------------ |
| `xpc_pair_links_sweep_weekly` | Sun 03:30 UTC | Revokes pair links idle >90 days, expires time-bound cross-squadron links. |
| `xpc-purge-archived-messages` | daily 03:15 UTC | Deletes read+archived xpc_messages older than 3 months. |
| `xpc-outbox-process` (Task #265 Part C) | every minute | Drains the cross-PC outbox; exponential backoff on failure. |
| `xpc-outbox-monitor` (Task #265 Part C) | hourly :15 | Logs `ops.outbox.alert` for any outbox row stuck >8 attempts. |
| `pilot-purge-dead-link-codes` | daily 03:20 UTC | Deletes pilot link codes 7 days past expiry. |
| `audit-log-archive-sweep` (Task #265 Part B) | daily 03:25 UTC | Moves audit_log rows older than 2 years into `audit_log_archive`. |
| `audit-log-size-monitor` (Task #265 Part B) | daily 03:40 UTC | Logs row count + bytes; alerts if over threshold. |
| `runtime-errors-digest` (Task #265 Part F) | daily 04:05 UTC | Aggregates last 24h of UI crashes into a single audit row. |
| `runtime-errors-purge` (Task #265 Part F) | daily 04:10 UTC | Deletes runtime_errors rows older than 90 days. |
| `schema-drift-check-daily` (Task #265 Part H) | daily 03:50 UTC | Snapshots the public schema; alerts on drift from yesterday. |
| `ops-backup-audit-ping` | daily 04:00 UTC | Emits an `ops.backup.completed` row so operators can confirm the backup window elapsed. |
| `xpc-purge-archived-messages-weekly` | Sun 03:35 UTC | Belt-and-braces weekly run of the daily message purge. |

To confirm a job ran, the super admin can check
`cron.job_run_details` in the Supabase SQL editor. Most operators
will never need to look at this — only IT troubleshooting calls
for it.

---

## If the super admin forgets the password

The super_admin account is bound to a fixed username and a TOTP
2FA seed. Recovery procedure:

1. **If you still have a recovery code** — log in with username +
   any password (it will fail), then click **Use recovery code**.
   Each recovery code is single-use and is consumed on success.
2. **If all recovery codes are spent** — IT must reset the
   `super_admin_2fa` row in Supabase via the SQL editor and issue
   a fresh enrolment. There is no UI path. Contact the engineer
   who originally provisioned the system. Document the reset in
   the audit log with a paper note attached.
3. **Always** generate a new set of recovery codes after a reset
   and store them in two physically separate, locked locations
   (e.g. ops officer's safe + base IT safe).

This is intentionally hard. Treat super_admin loss as a
once-per-decade event.

---

## Annual close (December)

The system automatically freezes any month older than 12 months —
no one can edit those sorties without explicit super-admin
authorisation for that PC. To grant a one-time edit window
(e.g. for a forgotten Q3 sortie):

1. Super admin → Settings → **Frozen Records → Authorize PC**.
2. Pick the PC, write a short justification, save.
3. Tell the ops officer to make the edit.
4. Revoke the authorisation as soon as the edit is done.

Every grant, revoke, and edit is captured in the audit log
forever.

---

## What to do when something looks wrong

### "I added a commander but they cannot log in on another PC"
This is **defect D1**. Until the fix lands (queued as a follow-up
task), you must add the same commander on every PC manually.

### "The migration workflow on GitHub is yellow"
Check the Actions tab. If a migration was edited after being
applied, the workflow flags it but does **not** rewrite. The fix
is to write a NEW migration that brings production back into line
— never edit an applied migration in place.

### "A pilot's hours look wrong"
1. Open the pilot's profile. Check the opening balance, initial
   hours, and the recent sorties list.
2. Run the calculation test suite to confirm the engine itself is
   sane:
   ```
   pnpm --filter @workspace/pilot-dashboard exec tsx --test src/lib/calculations.audit.test.ts
   ```
   All 20 tests must pass. If any fails, hold off on writing new
   sorties and call IT.
3. Compare the dashboard total with the mobile app total — they
   share the same engine and must match.

### "Cross-PC: I cannot pair two PCs"
Both PCs must be on the same Supabase backend. Open the
Diagnostic page on each (Settings → Diagnostic) and confirm the
Supabase URL is identical. If it isn't, one PC was installed with
the wrong build.

### "Squadron is missing from the HQ dashboard"
Check the squadron row in Settings → Squadrons. The **wing** field
must be set. If it shows blank, edit the row and pick a wing from
the dropdown. (This is defect D3 in the audit report.)

---

## Disaster recovery

If a single PC is lost or wiped:
1. Install the dashboard on the replacement PC.
2. Super admin → Connection Map → **Reset Registered PC** for the
   old PC. This revokes its pairings, deletes its registry row,
   and clears any user_pcs claims in one atomic operation.
3. Issue a new license key, follow the "Adding a new squadron"
   steps from step 3 onward.
4. No data is lost — everything was in Supabase.

If the Supabase project itself is lost:
1. Restore from the most recent backup snapshot (Supabase
   dashboard → Backups → Restore).
2. Re-apply any migrations newer than the snapshot:
   ```
   # check what's in the ledger:
   select filename from public._migration_ledger order by filename;
   # then apply any disk file not in the ledger, in order
   ```
3. Open the dashboard and confirm pilot/sortie counts match the
   pre-loss snapshot.

---

# 15-Year Hardening Runbooks (Task #265)

These nine sections were added to give the operator confidence the
system can run unattended for the full 15-year service life. They
are the canonical reference; do not improvise.

---

## R-A · Backup Restore Drill (run annually)

**Why.** Supabase makes daily managed backups, but a backup that
has never been restored is a backup that does not exist. Run this
drill once per calendar year and file the result in the ops log.

**Pre-flight.**
- You will need the super_admin Supabase login.
- You will need ~30 minutes of uninterrupted attention.
- Pick a low-traffic window (Friday afternoon Jordan time is
  ideal — pilots are off rotation, weekend is starting).

**Step 1 — Confirm the project is on Daily Backups.**
1. Sign in to Supabase → project `nklrdhfsbevckovqqkah`.
2. Navigate to **Database → Backups**.
3. Confirm the "Daily Backups" plan tile shows "Enabled". If not,
   enable it before proceeding (Pro plan or higher required).
4. Note the retention window. As of 2026-04-27 the retention is
   **7 days** at the Pro tier; the operator should consider Team
   plan (28 days) if the squadron count exceeds 10.

**Step 2 — Take a snapshot of canonical row counts.**
Run this in SQL Editor against the live project. Save the output
to the drill file (`/ops/drill-YYYY-MM-DD.txt`).
```sql
select 'pilots' as tbl, count(*) from public.pilots
union all select 'sorties', count(*) from public.sorties
union all select 'currencies', count(*) from public.currencies
union all select 'audit_log', count(*) from public.audit_log
union all select 'xpc_messages', count(*) from public.xpc_messages
union all select 'xpc_registry', count(*) from public.xpc_registry
union all select 'xpc_user_pcs', count(*) from public.xpc_user_pcs
union all select '_migration_ledger', count(*) from public._migration_ledger;
```
Pick a representative pilot and capture their lifetime totals via
the dashboard's Pilot → Hours summary card. Save the screenshot.

**Step 3 — Spin up a shadow project and restore into it.**
1. In the Supabase dashboard, create a brand-new project named
   `nklrdhfsbevckovqqkah-restore-test-YYYY-MM-DD`. Pick the same
   region as production (`eu-central-1` for the canonical
   project).
2. Wait for the project to provision (2–3 minutes).
3. From the production project's Database → Backups screen, choose
   the most recent daily backup.
4. Click **Restore to project…** and pick the shadow project.
5. The restore takes 5–20 minutes depending on database size.

**Step 4 — Verify on the shadow project.**
Run the exact same row-count query against the shadow project. The
counts must match the production snapshot from Step 2 (small
deltas in `audit_log` are OK — those rows accumulated between
snapshot time and backup time).

Spot-check the canonical pilot's lifetime totals: open the shadow
project's SQL editor and run the calculation by hand:
```sql
-- Replace <pilot_id> with the captured pilot's id.
select sum((data->>'totalHours')::numeric) as lifetime_hours
  from public.sorties
 where pilot_id = '<pilot_id>';
```
Confirm the result equals what the dashboard showed in Step 2.

**Step 5 — Tear down.**
1. In the shadow project: **Settings → General → Pause Project**
   (cheaper than delete during a 24h cooling-off window) OR
   delete it outright once verified.
2. File the drill: row counts (before + after), pilot total
   reconciliation, restore wall-clock time, who ran it, any
   surprises. Filed under `/ops/drill-YYYY-MM-DD.txt` and a
   paper copy in the safe.

**Acceptance.** The drill is considered passed only when the
shadow project's row counts and the pilot reconciliation match
production within the expected delta.

---

## R-B · Audit Log Retention

**Policy (effective 2026-04-27, migration 0056):**
- Hot rows (last 2 years) live in `public.audit_log`.
- Older rows are moved to `public.audit_log_archive` by the
  daily cron `audit-log-archive-sweep` at 03:25 UTC.
- A second daily cron `audit-log-size-monitor` at 03:40 UTC
  inserts an `ops.audit_log.size` row tracking row count and
  bytes, and an additional `ops.audit_log.alert` row if the live
  log exceeds **5,000,000 rows** OR **2 GiB** on disk.

**To check the trend** (super admin → SQL editor):
```sql
select detail->>'rows' as rows, detail->>'bytes' as bytes,
       occurred_at::date as day
  from public.audit_log
 where type = 'ops.audit_log.size'
 order by day desc limit 30;
```

**To force an out-of-band sweep** (e.g. operator just imported a
huge legacy log):
```sql
select public.audit_log_archive_sweep();
```
Returns the count of rows moved.

**To read archived rows** (super admin only):
```sql
select * from public.audit_log_archive
 where squadron_id = '<id>' and occurred_at >= '2024-01-01'
 order by occurred_at;
```
The archive table is RLS-restricted to `super_admin`. Commanders
and ops officers cannot see it from the dashboard.

**Adjusting the thresholds** (rare). Edit migration 0056's
`v_threshold_rows` / `v_threshold_bytes` constants and write a
follow-up migration that re-`create or replace`s the
`audit_log_size_monitor()` function. Do **not** edit migration
0056 in place.

---

## R-C · Outbox Operations

**What it is.** A transactional outbox table
`public.xpc_outbox` plus a per-minute processor cron
(`xpc-outbox-process`) that delivers cross-PC events. Senders
that route through `public.xpc_outbox_send(target, payload)`
get at-least-once delivery with exponential backoff (max
backoff 256 s, attempts capped at 8 before alerting).

**Currently wired targets:** `xpc_message`. Future event types
(pair create, share publish) will be added by extending
`_xpc_outbox_dispatch_one` in a follow-up migration.

**To send a cross-PC message via the outbox** (recommended for
any new code path; the existing Edge Function `xpc-messages` will
gradually migrate):
```sql
select public.xpc_outbox_send(
  'xpc_message',
  jsonb_build_object(
    'from_pc_id', 'NO. 8 SQDN',
    'to_pc_id',   'HQ',
    'from_user',  'commander.eyad',
    'subject',    'today's sortie pack',
    'body',       'attached',
    'priority',   'normal'
  )
);
```

**To inspect the outbox** (super admin only):
```sql
select id, target, attempts, sent_at, last_error,
       created_at::time, last_attempted_at::time
  from public.xpc_outbox
 order by created_at desc limit 50;
```

**Stuck rows.** A row with `attempts > 8 AND sent_at IS NULL`
will trigger an `ops.outbox.alert` audit row every hour until
it is resolved.

**To replay a stuck row**:
```sql
update public.xpc_outbox
   set attempts = 0, last_error = null, last_attempted_at = null
 where id = '<outbox-id>';
```
The next minute-tick will retry it.

**To abandon a stuck row** (after manual investigation):
```sql
-- write an audit_log entry FIRST so the trail is complete
insert into public.audit_log (type, actor, detail)
  values ('ops.outbox.abandon', 'super_admin',
          jsonb_build_object('outbox_id', '<id>', 'reason', '...'));
delete from public.xpc_outbox where id = '<id>';
```

---

## R-D · Closed-Month Procedure

**What it is.** A `public.monthly_report_close(squadron_id,
year_month, closed_at, closed_by, reason)` table plus a
trigger on `public.sorties` that rejects INSERT/UPDATE/DELETE
on rows whose date falls within a closed month for that
squadron. Trigger bypasses for the `super_admin` role only.

**To close a month** (commander or super_admin for that
squadron):
```sql
select public.monthly_report_close_close(
  '<squadron_id>',
  '2026-04',
  'monthly report Forms 1-4 published 2026-05-02'
);
```
Writes a `monthly.report.close` audit row.

**To re-open a closed month** (super_admin only — requires a
≥5-character justification):
```sql
select public.monthly_report_close_reopen(
  '<squadron_id>',
  '2026-04',
  'discovered missing sortie 2026-04-29; re-opening to add'
);
```
Writes a `monthly.report.reopen` audit row.

**Operator workflow** (recommended monthly cadence):
1. Generate the monthly report (Reports → Monthly Wizard).
2. Confirm the PDF/Excel matches expectations.
3. From the Reports page → **Lock Month** button → confirm.
   (The dashboard UI calls `monthly_report_close_close`.)
4. From this point any direct DB attempt to mutate that month's
   sorties — accidental UI bug, stray import, malicious actor —
   is rejected with `SQLSTATE P0001`.

**If the dashboard shows "Month is closed" when the operator
expected it to be open:** check `public.monthly_report_close`
for that squadron + month and re-open via the RPC above.

---

## R-E · Secret Rotation

Rotate every 12 months OR immediately if a credential is
suspected leaked. The order matters — do NOT rotate the
service-role key without first updating downstream consumers,
or you will break the GitHub Actions migration workflow.

| Secret | Where it lives | Who needs the new value | Rotation order |
| ------ | -------------- | ----------------------- | -------------- |
| `SUPABASE_SERVICE_ROLE_KEY` | GitHub repo secrets, Edge Function secrets, server env | GitHub Actions, all Edge Functions, server scripts | **(1)** rotate in Supabase, **(2)** update GitHub secret, **(3)** update each Edge Function secret, **(4)** restart any pinned local scripts |
| `SUPABASE_ANON_KEY` (also published as `EXPO_PUBLIC_SUPABASE_ANON_KEY` and `VITE_SUPABASE_ANON_KEY`) | Public client builds (mobile + dashboard installer) | Build pipeline | Rotate in Supabase → re-run dashboard installer build → re-run mobile EAS build → publish new versions to operators. Old anon key is rejected immediately, so old clients stop syncing on next refresh. |
| `SUPABASE_ACCESS_TOKEN` (sbp_…) | GitHub repo secrets, local migration scripts | GitHub Actions only | Generate a new personal access token in Supabase → update GitHub secret → revoke the old token. Local scripts must update their env. |
| `SUPABASE_PROJECT_REF` | Constant; only changes if the project is replaced | n/a | n/a — almost never rotated |
| Super-admin TOTP seed | `public.super_admin_2fa` table (seed) + a printed recovery sheet | The single super-admin person | Reset via Settings → Super Admin → Reset 2FA. Generates a new QR + 10 recovery codes. Print and store the recovery codes in two physically separate locked safes. |
| Edge Function secrets (e.g. `EXPO_PUSH_ACCESS_TOKEN`, `RESEND_API_KEY`) | Supabase project → Edge Functions → Settings → Secrets | None — the function reads from process.env | Rotate at the source provider → update Supabase secret. Edge Functions auto-pick up new env on next cold start (≤60 s). |
| GitHub fine-grained PAT for `apply-migrations.yml` | GitHub repo secrets | n/a | Generate new PAT with minimum scopes (`contents: read`, `secrets: read`); update repo secret; revoke old. |

**Procedure for the service-role key rotation (worst case — be
careful):**
1. In Supabase → Settings → API → click **"Reset"** next to the
   service role key. Copy the new value to a temporary secure
   note.
2. Open GitHub repo → Settings → Secrets → Actions →
   `SUPABASE_SERVICE_ROLE_KEY` → Update.
3. For each Edge Function: Functions → `<name>` → Settings →
   Secrets → set `SUPABASE_SERVICE_ROLE_KEY` to the new value.
4. Restart any local desktop scripts that hold the old value.
5. Trigger a no-op migration workflow run (Actions → Apply
   Migrations → "Run workflow") to confirm the GitHub side picks
   up the new value cleanly.
6. Wait 24h, then explicitly invalidate the old key in Supabase
   (Settings → API → "Revoke previous").

**Acceptance.** A subsequent Migration Workflow run is green AND
all Edge Functions respond to a synthetic ping AND the dashboard
+ mobile app continue to sign in successfully.

---

## R-F · Runtime Error Triage

**Where errors come from.** Both the dashboard (React/Vite SPA)
and the mobile app (Expo React Native) catch runtime
exceptions and POST them to `public.runtime_errors` via the
`runtime_error_capture` RPC. The reporter dedupes identical
errors to once per minute and caps each session to 30 reports.

**Daily cadence.**
- Cron `runtime-errors-digest` runs at 04:05 UTC and writes
  one `ops.runtime_errors.digest` audit row summarising the
  prior 24h: total count, count by app, count by error name,
  and the top 10 distinct messages.
- Cron `runtime-errors-purge` runs at 04:10 UTC and deletes
  rows older than 90 days. Long-term aggregates live in the
  digest audit rows (which themselves age out via the
  audit_log retention policy after 2 years).

**To read the digest** (super admin → Audit Log → filter
type=`ops.runtime_errors.digest`). The detail jsonb has
exactly the structure needed to triage at a glance.

**To drill into a specific error** (super admin / commander
for own squadron):
```sql
select occurred_at, app, page, name, message, role,
       detail->>'componentStack' as stack
  from public.runtime_errors
 where message ilike '%TypeError%'
   and occurred_at >= now() - interval '24 hours'
 order by occurred_at desc limit 50;
```

**When to act.**
- Daily count <5 → noise. Skim the digest, move on.
- Daily count 5–30 → check the top messages; if the same
  error appears across multiple PCs, file a defect ticket.
- Daily count >30 → emergency. Either an update broke the
  app for everyone OR something on the cluster is misbehaving.
  Compare the previous day's digest; if the spike correlates
  with a recent dashboard installer rollout, suspect that
  build.

**Suppressing a known-noisy error** is **not supported** by
design — every spurious row makes the digest noisier and
forces operators to look. Fix the root cause; do not silence
the report.

---

## R-G · Cost Alerts

The Supabase project lives on the **Pro** plan as of
2026-04-27. Expected baseline monthly spend at current scale
(1 squadron, ~18 pilots, ~0 sorties/day, 13 PCs paired):
**~$25/month** (Pro plan flat fee).

When the squadron count grows to 20:
- Expected database size: **~10 GB** (pro tier ceiling 8 GB
  → upgrade to Team Plan at $599/month before that point).
- Expected daily Edge Function invocations: **~50 k**
  (well within the included 2M).
- Expected daily auth signin: **~1 k** (well within 50 k MAU).
- Expected egress: **<5 GB/day**.

**Alerts to configure** in Supabase Dashboard → Project Settings
→ Billing & Usage → Spend Cap & Alerts:
1. **50% of monthly spend** — informational, email only.
2. **80% of monthly spend** — warning, email + Slack channel.
3. **100% of monthly spend** — hard cap; project becomes
   read-only until the operator approves an overage. The
   operator MUST decide consciously to allow overages.

**If an alert fires:**
1. Check the Usage page for the metric breakdown.
2. The most likely culprits are (in descending probability):
   - Runaway sortie inserts (a buggy import script).
   - Audit log growth past the cron's ability to keep up.
   - Edge Function infinite loops (e.g. a webhook retrying).
3. For each, a corresponding mitigation:
   - Sortie inserts: audit `INSERT public.sorties` traffic
     in `audit_log`; suspend the offending PC via license-key
     revocation.
   - Audit log: run `select public.audit_log_archive_sweep();`
     manually; consider tightening the threshold in 0056.
   - Edge Functions: pause the offending function via the
     dashboard until the bug is fixed.

**Acceptance.** All three thresholds are configured in the
Supabase project and emails route to a monitored mailbox.

---

## R-H · Schema Drift

**Why two layers exist.**
- The **per-migration sha256 ledger** (`_migration_ledger`,
  migration 0044) catches the case where someone *edits* a
  migration file after it was applied. The GitHub Actions
  workflow fails fast on hash mismatch.
- The **daily schema snapshot** (Task #265 Part H, migration
  0060) catches the inverse: someone runs ad-hoc SQL in the
  Supabase SQL editor that mutates the live schema without
  a corresponding migration file.

**How the daily check works.**
1. Cron `schema-drift-check-daily` runs at 03:50 UTC.
2. `schema_fingerprint_public()` builds a deterministic
   text dump of every table, column, index, foreign key,
   trigger, and RLS policy in the `public` schema.
3. The fingerprint is hashed (sha256). The hash is compared
   against yesterday's snapshot.
4. On mismatch, an `ops.schema.drift` audit row is written
   and today's snapshot is recorded.
5. Snapshots older than 60 entries (60 days) are purged.

**What to do when drift is detected.**
1. Filter the Audit Log for `ops.schema.drift`. The detail
   jsonb has the previous and current sha256 plus the
   `previous_taken_at` timestamp.
2. Run `select fingerprint from public._schema_snapshots
   order by taken_at desc limit 2;` and diff the two
   fingerprints (in your editor of choice — they are
   line-oriented).
3. The diff tells you exactly what changed. Common causes:
   - Someone added a column via SQL editor → write a forward
     migration that creates the same column with `if not exists`,
     then update the ledger sha256 to match the live state.
   - Someone added an index → write a forward migration with
     `create index if not exists`, then ledger update.
   - Someone created or dropped a policy → URGENT, this is
     likely a security regression. Investigate audit_log
     within the previous 24h for who has the access token.
4. Always remediate via a forward-only migration. Never
   "fix" the drift by mutating the live schema again.

---

## R-I · Postgres Major-Version Upgrade Rehearsal

Supabase periodically requires major-version upgrades
(15 → 16, 16 → 17, …). The procedure below is the
**rehearsal** template; do NOT actually upgrade prod
without a successful rehearsal first.

**Pre-flight.**
- Confirm via Supabase Dashboard → Project Settings →
  Infrastructure which major version production is on,
  and which version Supabase is offering as the upgrade
  target.
- Read the Supabase migration notes for that target
  version (link from the dashboard banner). Note any
  extension compatibility flags (pg_cron, pgcrypto,
  pgsodium have historically been the gotchas).

**Step 1 — Take a fresh backup.**
Supabase will take an automatic backup before the upgrade
begins, but trigger a manual one anyway from the Backups
page. Note the snapshot id.

**Step 2 — Restore that backup into a shadow project.**
Same procedure as **R-A**, steps 3–4. The shadow project
will be on the OLD Postgres version.

**Step 3 — Trigger the upgrade on the SHADOW project only.**
1. Shadow project → Settings → Infrastructure → "Upgrade
   to Postgres N+1".
2. Wait. The upgrade typically takes 5–15 minutes; the
   shadow project is unavailable for the duration.

**Step 4 — Smoke-test the shadow project against a
production-like workload.**
- Sign in via the dashboard pointed at the shadow URL.
- Walk the per-role smoke test list above.
- Confirm every cron job shows in `cron.job` after the
  upgrade (extensions sometimes need re-enabling).
- Run the calculation test suite from a developer
  workstation pointed at the shadow.

**Step 5 — Document any deltas.**
Anything that misbehaved on the shadow project will
misbehave on production. Write the remediation steps
into `R-I addendum YYYY-MM-DD.md` BEFORE doing the
production upgrade.

**Step 6 — Tear down the shadow project.**

**Step 7 — Schedule the production upgrade for a low-
traffic window.** Friday 18:00 Jordan time is ideal.

**Step 8 — Production upgrade.** Same UI flow as Step 3,
but on the production project. Have the rehearsal addendum
on screen the whole time.

**Acceptance.** Rehearsal procedure is on file and has
been walked at least once. The actual upgrade procedure
is performed only after the rehearsal completes cleanly.

---

## Migration prefix allocation for parallel agents

(Established by Round-4 AA4 — task #281 — after three round-3 sibling
agents independently picked the same `0056_` prefix and the resulting
collision blocked the apply workflow for an entire round.)

### Why this matters

The Supabase migration apply workflow (`.github/workflows/apply-supabase-migrations.yml`)
treats migration filenames as the unit of idempotency. Two unrelated
files that share the same `NNNN_` numeric prefix break that contract:
the live `_migration_ledger` records ONE of them as applied while the
other silently never reaches production. The author of the second
migration thinks it shipped because the apply workflow reports
success, but operators keep seeing the bug the migration was meant to
fix. The prefix-collision guard at `scripts/src/check-migration-prefixes.mjs`
(Task #249) catches new collisions at apply time, but every collision
that the guard catches still costs a round of cleanup surgery — and
every round of cleanup surgery is one full audit cycle wasted.

### The rule

**When the planner authors a multi-agent round where N parallel agents
will all write SQL migrations, the planner MUST pre-allocate a
contiguous numeric prefix range to each agent in their task plan
file.** Agents may NOT pick prefixes themselves — they use the range
the planner gave them. Concretely:

1. The planner reads the live ledger to find the highest applied
   prefix. Call it `P_max`.
2. The planner counts how many migrations each parallel agent will
   write. Call those counts `n_1, n_2, …, n_k`.
3. The planner allocates contiguous prefix windows:
   - Agent 1 gets `P_max + 1 … P_max + n_1`.
   - Agent 2 gets `P_max + n_1 + 1 … P_max + n_1 + n_2`.
   - …and so on.
4. Each agent's task plan file (`.local/tasks/audit-*.md` or
   equivalent) records its allocated window in the **header** under
   "Allocated migration prefixes" — explicitly, by number, with a
   note that the agent may NOT use any prefix outside that window.
5. If an agent finds it needs more prefixes than allocated, it stops
   and calls the planner — it does NOT silently grab the next free
   number. Two agents both grabbing "the next free number" is the
   exact path that produced the round-3 `0056_` collision.

### Coordinator pre-merge check

The coordinator agent (Z / AA-Z) verifies prefix uniqueness BEFORE
merging, not after, by running:

```
node scripts/src/check-migration-prefixes.mjs
```

A non-zero exit means at least one agent broke the allocation
contract. The coordinator must hold the merge until the offending
agent renumbers — even if every other piece of the round is green.
This is exactly how round-3 ended up at NO-GO: nobody ran the prefix
guard until the apply workflow itself tried to.

### Reference

The first audit round to follow this convention is Round 4 (2026-04-27,
tasks #278–#282). The allocations:

| Sibling | Allocated prefixes | Source (`audit-2026-04-27-*.md`) |
| ------- | ------------------ | -------------------------------- |
| AA1     | 0062, 0063 only    | AA1 — migration prefix surgery + reapply |
| AA2     | NONE (Edge Function redeploy only) | AA2 — redeploy provision-commander |
| AA3     | 0064, 0065, 0066 only | AA3 — patch every hole the audits found |
| AA4     | NONE (CI hardening + e2e + convention only) | AA4 — CI hardening + e2e + evidence-mirror |
| AA-Z    | NONE (coordinator) | AA-Z — final GO and push |

If you are reading this section because you are about to author a new
round of parallel migrations, copy the table above as the template
for the new round.

---

## Versions of record

| Component | Current version | Notes |
| --------- | --------------- | ----- |
| Desktop installer | v1.1.109 | Windows-signed, auto-update enabled |
| Mobile app        | v1.0.10  | TestFlight + Play Store internal track |
| Database migrations | 0001..0060 (the ledger should match the on-disk file list; the GitHub Actions workflow fails any push that diverges) |
| Edge functions | 11 (heal-claims, link-pilot-device, manage-reminder-schedule, notify-alert, notify-currency-expiry, notify-notam, provision-commander, provision-user, register-license, super-admin-2fa, validate-license) |
| Hardening migrations (Task #265) | 0056 audit_log archive · 0057 xpc_outbox · 0058 monthly_close_immutability · 0059 runtime_errors · 0060 schema_drift_check |
