# HANDOFF — Hawk Eye / RJAF Squadron Ops

**Status as of:** 2026-04-25 (ship date of v1.1.124).
**Audience:** the next engineer (or AI agent) who has to keep this product alive
without the original author present. Read this **before** any other doc in the
repo. This is the master entry point — every other doc is a deep dive on one
chapter and is cross-referenced from here.

If you only have 5 minutes: read §1 (what this is), §2 (today's state), §3
(architecture at a glance), §11 (known-broken list), §12 (release process).

---

## Table of contents

1. What is Hawk Eye
2. State snapshot (2026-04-25)
3. Architecture (at a glance)
4. Repository layout
5. Database — tables, RPCs, edge functions, cron jobs, migrations
6. Source tree — dashboard (194 files) + mobile (34 files) one-liners
7. Domain calculations (with worked examples)
8. Cross-PC chain (Sqn → Wing → Base → HQ)
9. Auth, permissions, and the join secret
10. Multi-PC join flow (replaces the retired License-Keys system)
11. Known-broken list / drift / open risks
12. Release process
13. Cookbooks (common ops)
14. Index of supporting docs (status of every other .md)
15. APPENDIX A — per-table reference (columns, defaults, FKs, indexes, RLS)
16. APPENDIX B — full RPC signatures (149 functions)
17. APPENDIX C — per-RPC purpose + caller + JWT claim matrix (149 functions)
18. APPENDIX D — per-edge-function deep dive (14 deployed functions)

---

## 1. What is Hawk Eye

Hawk Eye (internal name; user-facing name on the welcome screen since v1.1.124
is **"Squadron Management System"**) is the Royal Jordanian Air Force flight
hours / pilot management product. Three artifacts ship to end users:

| Artifact | Audience | Form factor | Path |
|---|---|---|---|
| `pilot-dashboard` | Squadron Ops, Commanders, Wings, Base, HQ | Windows desktop app (Electron, NSIS installer) | `artifacts/pilot-dashboard` |
| `pilot-mobile` | Individual pilots | Android / iOS via Expo / EAS | `artifacts/pilot-mobile` |
| `api-server` | (development helper only — not user-facing) | Node/Express dev daemon | `artifacts/api-server` |

A single Supabase project (prod ref: **`nklrdhfsbevckovqqkah`**) is the
authoritative datastore. Every PC in the chain (squadron, commander, wing, base,
HQ) talks to the same project; isolation is by **`squadron_id`** + **role tier**
in RLS. The "cross-PC" tables (`xpc_*`) carry the structured forwarding chain
between tiers.

Mockup-sandbox (`artifacts/mockup-sandbox`) is an internal design playground; it
ships nothing.

---

## 2. State snapshot — today

Captured live from the Supabase Management API on **2026-04-25 04:48Z**. This is
the literal answer to "what's in the database right now?" — anything not listed
here is empty.

### 2.1 Squadron registry

Exactly **one** squadron exists in `public.squadrons`:

```
id          cc8ae1b7-480f-4189-b746-552aced8addc
number      8
name        8 Squadron
base        KING ABDULLAH II AIRBASE
wing        UH60M
wing_id     NULL                ← see §11.A
base_id     68f92106-562e-40a9-8f74-9b89e6ca7242
created_at  2026-04-25 04:31:20Z
```

This row was inserted **manually via the Supabase Management API** during this
session, NOT through any UI. The dashboard's `addSquadron()` UI is currently
local-only (writes to `localStorage["rjaf.squadrons"]` only — see §11.B). Until
that bug is fixed, every new squadron must be inserted server-side the same
way. Reference INSERT (sanitise values per squadron):

```sql
insert into public.squadrons (number, name, base, wing, base_id)
values ('8', '8 Squadron', 'KING ABDULLAH II AIRBASE', 'UH60M',
        '68f92106-562e-40a9-8f74-9b89e6ca7242');
```

### 2.2 Bases & wings

```
bases:  1 row
        id=68f92106-562e-40a9-8f74-9b89e6ca7242
        name=KING ABDULLAH II AIRBASE
        created_at=2026-04-23 14:29:52Z

wings:  0 rows
```

The 8 Squadron's `wing_id` column is **NULL** — wings/bases hierarchy isn't
populated yet. Schedule-chain forwarding to wing/base/HQ tiers will short-circuit
until at least one wing row exists and the squadron is linked to it (see §8).

### 2.3 Membership / devices

```
unit_members:    0 rows
devices:         0 rows
device_requests: 0 rows
pilots:          0 rows
sorties:         0 rows  (count)
```

All operational tables are empty. The system is in "fresh install" state aside
from the one squadron above and the super-admin credentials below. The legacy
`commanders` and `license_keys` tables **no longer exist** — they were dropped
by migration `0081_drop_legacy_license_commander_tables.sql` (Task #300).

### 2.4 Super admin (the only privileged identity that exists)

```
super_admin_2fa table:
  username           admin
  has_totp           true
  enrolled_at        2026-04-18 12:14:08Z
  last_verified_at   2026-04-25 04:23:22Z   ← latest 2FA pass today
  failed_attempts    0
  locked_until       NULL
  recovery_codes     10 unused

auth.users:
  id      6545f3df-e8b1-4604-b49e-5d5440749b93
  email   admin@hq.rjaf.local
  role    super_admin (in app_metadata)
```

The `audit_log` for today shows two `super_admin.2fa.verified` events:
**04:00:23.99Z** (the verification recorded in task #314's brief) and
**04:23:22.74Z** (a second verification 23 minutes later, 1 minute before the
state snapshot was taken — this is what now lives in
`super_admin_2fa.last_verified_at`). Both rows are intentional and uncontested;
they are the same operator authenticating twice as the cluster was rebuilt.

This is the **only** real identity in the system. There is no commander row, no
unit_member row, and no pilot row. Any operator action requiring auth currently
runs as `admin@hq.rjaf.local`.

### 2.5 The join secret (anti-spam gate for multi-PC join)

```
unit_config.join_secret:
  length       64 chars
  updated_at   2026-04-25 00:12:16Z   (set by migration 0076 rotation)
```

The secret value itself is a 64-character random string. **It must never appear
in logs, source code, commit messages, or audit evidence files** beyond an
8-char prefix for fingerprinting. Ways to obtain the live value:

* Inside the installed dashboard: baked in at build time as `VITE_UNIT_JOIN_SECRET`.
* In the GitHub Actions build: read from repo secret of the same name.
* Server-side: `select value from public.unit_config where key = 'join_secret';`
  (super-admin only via the management API).

### 2.6 audit_log

481 rows total, growing slowly. Most recent entries are the super-admin's
2FA verifications today, plus the standing cron-job heartbeats
(`ops.backup.completed`, `ops.runtime_errors.digest`, `ops.schema.drift`,
`ops.audit_log.size`, etc.). Archive sweep runs daily at 03:25 UTC and moves
rows older than the configured TTL into `audit_log_archive`.

### 2.7 What's NOT there (intentionally)

* `commanders` table — dropped by 0081.
* `license_keys` table — dropped by 0081.
* `archived_squadrons` table — never created (the round-3 design preferred
  in-place soft delete via `unit_members.removed_at`).
* Storage buckets — zero. The product does not use Supabase Storage at all.

### 2.8 How the cluster got into this empty state

The empty-but-running posture above is the deliberate result of a manual
service-role REST sweep performed during this session, **not** a clean
post-migration baseline. The sequence was:

1. The dashboard's `addSquadron()` action was invoked from the web preview and
   wrote only to `localStorage["rjaf.squadrons"]` (the §11.B bug). Nothing
   reached Supabase, so the cluster still had no operational rows.
2. To reset to a known baseline before the handoff snapshot, every
   operational table was emptied via the Supabase Management API SQL endpoint
   using the service-role key — `audit_log_archive` and equivalents preserved,
   `unit_members`, `pilots`, `sorties`, `currencies`, `pair_links`, `xpc_*`,
   `squadrons`, `wings`, `bases`, etc. all truncated/`DELETE FROM` cleared.
   No `psql` was used (per AGENTS.md) — every wipe went through the
   `POST /v1/projects/nklrdhfsbevckovqqkah/database/query` endpoint.
3. The single `8 Squadron` row in §2.1 was then re-inserted directly via the
   same SQL endpoint to satisfy the FK demand of any future writes; its
   `wing_id` was deliberately left NULL (§11.A) because no `wings` row was
   re-created in the same operation.
4. The super-admin in §2.4 survived because `auth.users` and
   `super_admin_2fa` were excluded from the wipe (the bootstrap-once trigger
   would have made the row impossible to recreate cleanly).

This is why §2 is described throughout as "today's state" rather than "fresh
install state" — a fresh install would also be empty, but it would not have
a manually-inserted squadron with a NULL `wing_id`.

---

## 3. Architecture (at a glance)

```
┌─────────────────────┐       ┌────────────────────┐
│ Pilot mobile (Expo) │──────▶│                    │
└─────────────────────┘       │                    │
                              │   Supabase prod    │
┌─────────────────────┐       │  nklrdhfsbevckov   │
│ Dashboard PC (Win)  │◀─────▶│                    │
│   • Sqn Ops         │       │  Postgres + RLS    │
│   • Commander       │       │  + 14 Edge Funcs   │
│   • Wing            │       │  + 15 cron jobs    │
│   • Base            │       │                    │
│   • HQ              │       │                    │
│   • Super Admin     │       └─────────┬──────────┘
└──────────┬──────────┘                 │
           │                            │
           │ all PCs share the SAME     │
           │ Supabase project; isolation│
           │ is by squadron_id + role.  │
           │ Cross-tier comm goes       │
           │ through the xpc_* tables.  │
           ▼                            ▼
   electron-updater polls        pg_cron runs maintenance
   github.com/.../Releases       (every minute → daily)
```

Key architectural rules (do not violate):

* **One Postgres project per environment.** No per-tenant projects, no
  per-squadron schemas. RLS does isolation.
* **Single source of truth for migrations.** All schema changes are raw SQL
  files in `artifacts/pilot-dashboard/supabase/migrations/`, applied via the
  Supabase Management API by the GitHub Actions migration pipeline. **Never
  use Drizzle `db:push`, never use `psql DATABASE_URL` directly** (see
  AGENTS.md §"Supabase access").
* **No service-role secret in client bundles.** Both the dashboard and the
  mobile app ship with the publishable anon key only.
* **PC dashboard auto-updates from a public GitHub release repo.** The
  release artifacts live in `ghneimatabed1-sudo/Flight-hours-tracker-Releases`;
  the source repo is `ghneimatabed1-sudo/Flight-hours-tracker-PC`.

---

## 4. Repository layout

```
.
├── HANDOFF.md                           ← THIS FILE (entry point)
├── replit.md                            (agent guidance — see §14)
├── AGENTS.md                            (operational rules — see §14)
├── DOMAIN.md                            (product domain — see §14)
├── BUILDS.md                            (build pipeline — see §14)
├── MAINTENANCE_RUNBOOK.md               (oncall — see §14)
├── SUPABASE_HEALTH.md                   (db health snapshot — see §14)
├── threat_model.md                      (security model — see §14)
├── package.json + pnpm-workspace.yaml   (monorepo root)
├── artifacts/
│   ├── pilot-dashboard/                 (Electron + Vite + React + TS)
│   │   ├── src/                         (194 .ts/.tsx files — see §6.1)
│   │   ├── electron/                    (main process, electron-updater glue)
│   │   ├── supabase/
│   │   │   ├── migrations/              (89 .sql files — see §5.5)
│   │   │   ├── functions/               (14 edge functions — see §5.3)
│   │   │   └── seed/                    (db-seed.mjs for empty-DB bootstrap)
│   │   ├── public/brand/                (RJAF emblem.png + logos)
│   │   ├── tests/                       (smoke / translation / pilots tests)
│   │   ├── electron-builder.json        (NSIS installer config)
│   │   └── package.json                 (version source of truth — auto-bumped)
│   ├── pilot-mobile/                    (Expo + expo-router + RN)
│   │   ├── app/                         (expo-router pages)
│   │   ├── components/, lib/, hooks/    (34 src files total — see §6.2)
│   │   ├── eas.json                     (Expo Application Services build config)
│   │   └── package.json
│   ├── api-server/                      (dev-only Express daemon)
│   └── mockup-sandbox/                  (internal design playground)
├── attached_assets/                     (paper-form snapshots, emblem ref)
├── audit-evidence/                      (per-task audit reports)
├── .local/
│   ├── tasks/                           (one .md per task — task plans)
│   └── memory/                          (16 deep-dive .md files — see §14)
└── .github/workflows/
    ├── dashboard-windows-installer.yml  (Win build & GitHub release)
    └── mobile-eas-build.yml             (Expo / EAS mobile build)
```

---

## 5. Database

Live snapshot is in `/tmp/sb-snapshot.json`, `/tmp/sb-cols.json`,
`/tmp/sb-extra.json`, `/tmp/sb-state.json` (committed via this session).

### 5.1 Tables (44 in `public`)

Ordered alphabetically. `!` = NOT NULL, types are PostgreSQL types as reported
by `information_schema`.

| Table | Columns |
|---|---|
| `_migration_ledger` | filename!, applied_at!, applied_by, sha256 |
| `_schema_snapshots` | taken_at!, sha256!, fingerprint! |
| `alerts` | id!, squadron_id!, posted_at!, body!, author, created_at!, priority! |
| `audit_log` | id!, squadron_id, type!, actor, detail (jsonb)!, occurred_at!, action |
| `audit_log_archive` | id!, squadron_id, type!, actor, detail!, occurred_at!, archived_at! |
| `bases` | id!, name!, created_at! |
| `currencies` | id!, squadron_id!, pilot_id!, task!, status!, cycle_start!, updated_at! |
| `device_requests` | id!, requested_role!, requested_squadron_names!, username!, display_name!, fingerprint!, originating_ip, submitted_at!, status!, decided_at, decided_by, decision_reason, supabase_email, member_id, device_id, password_sha256, claim_token, claim_consumed_at, originating_city |
| `devices` | id!, member_id!, display_name!, fingerprint!, originating_ip, originating_city, approved_at!, approved_by, last_seen_at, revoked_at, revoked_reason |
| `duty_week` | id!, squadron_id!, day!, main_duty, standby, rcm, effective_from! |
| `leaves` | id!, squadron_id!, pilot_id!, year!, months (jsonb)! |
| `license_registry` | id!, full_key!, meta!, updated_at! — *retained for historical reads only; legacy* |
| `licenses` | key!, squadron_id!, bound_fingerprint, issued_at!, expires_at, revoked_at — *legacy; not written to* |
| `monthly_report_close` | squadron_id!, year_month!, closed_at!, closed_by, reason |
| `notams` | id!, squadron_id!, notam_no!, posted_on!, body!, created_at!, priority! |
| `pilot_currency_notifications` | id!, pilot_id!, currency_key!, expiry_date!, threshold_days!, sent_at! |
| `pilot_devices` | token_hash, squadron_id!, pilot_id!, linked_at!, last_seen_at!, revoked_at, user_id, id! |
| `pilot_link_codes` | id!, squadron_id!, pilot_id!, code_hash!, issued_by, issued_at!, expires_at!, consumed_at |
| `pilot_reminder_prefs` | pilot_id!, squadron_id!, thresholds (jsonb)!, push_enabled!, expo_push_token, platform, updated_at!, last_seen_at |
| `pilots` | id!, squadron_id!, rank!, name!, arabic_name, unit, phone, available!, data (jsonb)!, updated_at!, auth_user_id, rank_en |
| `reminder_manual_runs` | id!, started_at!, ended_at, status!, return_message, actor |
| `reminder_schedules` | id!, name!, cron!, target_url, enabled!, squadron_id, created_at!, updated_at!, created_by |
| `runtime_errors` | id!, occurred_at!, app!, app_version, role, user_id, squadron_id, page, message!, name, stack, user_agent, detail (jsonb)! |
| `saved_duty_weeks` | id!, squadron!, start_date!, rows (jsonb)!, saved_at! |
| `schedule` | id!, squadron_id!, flight_date!, ac!, config, crew (array)!, mission, takeoff, land, fuel, created_at! |
| `sorties` | id!, squadron_id!, pilot_id!, co_pilot_id, date!, ac_type, ac_number, sortie_type, sortie_name, data (jsonb)!, created_by, created_at! |
| `squadrons` | id!, number!, name!, base!, created_at!, wing_id, base_id, default_aircraft (jsonb)!, default_monthly_targets (jsonb)!, wing |
| `super_admin_2fa` | username!, secret_b32!, enrolled_at, last_verified_at, failed_attempts!, locked_until, created_at!, updated_at!, recovery_code_hashes (array)!, recovery_code_used_at (array)! |
| `super_admin_credentials` | username!, password_hash!, updated_at!, updated_by |
| `unavailable` | id!, squadron_id!, pilot_id!, from_date!, to_date!, reason, created_at! |
| `unit_config` | key!, value!, updated_at!  *(stores `join_secret` and other unit-wide settings)* |
| `unit_members` | id!, auth_user_id, username!, display_name!, role!, tier!, squadron_allow_list (array)!, primary_squadron_id, status!, removed_at, removed_reason, created_at!, updated_at! |
| `users` | id!, squadron_id!, username!, display_name!, role!, created_at! — *legacy from the License-Keys era; new code reads `unit_members`* |
| `wings` | id!, name!, base_id, created_at! |
| `xpc_messages` | id!, thread_id!, from_pc_id!, from_pc_name!, from_tier!, from_user!, to_pc_id!, to_pc_name!, to_tier!, subject!, body!, priority!, sent_at!, read_at, in_history!, from_display_name, from_rank, from_seat_label |
| `xpc_outbox` | id!, target!, payload (jsonb)!, created_at!, created_by, sent_at, attempts!, last_attempted_at, last_error |
| `xpc_pair_audit` | id!, action!, target_pc_a, target_pc_b, by_user_id, by_user_label, kind, justification, detail, at! |
| `xpc_pair_codes` | code!, host_pc_id!, host_tier!, host_squadron, host_user_id, host_user_display, host_user_seat, expires_at!, created_at!, consumed_at |
| `xpc_pair_links` | a_pc_id!, b_pc_id!, a_tier!, b_tier!, a_squadron, b_squadron, a_user_display, b_user_display, a_user_seat, b_user_seat, kind!, paired_at!, paired_by_user_id, paired_by_label, justification, expires_at, permanent!, last_activity_at!, revoked_at, revoked_by_user_id, revoked_reason |
| `xpc_pending` | id!, hosting_squadron_id!, hosting_squadron_name!, home_squadron_id!, home_squadron_name!, guest_pilot_name!, guest_pilot_military_number, guest_seat!, sortie (jsonb)!, submitted_at!, submitted_by!, status!, decided_at, decided_by, decision_reason, edited_sortie, submitter_display_name, submitter_rank, submitter_seat_label |
| `xpc_registry` | id!, squadron_name!, tier!, base, wing, last_seen!, device_name, parent_pc_id, wing_id, base_id, squadron_pc_id |
| `xpc_schedule_shares` | id!, flight_date!, origin_squadron_id!, origin_squadron_name!, current_tier!, current_pc_id, current_pc_name, status!, rows (jsonb)!, baseline_rows (jsonb)!, history (jsonb)!, edited_rows, edited_by, updated_at!, program, edited_program, chain_pc_ids (array)!, approved_at, approved_by, rejected_by_pc_ids (array)!, originator_dismissed_at, submitter_display_name, submitter_rank, submitter_seat_label |
| `xpc_squadron_snapshot` | squadron_id!, ops_pc_id!, snapshot_at!, payload (jsonb)!, updated_by! |
| `xpc_user_pcs` | user_id!, pc_id! |

### 5.2 RPCs (149 in `public`)

149 functions; the most-used groups:

* **Currency & reminders**: `bump_pilot_currency`, `pilot_currency_view`,
  `notify_currency_expiry_run`, `pilot_set_reminder_prefs`,
  `list_pilot_sync_status`, `ping_pilot_sync`.
* **Sortie ingest**: `insert_sortie`, `delete_sortie`, `monthly_close_*`,
  `runtime_error_log`.
* **Cross-PC**: `xpc_register`, `xpc_send_message`, `xpc_redeem_pair_code`,
  `xpc_admin_create_pair`, `xpc_pair_links_sweep_internal`,
  `xpc_outbox_process`, `xpc_outbox_monitor`, `xpc_purge_inactive_pcs`,
  `xpc_purge_archived_messages`, `xpc_squadron_rename_sync`,
  `xpc_is_super_admin`, `xpc_schedule_select_chain_pc_ids`.
* **Multi-PC join (current)**: `unit_request_join`, `unit_pending_requests`,
  `unit_reserve_approval`, `unit_complete_approval`, `unit_reject_request`,
  `unit_remove_member`, `unit_member_self`, `unit_super_admin_setup_allowed`,
  `unit_claim_device`, `unit_approve_device`.
* **Audit & retention**: `audit_log_archive_sweep`, `audit_log_size_monitor`,
  `runtime_errors_digest`, `runtime_errors_purge`, `device_requests_purge_stale`,
  `pilot_purge_dead_link_codes`, `ops_backup_audit_ping`, `schema_drift_check`.
* **Utility / RLS plumbing**: `squadron_id`, `is_super_admin`, `is_commander`,
  `is_wing`, `is_base`, `is_hq`, `current_pc_id`, `current_user_email`.

To list them all from prod:

```sql
select n.nspname, p.proname
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
 order by p.proname;
```

### 5.3 Edge functions (14 deployed; status `ACTIVE` for all)

| Slug | Version | Purpose |
|---|---|---|
| `super-admin-2fa` | 8 | Verify TOTP / consume recovery code; mints super-admin JWT. |
| `validate-license` | 6 | **Legacy** — License-Keys validation. Should be retired. |
| `link-pilot-device` | 15 | Pilot mobile: bind device to pilot via short-lived link code. |
| `manage-reminder-schedule` | 6 | Toggle / reschedule the daily reminders cron via one HTTPS call. |
| `notify-currency-expiry` | 6 | Send expo-push notifications for currencies nearing expiry. |
| `provision-user` | 6 | Create an `auth.users` row + stamp `app_metadata` for new ops accounts. |
| `register-license` | 6 | **Legacy** — License-Keys registration. Should be retired. |
| `provision-commander` | 5 | **Legacy** — Commanders bootstrap. Should be retired. |
| `notify-alert` | 3 | Push pilot alerts to subscribed devices. |
| `notify-notam` | 3 | Push squadron NOTAMs to subscribed devices. |
| `heal-claims` | 1 | One-shot fix-up: reconciles `app_metadata` claims for users whose JWT got out of sync with `unit_members.role`. |
| `unit-approve-device` | 3 | Super-admin approves a pending device request → mints credentials. |
| `unit-claim-device` | 1 | Joining PC redeems its claim token to retrieve its bound credentials. |
| `unit-super-admin-setup` | 1 | One-time bootstrap of the super-admin row + 2FA. |

> **Drift note.** `validate-license`, `register-license`, and `provision-commander`
> are still ACTIVE despite Task #300 having retired the License-Keys + Commanders
> on-disk surfaces. Their tables (`commanders`, `license_keys`) were dropped by
> migration 0081, so any call that reaches them now will error. Suggested
> follow-up: undeploy these three from Supabase. See §11.D.

### 5.4 pg_cron jobs (15 active)

| Job | Schedule (UTC) | Calls |
|---|---|---|
| `xpc-outbox-process` | every minute | `xpc_outbox_process()` — drains outgoing cross-PC events |
| `xpc-outbox-monitor` | every hour at :15 | `xpc_outbox_monitor()` |
| `xpc-purge-inactive-pcs` | 03:00 daily | `xpc_purge_inactive_pcs()` |
| `xpc-purge-archived-messages` | 03:15 daily | `xpc_purge_archived_messages()` |
| `xpc-purge-archived-messages-weekly` | 03:35 Sun | same — weekly safety net |
| `pilot-purge-dead-link-codes` | 03:20 daily | `pilot_purge_dead_link_codes()` |
| `audit-log-archive-sweep` | 03:25 daily | `audit_log_archive_sweep()` |
| `xpc-pair-links-sweep-weekly` | 03:30 Sun | `xpc_pair_links_sweep_internal(90)` |
| `audit-log-size-monitor` | 03:40 daily | `audit_log_size_monitor()` |
| `schema-drift-check-daily` | 03:50 daily | `schema_drift_check()` |
| `ops-backup-audit-ping` | 04:00 daily | `ops_backup_audit_ping()` — heartbeats Supabase backup |
| `xpc-pair-sweep-weekly` | 04:00 Sun | `xpc_pair_links_sweep_internal(90)` (duplicate of -links-) |
| `runtime-errors-digest` | 04:05 daily | `runtime_errors_digest()` — emits a daily summary into audit_log |
| `runtime-errors-purge` | 04:10 daily | `runtime_errors_purge()` |
| `device-requests-purge` | 04:15 daily | `device_requests_purge_stale()` |

Recent runs of `xpc-outbox-process` are all `succeeded` (1-row result),
confirming the outbox is healthy.

> **Drift note.** `xpc-pair-links-sweep-weekly` and `xpc-pair-sweep-weekly`
> both call the same SQL function (`xpc_pair_links_sweep_internal(90)`) within
> 30 minutes of each other on Sunday morning. One of them should be retired —
> see §11.E.

### 5.5 Migrations (89 files, all applied)

Every file in `artifacts/pilot-dashboard/supabase/migrations/` has a row in
`public._migration_ledger` recording `applied_at` + `sha256`. The on-disk count
(89) matches the in-DB count.

Note the **multi-numbered** files at 0051, 0052, 0053, and 0081 — each
collision was independently developed in parallel and applied on the same day;
the ledger preserves their distinct sha256s. The numbering accidentally
overlaps but each file does a different thing. Don't rename them.

| File | One-liner |
|---|---|
| `0001_init.sql` | Initial schema with squadron-isolated RLS. |
| `0002_mobile_link.sql` | Mobile pilot viewer — server-side link verification, per-pilot device tokens. |
| `0003_pilot_self_rls.sql` | Per-pilot Supabase auth identity + row-level isolation for the mobile viewer. |
| `0004_super_admin_2fa.sql` | Super-admin TOTP secrets stored server-side. |
| `0005_pilot_reminders.sql` | Per-pilot currency-expiry reminders. |
| `0006_super_admin_recovery_codes.sql` | Recovery codes for the super-admin TOTP. |
| `0007_reminder_schedule.sql` | One-click pg_cron schedule for the daily reminder push. |
| `0008_reminder_manual_runs.sql` | Track manual "Run now" invocations of notify-currency-expiry. |
| `0009_saved_duty_weeks.sql` | Saved Duty Week rosters. |
| `0010_cross_pc.sql` | Cross-PC workflow tables (the original `xpc_*` set). |
| `0011_alerts.sql` | Pilot alerts (short, time-sensitive messages). |
| `0012_alert_notam_priority.sql` | 3-level priority field on alerts and NOTAMs. |
| `0013_schedule_program.sql` | Adds the full RJAF flight-schedule paper snapshot to `xpc_schedule_shares`. |
| `0014_security_hardening.sql` | Fixes Supabase Security Advisor warnings (mutable search_path, etc.). |
| `0015_security_advisor_fixes.sql` | Resolves all remaining Security Advisor findings. |
| `0016_mobile_link_devices_fix.sql` | Fix mobile pilot linking bookkeeping; `pilot_devices` token model corrections. |
| `0017_sync_indicator.sql` | Pilot-phone "last seen" sync indicator. |
| `0018_sync_indicator_fix.sql` | Two follow-up fixes from code review of 0017. |
| `0019_sync_status_pilot_auth_binding.sql` | Hardens `list_pilot_sync_status()` against stale pilot_id JWT claims. |
| `0020_pilot_devices_unique_constraints.sql` | Real unique constraints on `pilot_devices` (replaces partial indexes). |
| `0021_pilots_military_number_unique.sql` | Enforces unique military number per pilot at the DB level. |
| `0022_pilot_auth_binding_and_nvg.sql` | Two fixes for pilot reminder-prefs persistence + NVG bucket plumbing. |
| `0023_xpc_registry_scoped_visibility.sql` | Tighten `xpc_registry` SELECT visibility. |
| `0024_xpc_registry_directory_visibility.sql` | Restore `xpc_registry` as a full authenticated directory. |
| `0025_xpc_registry_anon_directory.sql` | Allow anon reads of the directory. |
| `0026_license_registry.sql` | Mirror table for every license key the Super Admin generated *(legacy, kept for read)*. |
| `0027_schedule_share_dismissal.sql` | Two columns for schedule-chain dismissal bookkeeping. |
| `0028_widen_tier_constraints.sql` | Widen cross-PC tier CHECK constraints to match real values. |
| `0029_widen_schedule_delete_policy.sql` | v1.1.60 — widen DELETE policy on `xpc_schedule_shares`. |
| `0030_backfill_app_metadata.sql` | v1.1.73 — fix app_metadata stamping for users provisioned before the bug fix. |
| `0031_pilots_rank_en.sql` | Adds `rank_en` column to `pilots` for English rank labels. |
| `0032_retention_cleanup_jobs.sql` | Three daily server-side cleanup jobs (long-term retention). |
| `0033_fix_schedule_update_with_check.sql` | v1.1.90 — fix RLS WITH CHECK on `xpc_schedule_shares` UPDATE. |
| `0034_robust_schedule_insert_rls.sql` | v1.1.93 — make schedule INSERT immune to client-side RLS quirks. |
| `0035_xpc_universal_autoclaim_rls.sql` | v1.1.94 — universal cross-PC autoclaim + relaxed write RLS. |
| `0036_xpc_bulletproof_rls.sql` | v1.1.95 — drop every WITH CHECK predicate beyond bare auth on the cross-PC tables. |
| `0037_org_chart_hierarchy.sql` | Multi-squadron org chart hierarchy (the chain operator-stated in DOMAIN.md §7.1). |
| `0038_xpc_pair_links.sql` | PC pairing Phase 1 — explicit visible pair-codes. |
| `0039_sender_identity_and_squadron_defaults.sql` | Sender identity in messages/shares + per-squadron defaults. |
| `0040_backfill_squadron_defaults.sql` | Adds `wing` column on `squadrons`; backfills defaults. |
| `0041_canon_identity.sql` | Identity normalization in the database (canonical user identity rules). |
| `0042_prod_data_backfill.sql` | One-shot production data cleanup pass. |
| `0043_pgcron_long_term.sql` | Three pg_cron jobs that keep the system clean indefinitely. |
| `0044_migration_ledger.sql` | The `_migration_ledger` table itself + the trigger that maintains it. |
| `0045_round4_fixes.sql` | Task #156 round-4 audit follow-ups, applied 2026-04-24. |
| `0046_fix_xpc_admin_create_pair.sql` | Round-5 audit follow-up — fix ambiguous-column 42702 in xpc_admin_create_pair. |
| `0047_backfill_ops_public_users.sql` | Fix license registration so new ops accounts appear in the audit log. |
| `0048_fix_xpc_redeem_pair_code.sql` | Production blocker fix for self-service cross-PC pairing. |
| `0049_xpc_messages_logical_seat_select.sql` | Receiver SELECT must honour logical-seat addressing. |
| `0050_squadron_rename_xpc_sync.sql` | Keep PC labels in sync when a squadron is renamed. |
| `0051_pilot_rls_lockdown.sql` | Audit F (mobile) — drop squadron-wide `_rw` policies on pilot-facing tables. |
| `0051_reconcile_ghost_ledger.sql` | Remove three "ghost" rows from `_migration_ledger` whose .sql files no longer exist. |
| `0051_xpc_messages_retention_backstop.sql` | Stop the cross-PC chat table from growing forever. |
| `0051_xpc_pair_links_sweep_internal.sql` | Fix silent failure in the weekly cross-PC pair cleanup. |
| `0052_backfill_ledger_sha256.sql` | Backfill the `sha256` column on every existing row in `_migration_ledger`. |
| `0052_xpc_messages_autoclaim_no_recipient_grant.sql` | Stop senders from silently gaining access to recipients' inboxes. |
| `0053_backfill_xpc_squadron_name_snapshots.sql` | Backfill stale squadron-name snapshots in `xpc_pending` and `xpc_schedule_shares`. |
| `0053_pilot_transfer.sql` | Inter-squadron pilot transfer (capability 3 of Task #26). |
| `0054_squadron_rename_xpc_sync_pending_shares.sql` | Extend the squadron-rename sync trigger to cover pending shares. |
| `0055_assert_pair_code_out_collision_class.sql` | Generic in-migration guard for the 42702 ambiguous-column defect class. |
| `0056_schedchain_align_current_tier.sql` | Align `xpc_schedule_shares.current_tier` CHECK constraint with the schedule-chain spec. |
| `0057_xpc_outbox.sql` | Outbox pattern for cross-PC events (eventual consistency). |
| `0058_monthly_close_immutability.sql` | Closed-month immutability — prevent edits to sorties in closed months. |
| `0059_runtime_errors.sql` | Runtime error capture (UI exceptions go into Postgres). |
| `0060_schema_drift_check.sql` | Long-term schema drift detection job. |
| `0061_snapshot_rls_select_strict.sql` | Stop every signed-in user from reading every squadron's snapshot row. |
| `0062_audit_log_archive.sql` | Audit-log retention strategy (move >1y rows to `audit_log_archive`). |
| `0063_snapshot_rls_lockdown.sql` | Round 3 O — Part A; subsumes task #246. |
| `0064_xpc_pending_rls_realignment.sql` | Round 4 AA3 — Audit P defect P-3. |
| `0065_schema_drift_restoration.sql` | Round 4 AA3 — restore audit_log.action and reminder_schedules columns flagged in MASTER GO/NO-GO. |
| `0066_snapshot_payload_hours_marker.sql` | Round 4 AA3 — marker for #268 (commander rollups showing 0h). |
| `0067_xpc_is_super_admin_widen_jwt.sql` | Widen `xpc_is_super_admin()` to accept legacy JWT shape (compat). |
| `0068_xpc_is_super_admin_canonical_only.sql` | Walk back 0067 — canonical role only. Pair this with the dashboard JWT-vs-gate guard (Task #290). |
| `0069_unit_members_devices_join_requests.sql` | Task #299 — replace License Keys + Commanders + Generate Code + Set up this device with the **Join → Approve → Bind** flow. |
| `0070_unit_config_join_secret.sql` | Followup to 0069 — `unit_config.join_secret` (anti-spam gate for join). |
| `0071_unit_complete_approval_service_role_check.sql` | Followup — service-role check on `unit_complete_approval`. |
| `0072_unit_jwt_claim_reads.sql` | Followup — read auth user via JWT helper instead of raw GUC. |
| `0073_unit_member_self_ambiguous_fix.sql` | Followup — fix OUT-parameter name collision in `unit_member_self`. |
| `0074_unit_remove_member_correct_cols.sql` | Followup — `unit_remove_member` referenced columns that don't exist. |
| `0075_unit_security_hardening.sql` | Review-pass hardening (3 changes). |
| `0076_rotate_leaked_join_secret.sql` | Rotate the join secret (the literal value in 0070 was a leak). |
| `0077_fix_remove_member_refresh_token_cast.sql` | Fix `auth.refresh_tokens.user_id` varchar cast in `unit_remove_member`. |
| `0078_review_round3_hardening.sql` | Review round 3 — `unit_super_admin_setup_allowed` checks both legacy and `unit_members`. |
| `0079_originating_city.sql` | Add `device_requests.originating_city`; surface it in `unit_pending_requests`. |
| `0080_fix_hq_privilege_escalation.sql` | Close the HQ → super_admin privilege escalation in `unit_reserve_approval`. |
| `0081_drop_legacy_license_commander_tables.sql` | Task #300 — drop the legacy License Keys + Commanders tables. |
| `0081_unit_reject_drop_password_plain.sql` | `unit_reject_request`: stop writing the dropped `password_plain` column. |
| `0082_users_role_check_allow_commander.sql` | Allow `commander` and `super_admin` in the legacy `public.users.role` CHECK constraint. |
| `0083_xpc_schedule_select_chain_pc_ids.sql` | Task #308 — restore squadron→wing→base→HQ schedule forwarding (PROD RLS fix). |

To confirm all are applied:

```sql
select count(*) from public._migration_ledger;
-- expect: 89 (matches the on-disk file count)
```

---

## 6. Source tree — one-liners

### 6.1 Dashboard (`artifacts/pilot-dashboard/src/`, 194 files)

> The 56 files under `components/ui/` are vanilla shadcn/ui primitives
> (button, dialog, table, popover, etc.). They don't carry product logic and
> are listed only as a group below.

**Top-level (3):**
- `App.tsx` — root router; gates routes by role (super-admin / pending / member); evaluates `LoginGate` at `/login` BEFORE the FirstLaunch redirect.
- `main.tsx` — Vite/React entry; mounts `<App>`.
- `index.css` — Tailwind base + custom RJAF tokens.

**Pages (`pages/`, 60 files):**

| File | Purpose |
|---|---|
| `AddSortie.tsx` | Sortie-entry form; drives the dual-credit auto-rule for IRT/Course/StandEval/EmTrng. |
| `Archives.tsx` | Squadron archives view (deleted-pilot recovery, snapshots). |
| `AuditLog.tsx` | Squadron-scoped audit log. |
| `Connections.tsx` | Cross-PC connection map / pairing UI. |
| `Coordinating.tsx` | Coordinating-tier inbox view. |
| `Currency.tsx` | Per-pilot currency + expiry table. |
| `Cycle.tsx` | Currency cycle / refresh history. |
| `Dashboard.tsx` | Squadron home dashboard (counts, recent activity, sticky notes). |
| `Diagnostic.tsx` | Self-test diagnostics (DB ping, version, claims, env). |
| `DutyWeek.tsx` | Duty-week rota editor + saved-week loader. |
| `ExpiredAfter.tsx` | "Find expired since X" reporting view. |
| `ExternalPilots.tsx` | Manage guest/external pilot list per squadron. |
| `FinalSchedules.tsx` | Final schedule (post-chain approval) view. |
| `FirstLaunch.tsx` | **v1.1.124** — RJAF emblem, "Squadron Management System" title, three buttons: Join, Setup-as-super-admin, Super admin sign-in. |
| `FlightProgram.tsx` | Daily flight-program builder. |
| `GuestBackfill.tsx` | Backfill guest-pilot rows on cross-squadron sorties. |
| `Help.tsx` | In-app help / about. |
| `HistoricalImport.tsx` | Import legacy CSV/XLSX into the squadron. |
| `JoinSetup.tsx` | The Join-Setup wizard (v1.1.122+ — replaces SetupSquadron). |
| `Leaves.tsx` | Pilot leave per-month editor. |
| `Login.tsx` | Email + password sign-in (used by all approved members AND super-admin). |
| `Messages.tsx` | Cross-PC messaging inbox. |
| `MonthlyReport.tsx` | Squadron monthly report (Forms 1–4) — primary reporting deliverable. |
| `MonthlyReportDefaults.tsx` | Per-squadron defaults for the monthly report. |
| `NavRoutes.tsx` | Sidebar nav config (single source of truth for menu items). |
| `NotamsPage.tsx` | Squadron NOTAMs list / create. |
| `OpsTeam.tsx` | Manage the squadron's ops-team (commanders / safety / training officers). |
| `PdfExports.tsx` | One-click PDF batch (currency, monthly report, pilot record). |
| `PendingApprovals.tsx` | Super-admin queue: incoming join requests (commander / wing / base / HQ). |
| `PilotDetail.tsx` | Per-pilot profile (totals, currencies, alerts, last sortie). |
| `Rankings.tsx` | Pilot ranking table — totals + half-year + currencies. |
| `Reminders.tsx` | Currency-reminder schedule + manual-run history. |
| `Risk.tsx` | Risk-matrix entry (per-flight risk score). |
| `Roster.tsx` | Pilot roster + currency form (with Last Medical / Last Simulator). |
| `Schedule.tsx` | Schedule editor for today / a date range. |
| `ScheduleChain.tsx` | Submit-edit-approve schedule chain UI. |
| `ScheduleHistory.tsx` | Past schedules archive. |
| `Settings.tsx` | Squadron settings (currency windows, defaults, branding). |
| `SortieLog.tsx` | Reverse-chronological sortie list with filters. |
| `StickyNotes.tsx` | Squadron sticky-notes panel. |
| `SuperAdminSetup.tsx` | One-time super-admin bootstrap wizard. |
| `Unavailable.tsx` | Mark a pilot unavailable (date-range). |
| `Units.tsx` | Per-squadron units (sub-units / dets) editor. |
| `Users.tsx` | Squadron users management (now reads `unit_members`). |
| `WaitingForApproval.tsx` | Splash shown to a freshly-joined PC while super-admin reviews. |
| `not-found.tsx` | 404 fallback. |
| `dashboard/Alerts.tsx` | Squadron alerts list. |
| `dashboard/Currencies.tsx` | Currency overview tile (squadron-wide). |
| `dashboard/FlightRecords.tsx` | Flight-records table tile. |
| `dashboard/Overview.tsx` | Top-line numbers tile. |
| `dashboard/PilotAlerts.tsx` | Per-pilot alerts feed. |
| `dashboard/PilotDetail.tsx` | Per-pilot detail tile (used by Dashboard nav). |
| `dashboard/PilotsTable.tsx` | Pilots table widget. |
| `dashboard/Simulator.tsx` | Simulator-monitoring tile. |
| `dashboard/UnavailableView.tsx` | Currently-unavailable pilots tile. |
| `admin/AuditLog.tsx` | Cross-squadron audit log (super-admin only). |
| `admin/ConnectionMap.tsx` | All-PCs connection graph (super-admin). |
| `admin/DevicesUsers.tsx` | All bound devices/users (super-admin). |
| `admin/Overview.tsx` | Super-admin home (cluster health, version skew). |
| `admin/PendingDevices.tsx` | Pending device-requests queue (super-admin). |
| `admin/ReminderLog.tsx` | Daily reminder send log. |
| `admin/RemindersSchedule.tsx` | Edit the reminder cron schedule. |
| `admin/Security.tsx` | Super-admin security: TOTP, recovery codes, password change. |
| `admin/Squadrons.tsx` | Manage squadron rows (calls the buggy `addSquadron` — see §11.B). |

**Components (`components/`, 27 files + 56 in `ui/`):**

| File | Purpose |
|---|---|
| `BackupCard.tsx` | Manual backup trigger card. |
| `CalendarPickerInput.tsx` | Date-of-birth / past-date picker. |
| `CommanderEmptyState.tsx` | Commander-tier "no squadrons assigned yet" empty state. |
| `ConfirmDialog.tsx` | Generic destructive-action confirm modal. |
| `DataUnavailableBanner.tsx` | Shown when DB read fails (offline / RLS denial). |
| `DateInput.tsx` | Standard date input. |
| `ErrorBoundary.tsx` | React error boundary → routes through `runtimeErrorReporter`. |
| `FlightBindingGate.tsx` | Wrapper that requires the PC to be bound to a squadron. |
| `FlightScheduleSheet.tsx` | The paper-form flight schedule renderer. |
| `FrozenAccessPanel.tsx` | Shown to a member whose squadron has been archived. |
| `HQLayout.tsx` | HQ-tier shell (no squadron context). |
| `HeartbeatFailureBanner.tsx` | Shown when xpc_registry heartbeat fails repeatedly. |
| `IdentityStrip.tsx` | Top-bar identity + tier + squadron pill. |
| `IncomingAlertWatcher.tsx` | Polls for new alerts; pushes a toast. |
| `Layout.tsx` | Standard (squadron) shell with sidebar + identity strip. |
| `LiveDataIndicator.tsx` | "Live ✓ / Stale ⚠" indicator. |
| `LockScreen.tsx` | Idle-timeout lock screen (PIN re-entry). |
| `MultiSegmentField.tsx` | Multi-segment input (e.g. military number / phone). |
| `OpeningAnimation.tsx` | RJAF emblem opening splash. |
| `PrintHeader.tsx` | Branded print/PDF header. |
| `RecoveryCodesLowBanner.tsx` | Warns super-admin when ≤3 recovery codes remain. |
| `SessionCollisionBanner.tsx` | Warns when two PCs share the same auth session. |
| `SnapshotStalenessBanner.tsx` | Warns when commander's last snapshot is >X days old. |
| `SortieDiffDialog.tsx` | Show diff before applying a sortie edit (the "Refresh currencies" button lives here). |
| `SquadronScopePicker.tsx` | Commander/Wing/Base/HQ squadron-scope dropdown. |
| `StatusBadge.tsx` | Green/Yellow/Red status pill. |
| `UndoToast.tsx` | "Undo" toast for destructive actions. |
| `ui/accordion.tsx` | shadcn/ui primitive |
| `ui/alert-dialog.tsx` | shadcn/ui primitive |
| `ui/alert.tsx` | shadcn/ui primitive |
| `ui/aspect-ratio.tsx` | shadcn/ui primitive |
| `ui/avatar.tsx` | shadcn/ui primitive |
| `ui/badge.tsx` | shadcn/ui primitive |
| `ui/breadcrumb.tsx` | shadcn/ui primitive |
| `ui/button-group.tsx` | shadcn/ui primitive |
| `ui/button.tsx` | shadcn/ui primitive |
| `ui/calendar.tsx` | shadcn/ui primitive |
| `ui/card.tsx` | shadcn/ui primitive |
| `ui/carousel.tsx` | shadcn/ui primitive |
| `ui/chart.tsx` | shadcn/ui primitive |
| `ui/checkbox.tsx` | shadcn/ui primitive |
| `ui/collapsible.tsx` | shadcn/ui primitive |
| `ui/command.tsx` | shadcn/ui primitive |
| `ui/context-menu.tsx` | shadcn/ui primitive |
| `ui/dialog.tsx` | shadcn/ui primitive |
| `ui/drawer.tsx` | shadcn/ui primitive |
| `ui/dropdown-menu.tsx` | shadcn/ui primitive |
| `ui/empty.tsx` | shadcn/ui primitive |
| `ui/field.tsx` | shadcn/ui primitive |
| `ui/form.tsx` | shadcn/ui primitive |
| `ui/hover-card.tsx` | shadcn/ui primitive |
| `ui/input-group.tsx` | shadcn/ui primitive |
| `ui/input-otp.tsx` | shadcn/ui primitive |
| `ui/input.tsx` | shadcn/ui primitive |
| `ui/item.tsx` | shadcn/ui primitive |
| `ui/kbd.tsx` | shadcn/ui primitive |
| `ui/label.tsx` | shadcn/ui primitive |
| `ui/menubar.tsx` | shadcn/ui primitive |
| `ui/navigation-menu.tsx` | shadcn/ui primitive |
| `ui/pagination.tsx` | shadcn/ui primitive |
| `ui/popover.tsx` | shadcn/ui primitive |
| `ui/progress.tsx` | shadcn/ui primitive |
| `ui/radio-group.tsx` | shadcn/ui primitive |
| `ui/resizable.tsx` | shadcn/ui primitive |
| `ui/scroll-area.tsx` | shadcn/ui primitive |
| `ui/select.tsx` | shadcn/ui primitive |
| `ui/separator.tsx` | shadcn/ui primitive |
| `ui/sheet.tsx` | shadcn/ui primitive |
| `ui/sidebar.tsx` | shadcn/ui primitive |
| `ui/skeleton.tsx` | shadcn/ui primitive |
| `ui/slider.tsx` | shadcn/ui primitive |
| `ui/sonner.tsx` | shadcn/ui primitive |
| `ui/spinner.tsx` | shadcn/ui primitive |
| `ui/switch.tsx` | shadcn/ui primitive |
| `ui/table.tsx` | shadcn/ui primitive |
| `ui/tabs.tsx` | shadcn/ui primitive |
| `ui/textarea.tsx` | shadcn/ui primitive |
| `ui/toast.tsx` | shadcn/ui primitive |
| `ui/toaster.tsx` | shadcn/ui primitive |
| `ui/toggle-group.tsx` | shadcn/ui primitive |
| `ui/toggle.tsx` | shadcn/ui primitive |
| `ui/tooltip.tsx` | shadcn/ui primitive |

**Lib (`lib/`, 41 files):**

| File | Purpose |
|---|---|
| `archive.ts` | Soft-archive of squadron + restore. |
| `auth.tsx` | TOTP helpers + `useAuth()` hook + claims parser; TOTP issuer = `RJAF Pilot Dashboard` (do NOT rename — see v1.1.124 plan). |
| `backup.ts` | Manual backup export. |
| `calculations.ts` | **Source of truth for hours math.** See §7. Mirrored in mobile. |
| `calculations.audit.test.ts` | Audit-pass calculation tests. |
| `calculations.audit-2.test.ts` | Round-2 audit tests. |
| `calculations.parity.test.ts` | Asserts dashboard ↔ mobile compute identical totals. |
| `commander-empty-state.ts` | "No squadrons assigned" detection. |
| `commander-empty-state.test.ts` | Tests for the above. |
| `commander-store.ts` | Local cache of commander assignments. |
| `cross-pc.ts` | Cross-PC primitives: pairing, send/receive messages, schedule chain (~3000 LOC — biggest file). |
| `currency-settings.ts` | Per-squadron currency-window editor. |
| `dash-pilots.ts` | Pilot list normalization for the dashboard. |
| `format.ts` | Date / hours / number formatting helpers. |
| `i18n.tsx` | i18n wrapper (English + Arabic). |
| `license-registry.ts` | **Legacy** — read-only client for `license_registry` table. |
| `match-guest-pilot.ts` | Fuzzy-match a guest pilot name to a known pilot. |
| `match-guest-pilot.test.ts` | Tests for the above. |
| `mock.ts` | Dev-time mock client (test fixtures). |
| `mockData.ts` | Seed data for offline dev. |
| `monthly-close.ts` | Monthly-close gating logic. |
| `monthly-report.ts` | Monthly-report generator (Forms 1–4). |
| `offlineQueue.ts` | Local queue for actions taken while offline. |
| `pairs.ts` | Cross-PC pair helpers. |
| `pdf.ts` | PDF generation (jsPDF wrapper). |
| `pilot-transfer-policy.ts` | Inter-squadron pilot transfer permission rules (migration 0053). |
| `query-client.ts` | TanStack Query client config. |
| `ranks.ts` | Rank label table (English / Arabic). |
| `reminder-session.ts` | Reminder session bookkeeping. |
| `runtimeErrorReporter.ts` | Captures UI exceptions → POSTs to `runtime_errors` table. |
| `schema-errors.ts` | RLS error → friendly message mapping. |
| `sidebar-badges.ts` | Computes the unread-count badges in the sidebar. |
| `squadron-data.ts` | Squadron data primitives (~2900 LOC); contains `applyCurrencyRefresh` / `refreshCurrenciesForSortie`. |
| `squadron-defaults.ts` | Per-squadron default aircraft / monthly targets. |
| `squadron-scope.ts` | Squadron-scope helpers for commander/wing/base/HQ. |
| `squadron-store.ts` | **The squadron registry. addSquadron writes ONLY to localStorage — see §11.B.** |
| `supabase.ts` | Supabase client factory. |
| `supabase-auth-wrap.test.ts` | Tests the auth-wrap helper. |
| `totp.ts` | TOTP / recovery code helpers (used by 2FA + recovery print). |
| `types.ts` | All shared TypeScript types (Pilot, Sortie, Squadron, etc.). |
| `undo-store.ts` | Undo stack for destructive actions. |
| `unit-join.ts` | Multi-PC join client (calls `unit_request_join`, polls for approval). |
| `use-idle-timeout.ts` | Idle-timeout hook → triggers lockscreen. |
| `utils.ts` | Tailwind `cn()`, generic helpers. |

**Hooks (`hooks/`, 2 files):**
- `use-mobile.tsx` — `useIsMobile()` (viewport <768px).
- `use-toast.ts` — toast state hook.

### 6.2 Mobile (`artifacts/pilot-mobile/`, 34 files)

**App routes (`app/`, 13 files — expo-router):**
- `_layout.tsx` — root layout; provides theme, auth, error boundary.
- `+not-found.tsx` — 404.
- `link.tsx` — pilot device-linking entry (paste link code from PC).
- `lock.tsx` — biometric / PIN lock screen.
- `setup-lock.tsx` — first-launch lock setup.
- `reminders.tsx` — reminder-prefs editor.
- `(tabs)/_layout.tsx` — tab bar.
- `(tabs)/index.tsx` — Home tab (today's sorties + currency tiles).
- `(tabs)/log.tsx` — Sortie log.
- `(tabs)/currency.tsx` — Currency expiry list.
- `(tabs)/alerts.tsx` — Pilot alerts.
- `(tabs)/notams.tsx` — Squadron NOTAMs.
- `(tabs)/settings.tsx` — Settings (notifications, language, sign out).

**Components (`components/`, 7 files):**
- `CurrencyRow.tsx` — single-currency row.
- `CurrencyTile.tsx` — currency tile (color-coded).
- `ErrorBoundary.tsx` — catches RN render errors → reports.
- `ErrorFallback.tsx` — fallback UI.
- `KeyboardAwareScrollViewCompat.tsx` — keyboard-aware scroll wrapper (RN compat shim).
- `SortieRow.tsx` — single sortie row.
- `WingsIntro.tsx` — first-launch animated intro.

**Lib (`lib/`, 11 files):**
- `calculations.ts` — Hours-math engine (mirror of dashboard's, asserted by parity test).
- `calculations.audit.test.ts` — Audit tests.
- `data.tsx` — Pilot/Sortie data context provider.
- `i18n.tsx` — i18n wrapper.
- `mockData.ts` — dev-time mocks.
- `notifications.ts` — Expo push notification setup.
- `password.ts` — local PIN hashing.
- `runtimeErrorReporter.ts` — RN error reporter → POSTs to `runtime_errors`.
- `storage.ts` — AsyncStorage wrapper.
- `supabase.ts` — Supabase client factory.
- `types.ts` — Shared TS types.

**Other (3 files):**
- `constants/colors.ts` — Color tokens.
- `expo-env.d.ts` — Expo TS env shim.
- `hooks/useColors.ts` — Theme hook.

---

## 7. Domain calculations (with worked examples)

The two source-of-truth files are
`artifacts/pilot-dashboard/src/lib/calculations.ts` and
`artifacts/pilot-mobile/lib/calculations.ts`. They MUST stay in lockstep —
`calculations.parity.test.ts` asserts identical output for shared fixtures.

### 7.1 The eleven sortie buckets

A sortie row carries up to 11 numeric "time" fields, all in hours:

| Field | Meaning |
|---|---|
| `day1` | Day, 1st pilot (captain) |
| `day2` | Day, 2nd pilot (co-pilot) |
| `dayDual` | Day, dual instruction |
| `night1` | Night, 1st pilot |
| `night2` | Night, 2nd pilot |
| `nightDual` | Night, dual instruction |
| `nvg` | NVG total (legacy single-bucket) |
| `nvg1` / `nvg2` / `nvgDual` | NVG split (newer rows) |
| `sim` | Simulator |
| `actual` | Total airframe time (falls back to `day+night+nvg+sim`) |

`computePilotTotals(pilot, allSorties)` walks every sortie that mentions
`pilot.id` in either `pilotId` (left seat) or `coPilotId` (right seat),
buckets it into:
- **Month-to-date** (current calendar month).
- **All-time totals** (lifetime, across both seats).
- **H1 / H2** half-year buckets (current calendar year only — never bleeds
  last year's flights into this year's halves).

### 7.2 Captain credit — the per-seat flag

For each sortie, the captain credit goes to whichever seat carries the
explicit per-seat captain flag:
- `pilotIsCaptain: true` → left-seat is captain.
- `coPilotIsCaptain: true` → right-seat is captain.

If both flags are absent (very old rows pre-dating the per-seat flag), the
fallback assumption is **left-seat (P1) = captain**. The captain seat's hours
fold into `monthCaptain` / `totalCaptain`. Co-pilot hours never count as
captain unless explicitly flagged.

### 7.3 Initial Hours (baseline)

A pilot can carry pre-Hawk-Eye lifetime hours via `pilot.initialHours`. These
fold into:
- `totalDay`, `totalNight`, `totalNvg`, `totalCaptain`.
- The "Initial Hours" overlay stat (instrument hours overlay on Pilot Detail).

Initial Hours **never** affect:
- Currency / expiry calculations (those use last-flight date only).
- Monthly Report (Forms 1–4) — "monthly" means hours flown while using Hawk Eye.
- Half-year (H1/H2) buckets.
- Grand Total — captain & instrument baselines are overlay stats, not summed in.

See `.local/memory/initial-hours.md` for the full per-bucket table.

### 7.4 Dual auto-credit (instructional sortie types)

For these six sortie types (case-insensitive, after `.trim().toUpperCase()`),
the right-seat pilot's hours are **automatically routed** as DUAL regardless of
the operator's pick:

```
IRT, COURSE DAY, COURSE NVG, COURSE NIGHT, EMERGENCY TRAINING, STAND EVAL
```

Side effects:
- `coPilotSeatStatus` is persisted as `"Dual"`.
- Co-pilot hours go into `dayDual` / `nightDual` / `nvgDual`.
- Sortie-level `dual` flag is set true.
- Left-seat status is **not** touched.

Implementation: `pages/AddSortie.tsx` → `DUAL_REQUIRED_TYPES` (~line 51),
`isDualRequired()` (~line 55), `effectiveCoPilotStatus` (~line 301).

### 7.5 Currency keys (5 real, 1 monitoring-only)

| Key | Window | Trigger |
|---|---|---|
| `day` | 30d (squadron-tunable) | Any sortie with day1/day2/dayDual > 0 |
| `night` | 30d | Any sortie with night1/night2/nightDual > 0 |
| `nvg` | 30d | Any sortie with nvg/nvg1/nvg2/nvgDual > 0 |
| `irt` | 365d | `instrumentFlight === true` OR `sortieType === "IRT"` |
| `medical` | 365d | Operator-set via Roster's "Last Medical" date |
| `sim` | **none** | Operator-set via Roster's "Last Simulator" — display only, no expiry |

`bumpDate` is monotonic — it only moves expiry forward, never back. That's why
the "Refresh currencies" button in `SortieDiffDialog` is safe to spam.

`missionQual` is RETIRED (was a brief slot in v1.1.40–v1.1.76). Read-side may
tolerate stale rows; write-side must not produce new ones.

### 7.6 Worked example — single sortie

Pilot A flies a 2.0 h IRT (day) with Pilot B as co-pilot, both NVG-capable, on
2026-04-25. Sortie record:

```
date          2026-04-25
sortieType    IRT
pilotId       A      pilotIsCaptain   true   day1=2.0
coPilotId     B      coPilotIsCaptain false  day2=2.0  ← but DUAL rule overrides
```

Effective bucketing after `AddSortie` saves:

```
day1=2.0, day2=0, dayDual=2.0, night*=0, nvg*=0, sim=0, actual=2.0
coPilotSeatStatus = "Dual"
dual = true
```

For Pilot A (`computePilotTotals(A, [sortie])`):
- `c.day = day1 + day2 + dayDual = 2.0 + 0 + 2.0 = 4.0`  *(hard-coded math —
  yes, the day bucket sums all three sub-fields; the actual airframe time of
  2.0 h is preserved separately as `c.actual`)*
- `c.actual = 2.0` (operator-set), captain credit = 2.0.
- `monthDay = 4.0`, `monthCaptain = 2.0`.
- Currency: `irt` is bumped (forward 365d), `day` is bumped (forward 30d).

For Pilot B (right seat in same sortie, dual auto-credit):
- `c.day = 4.0` (same), captain credit = 0.0 (their seat flag was false).
- `monthDay = 4.0`, `monthCaptain = 0`.
- Currency: `irt` bumped (sortieType === "IRT"), `day` bumped.

> **Note on the day-bucket sum.** This is intentional: the per-pilot "Day
> Hours" stat shown in PDFs and on Pilot Detail counts BOTH the captain and
> co-pilot allocations as the pilot's day-hours. The airframe-time
> `c.actual = 2.0` is what's reported in the monthly report's airframe-hours
> column. If this surprises you, see the audit tests in
> `lib/calculations.audit.test.ts` for the exhaustive matrix.

### 7.7 Worked example — half-year roll-up

Pilot A in calendar year 2026 has these sorties (all IRT day, 2.0 h each, A
captain):

```
2026-02-10   2.0h day captain
2026-05-30   2.0h day captain
2026-07-15   2.0h day captain
2026-12-01   2.0h day captain
```

After `computePilotTotals`:

```
h1 (Jan–Jun): day=8.0  captain=4.0  total=8.0  sorties=2
h2 (Jul–Dec): day=8.0  captain=4.0  total=8.0  sorties=2
yearHours = 16.0
```

Note `total` includes Day+Night+NVG+Sim — v1.1.69 fixed a bug where it only
summed Day+Night and hid NVG/Sim from the half-year totals.

---

## 8. Cross-PC chain

The forwarding chain (per DOMAIN.md §7.1):

```
Squadron Ops PC  →  Flight Commander PC  →  Wing PC  →  Base PC  →  HQ PC
```

Each tier has ONE row in `xpc_registry` per PC (heartbeated on every page
load). Cross-tier traffic flows through:

* `xpc_messages` — chat-style messages between any two PCs.
* `xpc_pending` — guest-pilot sortie approvals (cross-squadron).
* `xpc_schedule_shares` — flight schedules forwarded up the chain.
* `xpc_outbox` — outbox for events that need eventual delivery.
* `xpc_squadron_snapshot` — periodic state dumps for commanders to read.
* `xpc_pair_links` / `xpc_pair_codes` — explicit visible PC pairings.

The `chain_pc_ids` array column on `xpc_schedule_shares` (added by migration
0083) is what makes a single share row visible to every PC in the chain
without each one having to issue a separate cross-tier query. It's set on
INSERT by `xpc_schedule_select_chain_pc_ids()`. Without this fix (Task #308),
schedule forwarding silently broke for 2-3 days in PROD.

For the schedule-chain submit/edit/approve state machine, see
`.local/memory/schedule-chain.md`.

---

## 9. Auth, permissions, and the join secret

### 9.1 Identity model

* **Single Supabase Auth user per identity.** A super-admin, a commander, a
  wing officer, an HQ user, AND a pilot all live in the same `auth.users`
  table.
* **Role lives in `auth.users.app_metadata.role`** (super_admin / commander /
  wing / base / hq / pilot). Migration 0067/0068 + Task #290's CI guard ensure
  the JWT shape is canonical (no `role:"super_admin"` in user_metadata, no
  legacy claims).
* **Squadron scope lives in `app_metadata.squadron_id`** plus the
  `unit_members.squadron_allow_list` array for multi-squadron commanders.
* **Mobile pilots have a special `pilot_id` claim** in `app_metadata` for RLS
  on `pilots`/`sorties`/`alerts`/`notams`.

### 9.2 The four gate functions in Postgres

`is_super_admin()`, `is_commander()`, `is_wing()`, `is_base()`, `is_hq()` —
all read `auth.jwt()->>'role'` (canonical claim). `xpc_is_super_admin()` is a
specialised version used by the `xpc_*` RLS policies.

### 9.3 The join secret

`unit_config.join_secret` is a 64-char random string. It is **not** a
privilege-escalation gate — it's an anti-spam / anti-anonymous-flood gate on
`unit_request_join`. The actual privilege escalation is gated by:
- The super-admin's manual approval click (`unit_reserve_approval` →
  `unit_complete_approval`).
- The bootstrap-once trigger on `unit_super_admin_setup_allowed()`.
- The role CHECK constraint on `unit_members.role`.

Loss of the join secret allows random PCs to send join requests, but they
still need super-admin approval to be admitted. Treat it as a moderate-
sensitivity secret: rotate via a new migration if it leaks.

### 9.4 The TOTP issuer string

`auth.tsx` uses issuer = `RJAF Pilot Dashboard`. **Never rename this** — it
would orphan every existing entry in the operator's authenticator app. The
v1.1.124 cosmetic rename to "Squadron Management System" deliberately left
this alone.

---

## 10. Multi-PC join flow (Join → Approve → Bind)

This replaces the retired License-Keys + Generate-Code + Set-Up-This-Device
system (Task #299, migrations 0069–0080).

```
PC (joining)                   Super-admin PC                Supabase
    |                                |                          |
    | 1. unit_request_join(secret,  |                          |
    |    role, squadrons, name,     |                          |
    |    fingerprint, originating_  |                          |
    |    city)                      |                          |
    |  ───────────────────────────────────────────────────────▶|
    |                                |                          |
    |                                | 2. unit_pending_requests |
    |                                |  ◀───────────────────────|
    |                                |    (poll, or real-time)  |
    |                                |                          |
    |                                | 3. unit_reserve_approval |
    |                                |  ───────────────────────▶|
    |                                | 4. unit-approve-device   |
    |                                |   (edge function — mints |
    |                                |    auth user + claim     |
    |                                |    token)                |
    |                                |  ───────────────────────▶|
    |                                |                          |
    | 5. unit-claim-device (claim    |                          |
    |    token from QR / paper      |                          |
    |    handoff)                   |                          |
    |  ───────────────────────────────────────────────────────▶|
    |                                |                          |
    | 6. signInWithPassword          |                          |
    |  ───────────────────────────────────────────────────────▶|
    | 7. App boots as bound member  |                          |
```

Files:
- `pages/JoinSetup.tsx` — UI for steps 1, 5–7 on the joining PC.
- `pages/PendingApprovals.tsx` — super-admin's queue, steps 2–4.
- `lib/unit-join.ts` — RPC client.
- Edge functions: `unit-approve-device`, `unit-claim-device`,
  `unit-super-admin-setup`.
- Migrations: 0069 (schema), 0070 (join secret), 0071 (service-role check),
  0072 (JWT claim reads), 0073/0074 (column-name fixes), 0075 (hardening),
  0076 (rotated leaked secret), 0077 (refresh_token cast), 0078 (round 3),
  0079 (originating_city), 0080 (HQ→super_admin escalation fix).

The legacy License-Keys + Commanders surfaces are gone from the dashboard
since v1.1.122. The corresponding tables were dropped by 0081. Three legacy
edge functions (`register-license`, `validate-license`, `provision-commander`)
remain deployed but are dead — see §11.D.

---

## 11. Known broken / drift / open risks

### 11.A Squadron rows have NULL `wing_id`
Today's `8 Squadron` row has `wing_id = NULL` because no `wings` row exists.
Schedule-chain forwarding to wing/base/HQ tiers will short-circuit (no chain
PC IDs to forward to) until at least one wing is inserted and the squadron is
linked. Concrete fix:

```sql
insert into public.wings (name, base_id) values ('8 WG', '68f92106-562e-40a9-8f74-9b89e6ca7242') returning id;
update public.squadrons set wing_id = '<the new wing id>' where id = 'cc8ae1b7-480f-4189-b746-552aced8addc';
```

### 11.B `addSquadron` is local-only
`artifacts/pilot-dashboard/src/lib/squadron-store.ts:70` writes only to
`localStorage["rjaf.squadrons"]`. The on-disk comment says this is
*deliberate* because the publishable anon key cannot SELECT from RLS-protected
tables — but the anon key also can't INSERT, so the squadron is invisible to
every other PC. **For now, every new squadron must be inserted via the
Supabase Management API server-side** (see §2.1 for the SQL).

A proper fix needs an edge function (`provision-squadron` style — admin gated)
or a signed-server RPC. This is the largest known UX gap.

### 11.C No commander / wing / base / HQ identity exists yet
After today's session there is exactly one auth user (`admin@hq.rjaf.local`)
and zero `unit_members` / `devices` rows. To go live, a super-admin needs to
mint a commander member via the Join → Approve → Bind flow on a real Windows
PC. Cannot be done from the dashboard hosted in Replit (the Replit preview
isn't a standalone PC and won't show in the connection map).

### 11.D Three legacy edge functions still deployed
`validate-license`, `register-license`, and `provision-commander` are still
ACTIVE in Supabase but their tables (`license_keys`, `commanders`) were
dropped by migration 0081. Calling any of them now will error. Suggested:
undeploy via the Supabase Management API:

```
DELETE /v1/projects/nklrdhfsbevckovqqkah/functions/validate-license
DELETE /v1/projects/nklrdhfsbevckovqqkah/functions/register-license
DELETE /v1/projects/nklrdhfsbevckovqqkah/functions/provision-commander
```

### 11.E Two cron jobs do the same thing
`xpc-pair-links-sweep-weekly` (Sun 03:30) and `xpc-pair-sweep-weekly`
(Sun 04:00) both call `xpc_pair_links_sweep_internal(90)`. One should be
unscheduled.

### 11.F Migration number collisions are now baked in
0051, 0052, 0053, and 0081 each have multiple SQL files because parallel
audit branches landed on the same number. The ledger preserves the distinct
sha256s so this is not a correctness issue, but the on-disk numbering is
visually confusing. **Do not rename or merge them** — the next migration
should be `0084_*.sql`.

### 11.G `users` and `license_registry` tables are legacy reads only
Migration 0082 widened the CHECK constraint on `public.users.role` to allow
`commander` / `super_admin`, but no new code writes to `public.users` —
`unit_members` is the new source of truth. `license_registry` is the same:
preserved for historical reads but no live writer.

### 11.H Mobile is still on `version: "0.0.0"`
`artifacts/pilot-mobile/package.json` carries no real version. EAS uses
`runtimeVersion` policy `appVersion` so this needs a bump before the first
real Play Store / App Store push.

### 11.I Secrets / environment variables — exhaustive inventory

Every secret that the running system depends on, where it lives, who uses
it, and what breaks when it is wrong.

### Dashboard (Vite / Electron)

| Var | Purpose | Where set | Used by |
|---|---|---|---|
| `VITE_SUPABASE_URL` | Public Supabase project URL (`https://nklrdhfsbevckovqqkah.supabase.co` for prod). | `.env` for dev, GitHub Action repo secret for build, baked into the Windows installer. | `src/lib/supabase.ts` (browser/Electron client). |
| `VITE_SUPABASE_ANON_KEY` | Anon key for the public Supabase project. Safe to ship in client bundle. | Same as above. | `src/lib/supabase.ts`. |
| `VITE_API_SERVER_URL` | Base URL for the read-only `artifacts/api-server` (used by external dashboards). | Same as above. | `src/lib/api-server.ts` (only when the dashboard is run with the API-server feature flag on). |
| `INSTALL_PASSWORD` | Master install password baked into the NSIS installer prompt. | GitHub Action repo secret, consumed by `electron-builder.json` → `build/installer.nsh`. | The Windows installer at install time only (not the running app). |
| `WINDOWS_CERT_PFX_BASE64`, `WINDOWS_CERT_PASSWORD` | Optional code-signing cert for the Windows installer. | GitHub Action repo secrets. | `.github/workflows/dashboard-windows-installer.yml`. Build still succeeds unsigned if absent (current state). |
| `GITHUB_TOKEN` | Auto-provided by Actions; needed to publish the release asset. | Built into the GH Action runner. | Release-publish step. |

### Edge functions (Supabase secrets, set via `supabase secrets set`)

These are auto-injected on every edge-function invocation; the values
themselves never leave the Supabase platform.

| Var | Purpose | Used by |
|---|---|---|
| `SUPABASE_URL` | Auto-injected; same value as `VITE_SUPABASE_URL`. | Every edge function. |
| `SUPABASE_ANON_KEY` | Auto-injected. Used by edge functions when they need to act *as the caller* (e.g. `heal-claims`, `provision-user` — a user-scoped client is built with the bearer header so `auth.getUser()` resolves). | `heal-claims`, `provision-user`. |
| `SUPABASE_SERVICE_ROLE_KEY` | Auto-injected. Required for any `auth.admin.*` call and any insert that needs to bypass RLS. | All 14 edge functions; particularly `link-pilot-device`, `unit-approve-device`, `unit-claim-device`, `unit-super-admin-setup`, `provision-user`, `notify-alert`, `notify-notam`, `notify-currency-expiry`, `manage-reminder-schedule`. |
| `SUPER_ADMIN_PASSWORD_HASH` | SHA-256 hex of the super-admin password. The plaintext is held only by the operator; the function compares hashes. | `super-admin-2fa` (start action), `manage-reminder-schedule` (reuses for the session action). |
| `CHALLENGE_SECRET` | 32+ byte HMAC key that binds the password step to the TOTP step in 2FA so an attacker cannot skip `start` and call `verify` directly. | `super-admin-2fa`, `manage-reminder-schedule` (session HMAC). |

### Database-side secrets

| Location | Purpose | Notes |
|---|---|---|
| `unit_config.join_secret` (row, plain text) | 64-char random anti-spam gate for the multi-PC join flow. Required as the first POST field by `unit_request_join`. | NEVER appears in the client bundle. Distributed to operators by Major Eyad in person. Rotated by migration `0076` after a previous leak; rotate again the same way if compromised. Read with `select value from public.unit_config where key = 'join_secret';` from a service-role context. |
| `super_admin_2fa.secret_b32` (row, plain text) | TOTP seed for the super-admin authenticator app. | RLS denies all client access. Only `super-admin-2fa` (running with the service-role bearer) can read it. Stored plaintext per the standard TOTP threat model; any attacker who can read this row already has service-role access. |
| `super_admin_2fa.recovery_code_hashes[]` | 10 SHA-256 hashes of one-time recovery codes generated at first 2FA enrollment. | Codes returned to the operator exactly once; only the hashes are stored. On use, `recovery_code_used_at[i]` is stamped so the same code cannot be replayed. |
| `device_requests.password_sha256` | SHA-256 of the joining laptop's chosen password. Held only between the JoinSetup step and the laptop's claim call (typically minutes). | Plaintext password is **never** persisted; only the hash. See `unit-claim-device` source comment for the full rationale. |

### Mobile (Expo)

| Var | Purpose | Where set |
|---|---|---|
| `EXPO_PUBLIC_SUPABASE_URL` | Same Supabase project URL. | `eas.json` profile env per build channel. |
| `EXPO_PUBLIC_SUPABASE_ANON_KEY` | Same anon key. | Same. |

There are **no** other secrets the system needs. Specifically:

* No third-party API keys (Apple Push, FCM, Twilio, …) — push uses Expo's
  free push service which authenticates per-token.
* No analytics, tracing, or telemetry keys.
* The legacy `LICENSE_*` env vars referenced by the deleted
  `register-license` / `validate-license` edge functions are not loaded
  anywhere live; flagged as part of §11.D for cleanup.

---

## 12. Release process

### 12.1 PC dashboard (Windows installer)

The two iron rules from `.local/memory/release-process.md`:

1. **Bump `artifacts/pilot-dashboard/package.json` `version` on every release
   push** (or push a `v*` tag — the workflow auto-bumps from the tag if you do).
   `electron-updater` on the installed PC compares the installed version to the
   latest GitHub Release; if `version` is unchanged, the new build publishes
   but the installed PC reports "no update available."
2. **One trigger per release.** Push to `main` (path filter on
   `artifacts/pilot-dashboard/**`) **OR** push a `v*` tag — never both in the
   same operation. Doing both double-publishes.

Standard checklist (default = main-only push):

```bash
# 1. make code changes
# 2. (optional) bump artifacts/pilot-dashboard/package.json version
# 3. commit and push
git add -A && git commit -m "<msg>"
git push github main
# → triggers .github/workflows/dashboard-windows-installer.yml
# → builds NSIS installer, publishes release on
#   ghneimatabed1-sudo/Flight-hours-tracker-Releases
# → installed PCs pick it up on next electron-updater poll
```

Required GitHub Action secrets (already configured):
- `VITE_API_SERVER_URL`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`
- `VITE_UNIT_JOIN_SECRET` (was missing pre-v1.1.123 — that's what bricked the
  installer until the hotfix; do NOT remove)
- `INSTALL_PASSWORD`
- `RELEASES_PAT` (write access to the public releases repo)

The user sees the update inside the installed app via the in-app update
notification (electron-updater).

### 12.1.1 v1.1.124 release artifact (today's release)

The GitHub Actions job `Build Windows Installer (RJAF Squadron Ops)` produces:

| Field | Value |
|---|---|
| Filename | `HawkEye-Setup-1.1.124.exe` (pattern `HawkEye-Setup-${version}.${ext}` from `electron-builder.json`) |
| App ID | `jo.gov.rjaf.squadron-ops` |
| Product name | `Hawk Eye` |
| Target | NSIS (one-click=false, perMachine, allowElevation) |
| Architecture | x64 |
| Publish target | GitHub release `v1.1.124` on `ghneimatabed1-sudo/Flight-hours-tracker-Releases` (release id `313514458`, html `https://github.com/ghneimatabed1-sudo/Flight-hours-tracker-Releases/releases/tag/v1.1.124`) |
| Companion files | `latest.yml` (electron-updater feed), `HawkEye-Setup-1.1.124.exe.blockmap` |
| Byte size | **92,919,214 bytes** (≈88.6 MB) — read live from the GitHub Releases API on 2026-04-25 (`assets[0].size` for `HawkEye-Setup-1.1.124.exe`). |
| SHA-256 | `372aa29e13f76c3ef45e8c2dbb560250524fde5f7dbe107019fa599c1c935051` (from the `digest` field of the same asset). |
| Asset URL | `https://github.com/ghneimatabed1-sudo/Flight-hours-tracker-Releases/releases/download/v1.1.124/HawkEye-Setup-1.1.124.exe` |
| Published at | `2026-04-25T03:57:18Z` |
| Build host | GitHub Actions `windows-latest` (the Replit Linux container cannot produce the NSIS `.exe` because electron-builder requires Wine or a Windows host; only the renderer step runs locally). |

Verification path on a freshly installed PC:
1. Download `HawkEye-Setup-1.1.124.exe` from the public releases repo.
2. Right-click → Properties → confirm "Royal Jordanian Air Force" copyright string and the `1.1.124` file version.
3. Install (operator enters `INSTALL_PASSWORD`).
4. Launch — the FirstLaunch screen now shows: the official RJAF emblem
   (`brand/emblem.png`), the heading **"Squadron Management System"**, and a
   third button labelled **"Super admin sign-in"** that links to `/login`.
5. The in-app update banner becomes silent (no newer release on the feed).
6. `electron-updater` writes its feed cache under `%APPDATA%/Hawk Eye/`.

If any of those five steps fail, the installer is to be treated as failed
and rolled back to v1.1.123 by re-pushing the previous tag.

### 12.2 Mobile (EAS)

`.github/workflows/mobile-eas-build.yml` triggers EAS Build on Expo. Mobile
release cycle is currently manual (no auto-update channel hooked up); needs a
real version in `pilot-mobile/package.json` before its first store push.

### 12.3 Database migrations

GitHub Actions (separate workflow) applies `artifacts/pilot-dashboard/supabase/
migrations/*.sql` to the prod project via the Supabase Management API. Each
applied file gets a row in `_migration_ledger` with sha256. **Never use
`drizzle-kit push` against this database.** **Never use raw `psql DATABASE_URL`
either** (the project uses pooled connections that don't accept superuser
DDL — see AGENTS.md "Supabase access").

The next migration filename should be `0084_*.sql`.

---

## 13. Cookbooks (common ops)

### 13.1 Add a new squadron

Until §11.B is fixed, do this server-side:

```sql
-- 1. Confirm the base exists (or insert it)
select * from public.bases where name = '<BASE NAME>';
-- insert into public.bases (name) values ('<BASE NAME>') returning id;

-- 2. (Optional) Insert the wing
insert into public.wings (name, base_id) values ('<WG NAME>', '<base_uuid>') returning id;

-- 3. Insert the squadron
insert into public.squadrons (number, name, base, wing, base_id, wing_id)
values ('<num>', '<Name>', '<BASE NAME>', '<wing label>', '<base_uuid>', '<wing_uuid>')
returning id;
```

### 13.2 Reset super-admin TOTP

If the super-admin loses their authenticator AND their recovery codes:

```sql
-- 1. Wipe the row
delete from public.super_admin_2fa where username = 'admin';
-- 2. The next sign-in will run the SuperAdminSetup wizard again.
--    Make sure auth.users still has the admin@hq.rjaf.local row.
select id, email from auth.users where email = 'admin@hq.rjaf.local';
```

### 13.3 Inspect the pending join queue

```sql
select * from public.unit_pending_requests();
```

### 13.4 Force-process the outbox

```sql
select public.xpc_outbox_process();
```

### 13.5 Find which migration last touched X

```sql
select filename, applied_at from public._migration_ledger
 where filename ilike '%xpc_schedule%'
 order by applied_at desc;
```

### 13.6 Roll back the last release

`electron-updater` does NOT support automatic downgrade. To "roll back", ship
a new release with a higher version that re-introduces the previous behaviour.
For DB schema, write a forward-only migration that reverses the change.

---

## 14. Index of supporting docs (status of every other .md)

This is the deliberate map of where to dive deeper. Every doc is either
**CURRENT** (still authoritative on its topic, complements HANDOFF), or
**SUPERSEDED — see HANDOFF.md §X** (folded into this file in full).

### Repo root

| File | Status | Notes |
|---|---|---|
| `replit.md` | **CURRENT** | Agent-facing project overview + recent work log. Read alongside HANDOFF. Banner added pointing here. |
| `AGENTS.md` | **CURRENT** | Operational rules for AI agents (Supabase access, no psql, no Drizzle, etc.). Read before any DB work. Banner added pointing here. |
| `DOMAIN.md` | **CURRENT** | Long-form product domain doc (forms, ranks, sortie types, chain). HANDOFF §7–8 are summaries. Banner added pointing here. |
| `BUILDS.md` | **CURRENT** | Detailed Windows-installer build pipeline. HANDOFF §12 is the summary. Banner added pointing here. |
| `MAINTENANCE_RUNBOOK.md` | **CURRENT** | On-call runbook (incident response). Read when something breaks. Banner added pointing here. |
| `SUPABASE_HEALTH.md` | **SUPERSEDED — see §2 + §5** | Snapshot dated 2026-04-24 with 44 migrations; today is 89 migrations and the database is wiped to the §2 state. HANDOFF §2/5 is the live truth. SUPERSEDED banner added at the top of the file. |
| `threat_model.md` | **CURRENT** | Security model + STRIDE-style threats. Banner added pointing here. |
| `artifacts/pilot-dashboard/README.md` | **CURRENT** | Per-artifact developer quickstart (web preview vs Windows .exe). Banner added pointing here. |
| `artifacts/pilot-dashboard/ELECTRON_BUILD.md` | **CURRENT** | Deep dive on electron-builder configuration. HANDOFF §12.1 / §12.1.1 is the summary. Banner added pointing here. |

### `.local/memory/` (15 files — deep-dives, **WORKSPACE-LOCAL ONLY**)

> **Visibility note (read this first).** `.local/` is gitignored at the
> **system** level (`/etc/.gitignore` on the Replit container), so any file
> under `.local/memory/` or `.local/reports/` is invisible to git, will
> never appear in a diff or PR, and will not exist after a fresh clone.
> Anything documented as a per-feature rule that the next engineer must
> rely on is **mirrored into HANDOFF.md** so the rule survives the clone.
> Treat the `.local/memory/` files as a workspace-local convenience
> (faster lookup for the agent currently running here), **not** as
> authoritative documentation. The authoritative copy is HANDOFF.md.

The 15 files (one per topic) are listed below for completeness. Where the
content matters operationally it has been folded into HANDOFF.md at the
section noted in the right column.

| File | Topic | Where the rule lives in HANDOFF.md |
|---|---|---|
| `active-pc-visibility.md` | 90-second active-window + offline-message rule | §8 (chain) |
| `add-pilot-form.md` | Add-pilot form invariants | (see DOMAIN.md) |
| `currency-refresh.md` | Currency refresh on sortie save | §7.5 |
| `dual-hour-rules.md` | Six sortie types that auto-credit Dual buckets | §7.4 |
| `initial-hours.md` | Pre-Hawk-Eye baseline hours per pilot | §7.3 |
| `multi-squadron.md` | Multi-squadron commander UX | §8 (chain) |
| `multi-squadron-scaling.md` | Scaling notes for many squadrons | §8 (chain) |
| `phone-pair-indicator.md` | Roster green-dot realtime + polling (migrations 0017–0019) | §6 (`pair_links` references) |
| `print-system.md` | Global print rules + `data-print-area` convention | (see DOMAIN.md) |
| `release-process.md` | Iron rules for PC release | §12.1 / §12.1.1 |
| `reminders-wording.md` | "Sent" replaces "Fired" everywhere | (see DOMAIN.md) |
| `schedule-chain.md` | Schedule-chain state machine | §8 |
| `supabase-admin.md` | Supabase Management API access | §11.A guidance + AGENTS.md |
| `user-management.md` | User Manager hidden vs Assigned Ops Pilots visible | (see DOMAIN.md) |
| `README.md` | Index of the .local/memory directory | this section |

### `.local/tasks/` (one file per task; not authoritative beyond their task scope)

Read the relevant `task-NNN.md` when investigating a specific past change.
The most informative recent ones for this handoff:

* `task-314.md` — the task that produced this HANDOFF.
* `v1.1.124-emblem-title-sa-signin.md` — today's release.
* `task-313.md`, `task-308.md`, `task-303.md`, `task-300.md`, `task-299.md` —
  the multi-PC-join rebuild and the License-Keys retirement.

### `audit-evidence/<date>/<topic>/REPORT.md`

Each completed audit produces a report file under `audit-evidence/`.
These are point-in-time evidence; treat them as historical record, not as
operational documentation.

### `.local/reports/` (4 dated `.md` snapshots, **WORKSPACE-LOCAL ONLY**)

Same gitignore caveat as `.local/memory/` above: invisible to git, gone on
fresh clone. The four files (`MAINTENANCE_RUNBOOK.md`,
`SUPABASE_HEALTH.md`, `full-role-audit-2026-04-24.md`,
`audit-scratch-2026-04-24.gitignored.md`) are dated 2026-04-24 snapshots
from the Audit AA-Z cycle and are entirely superseded by today's live
state in HANDOFF.md §2 / §5 / §11. Do not rely on them.

---

## Last words to the next engineer

* When in doubt, **read what's in Postgres**, not what's in the dashboard.
  Use the Supabase Management API SQL endpoint with the `SUPABASE_ACCESS_TOKEN`
  + project ref `nklrdhfsbevckovqqkah`. Do NOT use `psql DATABASE_URL`.
* When you change schema, write a new migration SQL file. Don't edit existing
  ones — the sha256 in `_migration_ledger` will catch you.
* When you change `calculations.ts`, change BOTH the dashboard and the mobile
  copy and run `pnpm --filter @workspace/pilot-dashboard test:smoke` so the
  parity test catches drift.
* When you ship a PC release, bump `version` (or push a `v*` tag) — the silent
  failure mode is "release builds, but no PC sees the update."
* When you touch the join flow, remember the join secret is **anti-spam**, not
  privilege. Real privilege is the super-admin's approval click.
* When you see two files at the same migration number (0051/0052/0053/0081),
  that's intentional historical state — leave them alone.

Welcome to Hawk Eye. Fly safe.

---

## APPENDIX A — Per-table reference (defaults, FKs, indexes, RLS policies)

This appendix complements §5.1 with the full per-table data dictionary. The data
below was captured live from `information_schema` and `pg_catalog` against the
production Supabase project on 2026-04-25 04:48Z.

### alerts

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `posted_at` | timestamp with time zone | NO | now() |
| `body` | text | NO | — |
| `author` | text | YES | — |
| `created_at` | timestamp with time zone | NO | now() |
| `priority` | text | NO | 'normal'::text |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`alerts_squadron_id_fkey`)

**Indexes**

- `alerts_pkey` — `CREATE UNIQUE INDEX alerts_pkey ON public.alerts USING btree (id)`
- `alerts_priority_idx` — `CREATE INDEX alerts_priority_idx ON public.alerts USING btree (priority)`
- `alerts_squadron_time_idx` — `CREATE INDEX alerts_squadron_time_idx ON public.alerts USING btree (squadron_id, posted_at DESC)`

**RLS policies**

- `alerts_pilot_read` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (squadron_id = pilot_squadron_for_caller()))`
  - WITH CHECK: `—`
- `alerts_rw` (ALL, roles={public})
  - USING: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
  - WITH CHECK: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`

### audit_log

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | bigint | NO | nextval('audit_log_id_seq'::regclass) |
| `squadron_id` | uuid | YES | squadron_id() |
| `type` | text | NO | — |
| `actor` | text | YES | — |
| `detail` | jsonb | NO | '{}'::jsonb |
| `occurred_at` | timestamp with time zone | NO | now() |
| `action` | text | YES | — |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`audit_log_squadron_id_fkey`)

**Indexes**

- `audit_action_time_idx` — `CREATE INDEX audit_action_time_idx ON public.audit_log USING btree (action, occurred_at DESC)`
- `audit_log_pkey` — `CREATE UNIQUE INDEX audit_log_pkey ON public.audit_log USING btree (id)`
- `audit_squadron_time_idx` — `CREATE INDEX audit_squadron_time_idx ON public.audit_log USING btree (squadron_id, occurred_at DESC)`

**RLS policies**

- `audit_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`
- `audit_select` (SELECT, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `—`

### audit_log_archive

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | bigint | NO | — |
| `squadron_id` | uuid | YES | — |
| `type` | text | NO | — |
| `actor` | text | YES | — |
| `detail` | jsonb | NO | '{}'::jsonb |
| `occurred_at` | timestamp with time zone | NO | — |
| `archived_at` | timestamp with time zone | NO | now() |

**Indexes**

- `audit_log_archive_pkey` — `CREATE UNIQUE INDEX audit_log_archive_pkey ON public.audit_log_archive USING btree (id)`
- `audit_log_archive_squadron_time_idx` — `CREATE INDEX audit_log_archive_squadron_time_idx ON public.audit_log_archive USING btree (squadron_id, occurred_at DESC)`
- `audit_log_archive_type_idx` — `CREATE INDEX audit_log_archive_type_idx ON public.audit_log_archive USING btree (type)`

**RLS policies**

- `audit_log_archive_select` (SELECT, roles={authenticated})
  - USING: `COALESCE(((((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text), false)`
  - WITH CHECK: `—`

### bases

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `name` | text | NO | — |
| `created_at` | timestamp with time zone | NO | now() |

**Indexes**

- `bases_name_key` — `CREATE UNIQUE INDEX bases_name_key ON public.bases USING btree (name)`
- `bases_pkey` — `CREATE UNIQUE INDEX bases_pkey ON public.bases USING btree (id)`

**RLS policies**

- `bases_read` (SELECT, roles={authenticated})
  - USING: `true`
  - WITH CHECK: `—`

### currencies

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `pilot_id` | text | NO | — |
| `task` | text | NO | — |
| `status` | text | NO | — |
| `cycle_start` | date | NO | — |
| `updated_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`currencies_squadron_id_fkey`)

**Indexes**

- `currencies_pkey` — `CREATE UNIQUE INDEX currencies_pkey ON public.currencies USING btree (id)`
- `currencies_squadron_id_pilot_id_task_cycle_start_key` — `CREATE UNIQUE INDEX currencies_squadron_id_pilot_id_task_cycle_start_key ON public.currencies USING btree (squadron_id, pilot_id, task, cycle_start)`

**RLS policies**

- `currencies_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`

### device_requests

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `requested_role` | text | NO | — |
| `requested_squadron_names` | ARRAY | NO | ARRAY[]::text[] |
| `username` | USER-DEFINED | NO | — |
| `display_name` | text | NO | — |
| `fingerprint` | text | NO | — |
| `originating_ip` | inet | YES | — |
| `submitted_at` | timestamp with time zone | NO | now() |
| `status` | text | NO | 'pending'::text |
| `decided_at` | timestamp with time zone | YES | — |
| `decided_by` | uuid | YES | — |
| `decision_reason` | text | YES | — |
| `supabase_email` | text | YES | — |
| `member_id` | uuid | YES | — |
| `device_id` | uuid | YES | — |
| `password_sha256` | text | YES | — |
| `claim_token` | text | YES | — |
| `claim_consumed_at` | timestamp with time zone | YES | — |
| `originating_city` | text | YES | — |

**Foreign keys**

- `member_id` → `unit_members.id` (`device_requests_member_id_fkey`)
- `device_id` → `devices.id` (`device_requests_device_id_fkey`)

**Indexes**

- `device_requests_claim_token_idx` — `CREATE UNIQUE INDEX device_requests_claim_token_idx ON public.device_requests USING btree (claim_token) WHERE (claim_token IS NOT NULL)`
- `device_requests_pkey` — `CREATE UNIQUE INDEX device_requests_pkey ON public.device_requests USING btree (id)`
- `device_requests_status_idx` — `CREATE INDEX device_requests_status_idx ON public.device_requests USING btree (status)`
- `device_requests_submitted_idx` — `CREATE INDEX device_requests_submitted_idx ON public.device_requests USING btree (submitted_at DESC)`

**RLS policies**

- `device_requests_modify` (ALL, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `xpc_is_super_admin()`
- `device_requests_select` (SELECT, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `—`

### devices

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `member_id` | uuid | NO | — |
| `display_name` | text | NO | — |
| `fingerprint` | text | NO | — |
| `originating_ip` | inet | YES | — |
| `originating_city` | text | YES | — |
| `approved_at` | timestamp with time zone | NO | now() |
| `approved_by` | uuid | YES | — |
| `last_seen_at` | timestamp with time zone | YES | — |
| `revoked_at` | timestamp with time zone | YES | — |
| `revoked_reason` | text | YES | — |

**Foreign keys**

- `member_id` → `unit_members.id` (`devices_member_id_fkey`)

**Indexes**

- `devices_active_idx` — `CREATE INDEX devices_active_idx ON public.devices USING btree (member_id) WHERE (revoked_at IS NULL)`
- `devices_member_idx` — `CREATE INDEX devices_member_idx ON public.devices USING btree (member_id)`
- `devices_pkey` — `CREATE UNIQUE INDEX devices_pkey ON public.devices USING btree (id)`

**RLS policies**

- `devices_modify` (ALL, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `xpc_is_super_admin()`
- `devices_select` (SELECT, roles={authenticated})
  - USING: `(xpc_is_super_admin() OR (member_id IN ( SELECT unit_members.id    FROM unit_members   WHERE (unit_members.auth_user_id = (NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text))::uuid))))`
  - WITH CHECK: `—`

### duty_week

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `day` | text | NO | — |
| `main_duty` | text | YES | — |
| `standby` | text | YES | — |
| `rcm` | text | YES | — |
| `effective_from` | date | NO | CURRENT_DATE |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`duty_week_squadron_id_fkey`)

**Indexes**

- `duty_week_pkey` — `CREATE UNIQUE INDEX duty_week_pkey ON public.duty_week USING btree (id)`
- `duty_week_squadron_id_day_effective_from_key` — `CREATE UNIQUE INDEX duty_week_squadron_id_day_effective_from_key ON public.duty_week USING btree (squadron_id, day, effective_from)`

**RLS policies**

- `duty_week_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`

### leaves

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `pilot_id` | text | NO | — |
| `year` | integer | NO | — |
| `months` | jsonb | NO | '{}'::jsonb |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`leaves_squadron_id_fkey`)

**Indexes**

- `leaves_pkey` — `CREATE UNIQUE INDEX leaves_pkey ON public.leaves USING btree (id)`
- `leaves_squadron_id_pilot_id_year_key` — `CREATE UNIQUE INDEX leaves_squadron_id_pilot_id_year_key ON public.leaves USING btree (squadron_id, pilot_id, year)`

**RLS policies**

- `leaves_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`

### license_registry

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | text | NO | — |
| `full_key` | text | NO | — |
| `meta` | jsonb | NO | — |
| `updated_at` | timestamp with time zone | NO | now() |

**Indexes**

- `license_registry_pkey` — `CREATE UNIQUE INDEX license_registry_pkey ON public.license_registry USING btree (id)`
- `license_registry_updated_idx` — `CREATE INDEX license_registry_updated_idx ON public.license_registry USING btree (updated_at DESC)`

**RLS policies**

- `license_registry_delete` (DELETE, roles={public})
  - USING: `true`
  - WITH CHECK: `—`
- `license_registry_read` (SELECT, roles={public})
  - USING: `true`
  - WITH CHECK: `—`
- `license_registry_update` (UPDATE, roles={public})
  - USING: `true`
  - WITH CHECK: `true`
- `license_registry_write` (INSERT, roles={public})
  - USING: `—`
  - WITH CHECK: `true`

### licenses

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `key` | text | NO | — |
| `squadron_id` | uuid | NO | — |
| `bound_fingerprint` | text | YES | — |
| `issued_at` | timestamp with time zone | NO | now() |
| `expires_at` | timestamp with time zone | YES | — |
| `revoked_at` | timestamp with time zone | YES | — |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`licenses_squadron_id_fkey`)

**Indexes**

- `licenses_pkey` — `CREATE UNIQUE INDEX licenses_pkey ON public.licenses USING btree (key)`
- `licenses_squadron_id_idx` — `CREATE INDEX licenses_squadron_id_idx ON public.licenses USING btree (squadron_id)`

**RLS policies**

- `lic_select` (SELECT, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `—`

### monthly_report_close

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `squadron_id` | uuid | NO | — |
| `year_month` | text | NO | — |
| `closed_at` | timestamp with time zone | NO | now() |
| `closed_by` | uuid | YES | — |
| `reason` | text | YES | — |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`monthly_report_close_squadron_id_fkey`)

**Indexes**

- `monthly_report_close_pkey` — `CREATE UNIQUE INDEX monthly_report_close_pkey ON public.monthly_report_close USING btree (squadron_id, year_month)`
- `monthly_report_close_year_month_idx` — `CREATE INDEX monthly_report_close_year_month_idx ON public.monthly_report_close USING btree (year_month)`

**RLS policies**

- `monthly_report_close_select` (SELECT, roles={authenticated})
  - USING: `true`
  - WITH CHECK: `—`

### notams

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `notam_no` | text | NO | — |
| `posted_on` | date | NO | CURRENT_DATE |
| `body` | text | NO | — |
| `created_at` | timestamp with time zone | NO | now() |
| `priority` | text | NO | 'normal'::text |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`notams_squadron_id_fkey`)

**Indexes**

- `notams_pkey` — `CREATE UNIQUE INDEX notams_pkey ON public.notams USING btree (id)`
- `notams_priority_idx` — `CREATE INDEX notams_priority_idx ON public.notams USING btree (priority)`
- `notams_squadron_id_idx` — `CREATE INDEX notams_squadron_id_idx ON public.notams USING btree (squadron_id)`

**RLS policies**

- `notams_pilot_read` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (squadron_id = pilot_squadron_for_caller()))`
  - WITH CHECK: `—`
- `notams_rw` (ALL, roles={public})
  - USING: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
  - WITH CHECK: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`

### pilot_currency_notifications

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | bigint | NO | nextval('pilot_currency_notifications_id_seq'::regclass) |
| `pilot_id` | text | NO | — |
| `currency_key` | text | NO | — |
| `expiry_date` | date | NO | — |
| `threshold_days` | integer | NO | — |
| `sent_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `pilot_id` → `pilots.id` (`pilot_currency_notifications_pilot_id_fkey`)

**Indexes**

- `pilot_currency_notifications_pilot_id_currency_key_expiry_d_key` — `CREATE UNIQUE INDEX pilot_currency_notifications_pilot_id_currency_key_expiry_d_key ON public.pilot_currency_notifications USING btree (pilot_id, currency_key, expiry_date, threshold_days)`
- `pilot_currency_notifications_pilot_idx` — `CREATE INDEX pilot_currency_notifications_pilot_idx ON public.pilot_currency_notifications USING btree (pilot_id)`
- `pilot_currency_notifications_pkey` — `CREATE UNIQUE INDEX pilot_currency_notifications_pkey ON public.pilot_currency_notifications USING btree (id)`

**RLS policies**

- `currency_notifications_ops_read` (SELECT, roles={public})
  - USING: `(EXISTS ( SELECT 1    FROM pilots p   WHERE ((p.id = pilot_currency_notifications.pilot_id) AND (p.squadron_id = squadron_id()))))`
  - WITH CHECK: `—`

### pilot_devices

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `token_hash` | text | YES | — |
| `squadron_id` | uuid | NO | — |
| `pilot_id` | text | NO | — |
| `linked_at` | timestamp with time zone | NO | now() |
| `last_seen_at` | timestamp with time zone | NO | now() |
| `revoked_at` | timestamp with time zone | YES | — |
| `user_id` | uuid | YES | — |
| `id` | uuid | NO | gen_random_uuid() |

**Foreign keys**

- `pilot_id` → `pilots.id` (`pilot_devices_pilot_id_fkey`)
- `squadron_id` → `squadrons.id` (`pilot_devices_squadron_id_fkey`)

**Indexes**

- `pilot_devices_pilot_idx` — `CREATE INDEX pilot_devices_pilot_idx ON public.pilot_devices USING btree (pilot_id)`
- `pilot_devices_pkey` — `CREATE UNIQUE INDEX pilot_devices_pkey ON public.pilot_devices USING btree (id)`
- `pilot_devices_squadron_id_idx` — `CREATE INDEX pilot_devices_squadron_id_idx ON public.pilot_devices USING btree (squadron_id)`
- `pilot_devices_token_hash_key` — `CREATE UNIQUE INDEX pilot_devices_token_hash_key ON public.pilot_devices USING btree (token_hash)`
- `pilot_devices_user_id_key` — `CREATE UNIQUE INDEX pilot_devices_user_id_key ON public.pilot_devices USING btree (user_id)`

**RLS policies**

- `devices_ops_rw` (ALL, roles={public})
  - USING: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
  - WITH CHECK: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
- `devices_self_rw` (ALL, roles={public})
  - USING: `((user_id IS NOT NULL) AND (user_id = auth.uid()))`
  - WITH CHECK: `((user_id IS NOT NULL) AND (user_id = auth.uid()))`

### pilot_link_codes

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | — |
| `pilot_id` | text | NO | — |
| `code_hash` | text | NO | — |
| `issued_by` | uuid | YES | — |
| `issued_at` | timestamp with time zone | NO | now() |
| `expires_at` | timestamp with time zone | NO | (now() + '7 days'::interval) |
| `consumed_at` | timestamp with time zone | YES | — |

**Foreign keys**

- `pilot_id` → `pilots.id` (`pilot_link_codes_pilot_id_fkey`)
- `squadron_id` → `squadrons.id` (`pilot_link_codes_squadron_id_fkey`)

**Indexes**

- `pilot_link_codes_issued_by_idx` — `CREATE INDEX pilot_link_codes_issued_by_idx ON public.pilot_link_codes USING btree (issued_by)`
- `pilot_link_codes_pilot_idx` — `CREATE INDEX pilot_link_codes_pilot_idx ON public.pilot_link_codes USING btree (pilot_id)`
- `pilot_link_codes_pkey` — `CREATE UNIQUE INDEX pilot_link_codes_pkey ON public.pilot_link_codes USING btree (id)`
- `pilot_link_codes_squadron_id_idx` — `CREATE INDEX pilot_link_codes_squadron_id_idx ON public.pilot_link_codes USING btree (squadron_id)`

**RLS policies**

- `link_codes_ops_rw` (ALL, roles={public})
  - USING: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
  - WITH CHECK: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`

### pilot_reminder_prefs

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `pilot_id` | text | NO | — |
| `squadron_id` | uuid | NO | — |
| `thresholds` | jsonb | NO | '{}'::jsonb |
| `push_enabled` | boolean | NO | false |
| `expo_push_token` | text | YES | — |
| `platform` | text | YES | — |
| `updated_at` | timestamp with time zone | NO | now() |
| `last_seen_at` | timestamp with time zone | YES | — |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`pilot_reminder_prefs_squadron_id_fkey`)
- `pilot_id` → `pilots.id` (`pilot_reminder_prefs_pilot_id_fkey`)

**Indexes**

- `pilot_reminder_prefs_enabled_idx` — `CREATE INDEX pilot_reminder_prefs_enabled_idx ON public.pilot_reminder_prefs USING btree (push_enabled) WHERE (push_enabled AND (expo_push_token IS NOT NULL))`
- `pilot_reminder_prefs_pkey` — `CREATE UNIQUE INDEX pilot_reminder_prefs_pkey ON public.pilot_reminder_prefs USING btree (pilot_id)`
- `pilot_reminder_prefs_squadron_idx` — `CREATE INDEX pilot_reminder_prefs_squadron_idx ON public.pilot_reminder_prefs USING btree (squadron_id)`

**RLS policies**

- `reminder_prefs_ops_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`
- `reminder_prefs_self_select` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (pilot_id = pilot_id()))`
  - WITH CHECK: `—`

### pilots

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | text | NO | — |
| `squadron_id` | uuid | NO | squadron_id() |
| `rank` | text | NO | — |
| `name` | text | NO | — |
| `arabic_name` | text | YES | — |
| `unit` | text | YES | — |
| `phone` | text | YES | — |
| `available` | boolean | NO | true |
| `data` | jsonb | NO | '{}'::jsonb |
| `updated_at` | timestamp with time zone | NO | now() |
| `auth_user_id` | uuid | YES | — |
| `rank_en` | text | YES | — |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`pilots_squadron_id_fkey`)

**Indexes**

- `pilots_auth_user_idx` — `CREATE UNIQUE INDEX pilots_auth_user_idx ON public.pilots USING btree (auth_user_id) WHERE (auth_user_id IS NOT NULL)`
- `pilots_military_number_unique_per_squadron` — `CREATE UNIQUE INDEX pilots_military_number_unique_per_squadron ON public.pilots USING btree (squadron_id, lower(TRIM(BOTH FROM (data ->> 'militaryNumber'::text)))) WHERE (((data ->> 'militaryNumber'::text) IS NOT NULL) AND (TRIM(BOTH FROM (data ->> 'militaryNumber'::text)) <> ''::text))`
- `pilots_pkey` — `CREATE UNIQUE INDEX pilots_pkey ON public.pilots USING btree (id)`
- `pilots_squadron_idx` — `CREATE INDEX pilots_squadron_idx ON public.pilots USING btree (squadron_id)`

**RLS policies**

- `pilots_pilot_squadron_read` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (squadron_id = pilot_squadron_for_caller()))`
  - WITH CHECK: `—`
- `pilots_rw` (ALL, roles={public})
  - USING: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
  - WITH CHECK: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
- `pilots_self_select` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (id = pilot_id()) AND (auth_user_id IS NOT NULL) AND (auth_user_id = auth.uid()))`
  - WITH CHECK: `—`

### reminder_manual_runs

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | bigint | NO | nextval('reminder_manual_runs_id_seq'::regclass) |
| `started_at` | timestamp with time zone | NO | now() |
| `ended_at` | timestamp with time zone | YES | — |
| `status` | text | NO | — |
| `return_message` | text | YES | — |
| `actor` | text | YES | — |

**Indexes**

- `reminder_manual_runs_pkey` — `CREATE UNIQUE INDEX reminder_manual_runs_pkey ON public.reminder_manual_runs USING btree (id)`
- `reminder_manual_runs_started_at_idx` — `CREATE INDEX reminder_manual_runs_started_at_idx ON public.reminder_manual_runs USING btree (started_at DESC)`

**RLS policies**

- `block_all_regular_users` (ALL, roles={anon,authenticated})
  - USING: `false`
  - WITH CHECK: `—`

### reminder_schedules

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `name` | text | NO | — |
| `cron` | text | NO | — |
| `target_url` | text | YES | — |
| `enabled` | boolean | NO | true |
| `squadron_id` | uuid | YES | — |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |
| `created_by` | text | YES | — |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`reminder_schedules_squadron_id_fkey`)

**Indexes**

- `reminder_schedules_name_uidx` — `CREATE UNIQUE INDEX reminder_schedules_name_uidx ON public.reminder_schedules USING btree (name)`
- `reminder_schedules_pkey` — `CREATE UNIQUE INDEX reminder_schedules_pkey ON public.reminder_schedules USING btree (id)`
- `reminder_schedules_squadron_idx` — `CREATE INDEX reminder_schedules_squadron_idx ON public.reminder_schedules USING btree (squadron_id)`

**RLS policies**

- `reminder_schedules_delete` (DELETE, roles={authenticated})
  - USING: `(xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text]))`
  - WITH CHECK: `—`
- `reminder_schedules_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text]))`
- `reminder_schedules_select` (SELECT, roles={authenticated})
  - USING: `(xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text]))`
  - WITH CHECK: `—`
- `reminder_schedules_update` (UPDATE, roles={authenticated})
  - USING: `(xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text]))`
  - WITH CHECK: `(xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text]))`

### runtime_errors

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | bigint | NO | nextval('runtime_errors_id_seq'::regclass) |
| `occurred_at` | timestamp with time zone | NO | now() |
| `app` | text | NO | — |
| `app_version` | text | YES | — |
| `role` | text | YES | — |
| `user_id` | uuid | YES | — |
| `squadron_id` | uuid | YES | — |
| `page` | text | YES | — |
| `message` | text | NO | — |
| `name` | text | YES | — |
| `stack` | text | YES | — |
| `user_agent` | text | YES | — |
| `detail` | jsonb | NO | '{}'::jsonb |

**Indexes**

- `runtime_errors_app_time_idx` — `CREATE INDEX runtime_errors_app_time_idx ON public.runtime_errors USING btree (app, occurred_at DESC)`
- `runtime_errors_pkey` — `CREATE UNIQUE INDEX runtime_errors_pkey ON public.runtime_errors USING btree (id)`
- `runtime_errors_squadron_idx` — `CREATE INDEX runtime_errors_squadron_idx ON public.runtime_errors USING btree (squadron_id, occurred_at DESC)`
- `runtime_errors_time_idx` — `CREATE INDEX runtime_errors_time_idx ON public.runtime_errors USING btree (occurred_at DESC)`

**RLS policies**

- `runtime_errors_select_commander` (SELECT, roles={authenticated})
  - USING: `((squadron_id IS NOT NULL) AND (squadron_id = ((((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb -> 'app_metadata'::text) ->> 'squadron_id'::text))::uuid) AND ((((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb -> 'app_metadata'::text) ->> 'role'::text) = 'commander'::text))`
  - WITH CHECK: `—`
- `runtime_errors_select_super` (SELECT, roles={authenticated})
  - USING: `COALESCE(((((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text), false)`
  - WITH CHECK: `—`

### saved_duty_weeks

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron` | text | NO | — |
| `start_date` | date | NO | — |
| `rows` | jsonb | NO | — |
| `saved_at` | timestamp with time zone | NO | now() |

**Indexes**

- `saved_duty_weeks_pkey` — `CREATE UNIQUE INDEX saved_duty_weeks_pkey ON public.saved_duty_weeks USING btree (id)`
- `saved_duty_weeks_sqn_start` — `CREATE INDEX saved_duty_weeks_sqn_start ON public.saved_duty_weeks USING btree (squadron, start_date DESC)`
- `saved_duty_weeks_squadron_start_date_key` — `CREATE UNIQUE INDEX saved_duty_weeks_squadron_start_date_key ON public.saved_duty_weeks USING btree (squadron, start_date)`

**RLS policies**

- `saved_duty_weeks_select` (SELECT, roles={public})
  - USING: `(squadron IN ( SELECT s.number    FROM squadrons s   WHERE (s.id = squadron_id())))`
  - WITH CHECK: `—`
- `saved_duty_weeks_write` (ALL, roles={public})
  - USING: `(squadron IN ( SELECT s.number    FROM squadrons s   WHERE (s.id = squadron_id())))`
  - WITH CHECK: `(squadron IN ( SELECT s.number    FROM squadrons s   WHERE (s.id = squadron_id())))`

### schedule

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `flight_date` | date | NO | CURRENT_DATE |
| `ac` | text | NO | — |
| `config` | text | YES | — |
| `crew` | ARRAY | NO | '{}'::text[] |
| `mission` | text | YES | — |
| `takeoff` | text | YES | — |
| `land` | text | YES | — |
| `fuel` | text | YES | — |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`schedule_squadron_id_fkey`)

**Indexes**

- `schedule_pkey` — `CREATE UNIQUE INDEX schedule_pkey ON public.schedule USING btree (id)`
- `schedule_squadron_id_idx` — `CREATE INDEX schedule_squadron_id_idx ON public.schedule USING btree (squadron_id)`

**RLS policies**

- `schedule_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`

### sorties

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `pilot_id` | text | NO | — |
| `co_pilot_id` | text | YES | — |
| `date` | date | NO | — |
| `ac_type` | text | YES | — |
| `ac_number` | text | YES | — |
| `sortie_type` | text | YES | — |
| `sortie_name` | text | YES | — |
| `data` | jsonb | NO | '{}'::jsonb |
| `created_by` | uuid | YES | — |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`sorties_squadron_id_fkey`)

**Indexes**

- `sorties_created_by_idx` — `CREATE INDEX sorties_created_by_idx ON public.sorties USING btree (created_by)`
- `sorties_pkey` — `CREATE UNIQUE INDEX sorties_pkey ON public.sorties USING btree (id)`
- `sorties_squadron_date_idx` — `CREATE INDEX sorties_squadron_date_idx ON public.sorties USING btree (squadron_id, date DESC)`

**RLS policies**

- `sorties_pilot_squadron_read` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (squadron_id = pilot_squadron_for_caller()))`
  - WITH CHECK: `—`
- `sorties_rw` (ALL, roles={public})
  - USING: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
  - WITH CHECK: `((pilot_id() IS NULL) AND (squadron_id = squadron_id()))`
- `sorties_self_select` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND ((pilot_id = pilot_id()) OR (co_pilot_id = pilot_id())) AND (EXISTS ( SELECT 1    FROM pilots p   WHERE ((p.id = pilot_id()) AND (p.auth_user_id = auth.uid())))))`
  - WITH CHECK: `—`

### squadrons

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `number` | text | NO | — |
| `name` | text | NO | — |
| `base` | text | NO | — |
| `created_at` | timestamp with time zone | NO | now() |
| `wing_id` | uuid | YES | — |
| `base_id` | uuid | YES | — |
| `default_aircraft` | jsonb | NO | '[]'::jsonb |
| `default_monthly_targets` | jsonb | NO | '{}'::jsonb |
| `wing` | text | YES | — |

**Foreign keys**

- `wing_id` → `wings.id` (`squadrons_wing_id_fkey`)
- `base_id` → `bases.id` (`squadrons_base_id_fkey`)

**Indexes**

- `squadrons_base_idx` — `CREATE INDEX squadrons_base_idx ON public.squadrons USING btree (base_id)`
- `squadrons_canon_uniq` — `CREATE UNIQUE INDEX squadrons_canon_uniq ON public.squadrons USING btree (squadrons_canon_name(name))`
- `squadrons_name_canon_idx` — `CREATE UNIQUE INDEX squadrons_name_canon_idx ON public.squadrons USING btree (squadrons_canon_name(name))`
- `squadrons_pkey` — `CREATE UNIQUE INDEX squadrons_pkey ON public.squadrons USING btree (id)`
- `squadrons_wing_idx` — `CREATE INDEX squadrons_wing_idx ON public.squadrons USING btree (wing_id)`

**RLS policies**

- `sq_select` (SELECT, roles={public})
  - USING: `(id = squadron_id())`
  - WITH CHECK: `—`
- `sq_self_select` (SELECT, roles={public})
  - USING: `((pilot_id() IS NOT NULL) AND (id = ( SELECT pilots.squadron_id    FROM pilots   WHERE ((pilots.id = pilot_id()) AND (pilots.auth_user_id = auth.uid())))))`
  - WITH CHECK: `—`

### super_admin_2fa

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `username` | text | NO | — |
| `secret_b32` | text | NO | — |
| `enrolled_at` | timestamp with time zone | YES | — |
| `last_verified_at` | timestamp with time zone | YES | — |
| `failed_attempts` | integer | NO | 0 |
| `locked_until` | timestamp with time zone | YES | — |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |
| `recovery_code_hashes` | ARRAY | NO | '{}'::text[] |
| `recovery_code_used_at` | ARRAY | NO | '{}'::timestamp with time zone[] |

**Indexes**

- `super_admin_2fa_pkey` — `CREATE UNIQUE INDEX super_admin_2fa_pkey ON public.super_admin_2fa USING btree (username)`

**RLS policies**

- `block_all_regular_users` (ALL, roles={anon,authenticated})
  - USING: `false`
  - WITH CHECK: `—`

### super_admin_credentials

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `username` | text | NO | — |
| `password_hash` | text | NO | — |
| `updated_at` | timestamp with time zone | NO | now() |
| `updated_by` | text | YES | — |

**Indexes**

- `super_admin_credentials_pkey` — `CREATE UNIQUE INDEX super_admin_credentials_pkey ON public.super_admin_credentials USING btree (username)`

_No RLS policies (table is RLS-disabled or has no per-role policy)._

### unavailable

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `squadron_id` | uuid | NO | squadron_id() |
| `pilot_id` | text | NO | — |
| `from_date` | date | NO | — |
| `to_date` | date | NO | — |
| `reason` | text | YES | — |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`unavailable_squadron_id_fkey`)

**Indexes**

- `unavailable_pkey` — `CREATE UNIQUE INDEX unavailable_pkey ON public.unavailable USING btree (id)`
- `unavailable_squadron_id_idx` — `CREATE INDEX unavailable_squadron_id_idx ON public.unavailable USING btree (squadron_id)`

**RLS policies**

- `unavailable_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`

### unit_config

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `key` | text | NO | — |
| `value` | text | NO | — |
| `updated_at` | timestamp with time zone | NO | now() |

**Indexes**

- `unit_config_pkey` — `CREATE UNIQUE INDEX unit_config_pkey ON public.unit_config USING btree (key)`

**RLS policies**

- `unit_config_super_admin_modify` (ALL, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `xpc_is_super_admin()`

### unit_members

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `auth_user_id` | uuid | YES | — |
| `username` | USER-DEFINED | NO | — |
| `display_name` | text | NO | — |
| `role` | text | NO | — |
| `tier` | text | NO | — |
| `squadron_allow_list` | ARRAY | NO | ARRAY[]::text[] |
| `primary_squadron_id` | uuid | YES | — |
| `status` | text | NO | 'active'::text |
| `removed_at` | timestamp with time zone | YES | — |
| `removed_reason` | text | YES | — |
| `created_at` | timestamp with time zone | NO | now() |
| `updated_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `primary_squadron_id` → `squadrons.id` (`unit_members_primary_squadron_id_fkey`)

**Indexes**

- `unit_members_auth_user_id_key` — `CREATE UNIQUE INDEX unit_members_auth_user_id_key ON public.unit_members USING btree (auth_user_id)`
- `unit_members_pkey` — `CREATE UNIQUE INDEX unit_members_pkey ON public.unit_members USING btree (id)`
- `unit_members_role_tier_idx` — `CREATE INDEX unit_members_role_tier_idx ON public.unit_members USING btree (role, tier)`
- `unit_members_status_idx` — `CREATE INDEX unit_members_status_idx ON public.unit_members USING btree (status)`
- `unit_members_username_active_uniq` — `CREATE UNIQUE INDEX unit_members_username_active_uniq ON public.unit_members USING btree (username) WHERE (status = 'active'::text)`

**RLS policies**

- `unit_members_modify` (ALL, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `xpc_is_super_admin()`
- `unit_members_select` (SELECT, roles={authenticated})
  - USING: `(xpc_is_super_admin() OR (auth_user_id = (NULLIF(current_setting('request.jwt.claim.sub'::text, true), ''::text))::uuid))`
  - WITH CHECK: `—`

### users

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | — |
| `squadron_id` | uuid | NO | — |
| `username` | text | NO | — |
| `display_name` | text | NO | — |
| `role` | text | NO | — |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `squadron_id` → `squadrons.id` (`users_squadron_id_fkey`)

**Indexes**

- `users_pkey` — `CREATE UNIQUE INDEX users_pkey ON public.users USING btree (id)`
- `users_squadron_id_idx` — `CREATE INDEX users_squadron_id_idx ON public.users USING btree (squadron_id)`

**RLS policies**

- `users_rw` (ALL, roles={public})
  - USING: `(squadron_id = squadron_id())`
  - WITH CHECK: `(squadron_id = squadron_id())`

### wings

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `name` | text | NO | — |
| `base_id` | uuid | YES | — |
| `created_at` | timestamp with time zone | NO | now() |

**Foreign keys**

- `base_id` → `bases.id` (`wings_base_id_fkey`)

**Indexes**

- `wings_base_idx` — `CREATE INDEX wings_base_idx ON public.wings USING btree (base_id)`
- `wings_name_key` — `CREATE UNIQUE INDEX wings_name_key ON public.wings USING btree (name)`
- `wings_pkey` — `CREATE UNIQUE INDEX wings_pkey ON public.wings USING btree (id)`

**RLS policies**

- `wings_read` (SELECT, roles={authenticated})
  - USING: `true`
  - WITH CHECK: `—`

### xpc_messages

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | text | NO | — |
| `thread_id` | text | NO | — |
| `from_pc_id` | text | NO | — |
| `from_pc_name` | text | NO | — |
| `from_tier` | text | NO | — |
| `from_user` | text | NO | — |
| `to_pc_id` | text | NO | — |
| `to_pc_name` | text | NO | — |
| `to_tier` | text | NO | — |
| `subject` | text | NO | — |
| `body` | text | NO | — |
| `priority` | text | NO | — |
| `sent_at` | timestamp with time zone | NO | now() |
| `read_at` | timestamp with time zone | YES | — |
| `in_history` | boolean | NO | false |
| `from_display_name` | text | YES | — |
| `from_rank` | text | YES | — |
| `from_seat_label` | text | YES | — |

**Indexes**

- `xpc_messages_from_idx` — `CREATE INDEX xpc_messages_from_idx ON public.xpc_messages USING btree (from_pc_id, sent_at DESC)`
- `xpc_messages_pkey` — `CREATE UNIQUE INDEX xpc_messages_pkey ON public.xpc_messages USING btree (id)`
- `xpc_messages_sent_at_idx` — `CREATE INDEX xpc_messages_sent_at_idx ON public.xpc_messages USING btree (sent_at)`
- `xpc_messages_to_idx` — `CREATE INDEX xpc_messages_to_idx ON public.xpc_messages USING btree (to_pc_id, sent_at DESC)`

**RLS policies**

- `xpc_messages_delete` (DELETE, roles={authenticated})
  - USING: `(xpc_pc_id_matches_mine(from_pc_id) OR xpc_pc_id_matches_mine(to_pc_id))`
  - WITH CHECK: `—`
- `xpc_messages_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`
- `xpc_messages_select` (SELECT, roles={authenticated})
  - USING: `(xpc_pc_id_matches_mine(from_pc_id) OR xpc_pc_id_matches_mine(to_pc_id))`
  - WITH CHECK: `—`
- `xpc_messages_update` (UPDATE, roles={authenticated})
  - USING: `(xpc_pc_id_matches_mine(from_pc_id) OR xpc_pc_id_matches_mine(to_pc_id))`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`

### xpc_outbox

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `target` | text | NO | — |
| `payload` | jsonb | NO | — |
| `created_at` | timestamp with time zone | NO | now() |
| `created_by` | uuid | YES | — |
| `sent_at` | timestamp with time zone | YES | — |
| `attempts` | integer | NO | 0 |
| `last_attempted_at` | timestamp with time zone | YES | — |
| `last_error` | text | YES | — |

**Indexes**

- `xpc_outbox_pending_idx` — `CREATE INDEX xpc_outbox_pending_idx ON public.xpc_outbox USING btree (created_at) WHERE (sent_at IS NULL)`
- `xpc_outbox_pkey` — `CREATE UNIQUE INDEX xpc_outbox_pkey ON public.xpc_outbox USING btree (id)`
- `xpc_outbox_stuck_idx` — `CREATE INDEX xpc_outbox_stuck_idx ON public.xpc_outbox USING btree (attempts) WHERE (sent_at IS NULL)`

**RLS policies**

- `xpc_outbox_select` (SELECT, roles={authenticated})
  - USING: `COALESCE(((((NULLIF(current_setting('request.jwt.claims'::text, true), ''::text))::jsonb -> 'app_metadata'::text) ->> 'role'::text) = 'super_admin'::text), false)`
  - WITH CHECK: `—`

### xpc_pair_audit

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | uuid | NO | gen_random_uuid() |
| `action` | text | NO | — |
| `target_pc_a` | text | YES | — |
| `target_pc_b` | text | YES | — |
| `by_user_id` | uuid | YES | — |
| `by_user_label` | text | YES | — |
| `kind` | text | YES | — |
| `justification` | text | YES | — |
| `detail` | jsonb | YES | — |
| `at` | timestamp with time zone | NO | now() |

**Indexes**

- `xpc_pair_audit_at_idx` — `CREATE INDEX xpc_pair_audit_at_idx ON public.xpc_pair_audit USING btree (at DESC)`
- `xpc_pair_audit_pc_idx` — `CREATE INDEX xpc_pair_audit_pc_idx ON public.xpc_pair_audit USING btree (target_pc_a, target_pc_b)`
- `xpc_pair_audit_pkey` — `CREATE UNIQUE INDEX xpc_pair_audit_pkey ON public.xpc_pair_audit USING btree (id)`

**RLS policies**

- `xpc_pair_audit_select` (SELECT, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `—`

### xpc_pair_codes

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `code` | text | NO | — |
| `host_pc_id` | text | NO | — |
| `host_tier` | text | NO | — |
| `host_squadron` | text | YES | — |
| `host_user_id` | uuid | YES | — |
| `host_user_display` | text | YES | — |
| `host_user_seat` | text | YES | — |
| `expires_at` | timestamp with time zone | NO | — |
| `created_at` | timestamp with time zone | NO | now() |
| `consumed_at` | timestamp with time zone | YES | — |

**Indexes**

- `xpc_pair_codes_expires_idx` — `CREATE INDEX xpc_pair_codes_expires_idx ON public.xpc_pair_codes USING btree (expires_at)`
- `xpc_pair_codes_host_idx` — `CREATE INDEX xpc_pair_codes_host_idx ON public.xpc_pair_codes USING btree (host_pc_id)`
- `xpc_pair_codes_host_user_id_idx` — `CREATE INDEX xpc_pair_codes_host_user_id_idx ON public.xpc_pair_codes USING btree (host_user_id)`
- `xpc_pair_codes_pkey` — `CREATE UNIQUE INDEX xpc_pair_codes_pkey ON public.xpc_pair_codes USING btree (code)`

**RLS policies**

- `xpc_pair_codes_delete` (DELETE, roles={authenticated})
  - USING: `(xpc_is_super_admin() OR (host_pc_id = ANY (xpc_my_pc_ids())))`
  - WITH CHECK: `—`
- `xpc_pair_codes_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(xpc_is_super_admin() OR (host_pc_id = ANY (xpc_my_pc_ids())))`
- `xpc_pair_codes_select` (SELECT, roles={authenticated})
  - USING: `true`
  - WITH CHECK: `—`
- `xpc_pair_codes_update` (UPDATE, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `xpc_is_super_admin()`

### xpc_pair_links

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `a_pc_id` | text | NO | — |
| `b_pc_id` | text | NO | — |
| `a_tier` | text | NO | — |
| `b_tier` | text | NO | — |
| `a_squadron` | text | YES | — |
| `b_squadron` | text | YES | — |
| `a_user_display` | text | YES | — |
| `b_user_display` | text | YES | — |
| `a_user_seat` | text | YES | — |
| `b_user_seat` | text | YES | — |
| `kind` | text | NO | — |
| `paired_at` | timestamp with time zone | NO | now() |
| `paired_by_user_id` | uuid | YES | — |
| `paired_by_label` | text | YES | — |
| `justification` | text | YES | — |
| `expires_at` | timestamp with time zone | YES | — |
| `permanent` | boolean | NO | false |
| `last_activity_at` | timestamp with time zone | NO | now() |
| `revoked_at` | timestamp with time zone | YES | — |
| `revoked_by_user_id` | uuid | YES | — |
| `revoked_reason` | text | YES | — |

**Indexes**

- `xpc_pair_links_a_idx` — `CREATE INDEX xpc_pair_links_a_idx ON public.xpc_pair_links USING btree (a_pc_id)`
- `xpc_pair_links_active_idx` — `CREATE INDEX xpc_pair_links_active_idx ON public.xpc_pair_links USING btree (revoked_at) WHERE (revoked_at IS NULL)`
- `xpc_pair_links_b_idx` — `CREATE INDEX xpc_pair_links_b_idx ON public.xpc_pair_links USING btree (b_pc_id)`
- `xpc_pair_links_kind_idx` — `CREATE INDEX xpc_pair_links_kind_idx ON public.xpc_pair_links USING btree (kind)`
- `xpc_pair_links_pkey` — `CREATE UNIQUE INDEX xpc_pair_links_pkey ON public.xpc_pair_links USING btree (a_pc_id, b_pc_id)`

**RLS policies**

- `xpc_pair_links_delete` (DELETE, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `—`
- `xpc_pair_links_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `xpc_is_super_admin()`
- `xpc_pair_links_select` (SELECT, roles={authenticated})
  - USING: `(xpc_is_super_admin() OR (a_pc_id = ANY (xpc_my_pc_ids())) OR (b_pc_id = ANY (xpc_my_pc_ids())))`
  - WITH CHECK: `—`
- `xpc_pair_links_update` (UPDATE, roles={authenticated})
  - USING: `xpc_is_super_admin()`
  - WITH CHECK: `xpc_is_super_admin()`

### xpc_pending

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | text | NO | — |
| `hosting_squadron_id` | text | NO | — |
| `hosting_squadron_name` | text | NO | — |
| `home_squadron_id` | text | NO | — |
| `home_squadron_name` | text | NO | — |
| `guest_pilot_name` | text | NO | — |
| `guest_pilot_military_number` | text | YES | — |
| `guest_seat` | text | NO | — |
| `sortie` | jsonb | NO | — |
| `submitted_at` | timestamp with time zone | NO | now() |
| `submitted_by` | text | NO | — |
| `status` | text | NO | 'pending'::text |
| `decided_at` | timestamp with time zone | YES | — |
| `decided_by` | text | YES | — |
| `decision_reason` | text | YES | — |
| `edited_sortie` | jsonb | YES | — |
| `submitter_display_name` | text | YES | — |
| `submitter_rank` | text | YES | — |
| `submitter_seat_label` | text | YES | — |

**Indexes**

- `xpc_pending_home_status_idx` — `CREATE INDEX xpc_pending_home_status_idx ON public.xpc_pending USING btree (home_squadron_id, status, submitted_at DESC)`
- `xpc_pending_pkey` — `CREATE UNIQUE INDEX xpc_pending_pkey ON public.xpc_pending USING btree (id)`

**RLS policies**

- `xpc_pending_delete` (DELETE, roles={authenticated})
  - USING: `(home_squadron_id = ANY (xpc_my_pc_ids()))`
  - WITH CHECK: `—`
- `xpc_pending_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`
- `xpc_pending_select` (SELECT, roles={authenticated})
  - USING: `((xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text])) OR (hosting_squadron_id = ANY (xpc_my_pc_ids())) OR (home_squadron_id = ANY (xpc_my_pc_ids())) OR ((xpc_caller_squadron_ids() IS NOT NULL) AND ((hosting_squadron_id = ANY (xpc_caller_squadron_ids())) OR (home_squadron_id = ANY (xpc_caller_squadron_ids())))))`
  - WITH CHECK: `—`
- `xpc_pending_update` (UPDATE, roles={authenticated})
  - USING: `((hosting_squadron_id = ANY (xpc_my_pc_ids())) OR (home_squadron_id = ANY (xpc_my_pc_ids())))`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`

### xpc_registry

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | text | NO | — |
| `squadron_name` | text | NO | — |
| `tier` | text | NO | — |
| `base` | text | YES | — |
| `wing` | text | YES | — |
| `last_seen` | timestamp with time zone | NO | now() |
| `device_name` | text | YES | — |
| `parent_pc_id` | text | YES | — |
| `wing_id` | uuid | YES | — |
| `base_id` | uuid | YES | — |
| `squadron_pc_id` | text | YES | — |

**Foreign keys**

- `wing_id` → `wings.id` (`xpc_registry_wing_id_fkey`)
- `base_id` → `bases.id` (`xpc_registry_base_id_fkey`)

**Indexes**

- `xpc_registry_base_id_idx` — `CREATE INDEX xpc_registry_base_id_idx ON public.xpc_registry USING btree (base_id)`
- `xpc_registry_canon_uniq` — `CREATE UNIQUE INDEX xpc_registry_canon_uniq ON public.xpc_registry USING btree (xpc_canon_pc_id(id))`
- `xpc_registry_id_canon_idx` — `CREATE UNIQUE INDEX xpc_registry_id_canon_idx ON public.xpc_registry USING btree (xpc_canon_pc_id(id))`
- `xpc_registry_last_seen_idx` — `CREATE INDEX xpc_registry_last_seen_idx ON public.xpc_registry USING btree (last_seen DESC)`
- `xpc_registry_parent_idx` — `CREATE INDEX xpc_registry_parent_idx ON public.xpc_registry USING btree (parent_pc_id)`
- `xpc_registry_pkey` — `CREATE UNIQUE INDEX xpc_registry_pkey ON public.xpc_registry USING btree (id)`
- `xpc_registry_squadron_pc_idx` — `CREATE INDEX xpc_registry_squadron_pc_idx ON public.xpc_registry USING btree (squadron_pc_id)`
- `xpc_registry_wing_id_idx` — `CREATE INDEX xpc_registry_wing_id_idx ON public.xpc_registry USING btree (wing_id)`

**RLS policies**

- `xpc_registry_delete` (DELETE, roles={authenticated})
  - USING: `(id = ANY (xpc_my_pc_ids()))`
  - WITH CHECK: `—`
- `xpc_registry_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `true`
- `xpc_registry_select` (SELECT, roles={anon,authenticated})
  - USING: `true`
  - WITH CHECK: `—`
- `xpc_registry_update` (UPDATE, roles={authenticated})
  - USING: `true`
  - WITH CHECK: `true`

### xpc_schedule_shares

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `id` | text | NO | — |
| `flight_date` | date | NO | — |
| `origin_squadron_id` | text | NO | — |
| `origin_squadron_name` | text | NO | — |
| `current_tier` | text | NO | — |
| `current_pc_id` | text | YES | — |
| `current_pc_name` | text | YES | — |
| `status` | text | NO | — |
| `rows` | jsonb | NO | '[]'::jsonb |
| `baseline_rows` | jsonb | NO | '[]'::jsonb |
| `history` | jsonb | NO | '[]'::jsonb |
| `edited_rows` | jsonb | YES | — |
| `edited_by` | text | YES | — |
| `updated_at` | timestamp with time zone | NO | now() |
| `program` | jsonb | YES | — |
| `edited_program` | jsonb | YES | — |
| `chain_pc_ids` | ARRAY | NO | '{}'::text[] |
| `approved_at` | timestamp with time zone | YES | — |
| `approved_by` | text | YES | — |
| `rejected_by_pc_ids` | ARRAY | NO | '{}'::text[] |
| `originator_dismissed_at` | timestamp with time zone | YES | — |
| `submitter_display_name` | text | YES | — |
| `submitter_rank` | text | YES | — |
| `submitter_seat_label` | text | YES | — |

**Indexes**

- `xpc_schedule_current_pc_idx` — `CREATE INDEX xpc_schedule_current_pc_idx ON public.xpc_schedule_shares USING btree (current_pc_id, flight_date DESC)`
- `xpc_schedule_origin_idx` — `CREATE INDEX xpc_schedule_origin_idx ON public.xpc_schedule_shares USING btree (origin_squadron_id, flight_date DESC)`
- `xpc_schedule_shares_chain_pc_ids_gin` — `CREATE INDEX xpc_schedule_shares_chain_pc_ids_gin ON public.xpc_schedule_shares USING gin (chain_pc_ids)`
- `xpc_schedule_shares_pkey` — `CREATE UNIQUE INDEX xpc_schedule_shares_pkey ON public.xpc_schedule_shares USING btree (id)`

**RLS policies**

- `xpc_schedule_delete` (DELETE, roles={public})
  - USING: `((origin_squadron_id = ANY (xpc_my_pc_ids())) OR (current_pc_id = ANY (xpc_my_pc_ids())))`
  - WITH CHECK: `—`
- `xpc_schedule_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`
- `xpc_schedule_select` (SELECT, roles={authenticated})
  - USING: `((origin_squadron_id = ANY (xpc_my_pc_ids())) OR (current_pc_id = ANY (xpc_my_pc_ids())) OR (xpc_my_pc_ids() && chain_pc_ids))`
  - WITH CHECK: `—`
- `xpc_schedule_update` (UPDATE, roles={authenticated})
  - USING: `((origin_squadron_id = ANY (xpc_my_pc_ids())) OR (current_pc_id = ANY (xpc_my_pc_ids())))`
  - WITH CHECK: `(auth.uid() IS NOT NULL)`

### xpc_squadron_snapshot

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `squadron_id` | text | NO | — |
| `ops_pc_id` | text | NO | — |
| `snapshot_at` | timestamp with time zone | NO | now() |
| `payload` | jsonb | NO | '{}'::jsonb |
| `updated_by` | uuid | NO | auth.uid() |

**Indexes**

- `xpc_squadron_snapshot_pkey` — `CREATE UNIQUE INDEX xpc_squadron_snapshot_pkey ON public.xpc_squadron_snapshot USING btree (squadron_id)`
- `xpc_squadron_snapshot_seen_idx` — `CREATE INDEX xpc_squadron_snapshot_seen_idx ON public.xpc_squadron_snapshot USING btree (snapshot_at DESC)`

**RLS policies**

- `xpc_snap_select` (SELECT, roles={authenticated})
  - USING: `((xpc_caller_role() = ANY (ARRAY['super_admin'::text, 'superadmin'::text, 'admin'::text])) OR (squadron_id = ANY (xpc_my_pc_ids())) OR ((xpc_caller_squadron_ids() IS NOT NULL) AND (squadron_id = ANY (xpc_caller_squadron_ids()))))`
  - WITH CHECK: `—`
- `xpc_snap_update` (UPDATE, roles={authenticated})
  - USING: `((ops_pc_id = ANY (xpc_my_pc_ids())) AND (ops_pc_id = squadron_id))`
  - WITH CHECK: `((auth.uid() IS NOT NULL) AND (ops_pc_id IS NOT NULL) AND (ops_pc_id <> ''::text) AND (ops_pc_id <> 'self'::text) AND (ops_pc_id = squadron_id))`
- `xpc_snap_upsert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `((auth.uid() IS NOT NULL) AND (ops_pc_id IS NOT NULL) AND (ops_pc_id <> ''::text) AND (ops_pc_id <> 'self'::text) AND (ops_pc_id = squadron_id))`

### xpc_user_pcs

**Columns / defaults / nullability**

| col | type | null | default |
|---|---|---|---|
| `user_id` | uuid | NO | — |
| `pc_id` | text | NO | — |

**Indexes**

- `xpc_user_pcs_pkey` — `CREATE UNIQUE INDEX xpc_user_pcs_pkey ON public.xpc_user_pcs USING btree (user_id, pc_id)`

**RLS policies**

- `xpc_user_pcs_self_delete` (DELETE, roles={authenticated})
  - USING: `(user_id = auth.uid())`
  - WITH CHECK: `—`
- `xpc_user_pcs_self_insert` (INSERT, roles={authenticated})
  - USING: `—`
  - WITH CHECK: `(user_id = auth.uid())`
- `xpc_user_pcs_self_select` (SELECT, roles={authenticated})
  - USING: `(user_id = auth.uid())`
  - WITH CHECK: `—`
- `xpc_user_pcs_self_update` (UPDATE, roles={authenticated})
  - USING: `(user_id = auth.uid())`
  - WITH CHECK: `(user_id = auth.uid())`


---

## APPENDIX B — Full RPC signatures (149 functions)

Every PostgreSQL function in the `public` schema, with arguments, return type,
language, and `SECURITY DEFINER` flag. Caller / JWT-claim requirements are
encoded inside the policies that wrap each table; `SECURITY DEFINER` functions
run as their owner (`postgres`) and bypass RLS — every one of them must do its
own auth check via `auth.uid()`, `auth.jwt()`, the helpers `is_super_admin()` /
`is_unit_admin()` / `xpc_my_pc_ids()`, or by reading
`current_setting('request.jwt.claims', true)::jsonb` directly.

| function | signature | returns | language | SECURITY DEFINER |
|---|---|---|---|---|
| `_device_request_audit` | `(())` | `trigger` | plpgsql | **yes** |
| `_hash_secret` | `(p_secret text)` | `text` | sql | no |
| `_normalize_text_input` | `(())` | `trigger` | plpgsql | no |
| `_sortie_closed_month_guard` | `(())` | `trigger` | plpgsql | no |
| `_sync_squadrons_wing_on_rename` | `(())` | `trigger` | plpgsql | **yes** |
| `_sync_xpc_denorm_on_squadron_rename` | `(())` | `trigger` | plpgsql | **yes** |
| `_unit_join_secret_ok` | `(())` | `boolean` | plpgsql | **yes** |
| `_unit_member_audit` | `(())` | `trigger` | plpgsql | **yes** |
| `_unschedule_if_exists` | `(job_name text)` | `void` | plpgsql | no |
| `_xpc_merge_registry_duplicates` | `(())` | `void` | plpgsql | no |
| `_xpc_outbox_dispatch_one` | `(p_id uuid)` | `boolean` | plpgsql | **yes** |
| `_xpc_outbox_dispatch_xpc_message` | `(p_payload jsonb)` | `void` | plpgsql | **yes** |
| `audit_log_archive_sweep` | `(())` | `integer` | plpgsql | **yes** |
| `audit_log_size_monitor` | `(())` | `void` | plpgsql | **yes** |
| `audit_purge_stale_entries` | `(())` | `integer` | plpgsql | **yes** |
| `bind_pilot_auth_user` | `(p_pilot_id text, p_auth_user_id uuid)` | `void` | plpgsql | **yes** |
| `citext` | `(character)` | `citext` | internal | no |
| `citext` | `(boolean)` | `citext` | internal | no |
| `citext` | `(inet)` | `citext` | internal | no |
| `citext_cmp` | `(citext, citext)` | `integer` | c | no |
| `citext_eq` | `(citext, citext)` | `boolean` | c | no |
| `citext_ge` | `(citext, citext)` | `boolean` | c | no |
| `citext_gt` | `(citext, citext)` | `boolean` | c | no |
| `citext_hash` | `(citext)` | `integer` | c | no |
| `citext_hash_extended` | `(citext, bigint)` | `bigint` | c | no |
| `citext_larger` | `(citext, citext)` | `citext` | c | no |
| `citext_le` | `(citext, citext)` | `boolean` | c | no |
| `citext_lt` | `(citext, citext)` | `boolean` | c | no |
| `citext_ne` | `(citext, citext)` | `boolean` | c | no |
| `citext_pattern_cmp` | `(citext, citext)` | `integer` | c | no |
| `citext_pattern_ge` | `(citext, citext)` | `boolean` | c | no |
| `citext_pattern_gt` | `(citext, citext)` | `boolean` | c | no |
| `citext_pattern_le` | `(citext, citext)` | `boolean` | c | no |
| `citext_pattern_lt` | `(citext, citext)` | `boolean` | c | no |
| `citext_smaller` | `(citext, citext)` | `citext` | c | no |
| `citextin` | `(cstring)` | `citext` | internal | no |
| `citextout` | `(citext)` | `cstring` | internal | no |
| `citextrecv` | `(internal)` | `citext` | internal | no |
| `citextsend` | `(citext)` | `bytea` | internal | no |
| `clear_reminder_schedule` | `(())` | `jsonb` | plpgsql | **yes** |
| `device_requests_purge_stale` | `(())` | `void` | plpgsql | **yes** |
| `get_pilot_reminder_prefs` | `(())` | `jsonb` | plpgsql | **yes** |
| `is_month_closed` | `(p_squadron_id uuid, p_date date)` | `boolean` | sql | **yes** |
| `issue_pilot_link_code` | `(p_pilot_id text)` | `text` | plpgsql | **yes** |
| `link_pilot_device` | `(p_mil text, p_code text)` | `jsonb` | plpgsql | **yes** |
| `list_pilot_sync_status` | `(())` | `TABLE(pilot_id text, last_seen_at timestamp with time zone, push_enabled boolean, has_token boolean)` | plpgsql | **yes** |
| `max` | `(citext)` | `citext` | internal | no |
| `min` | `(citext)` | `citext` | internal | no |
| `monthly_report_close_close` | `(p_squadron_id uuid, p_year_month text, p_reason text DEFAULT NULL::text)` | `void` | plpgsql | **yes** |
| `monthly_report_close_reopen` | `(p_squadron_id uuid, p_year_month text, p_reason text)` | `void` | plpgsql | **yes** |
| `ops_backup_audit_ping` | `(())` | `void` | plpgsql | **yes** |
| `pilot_heartbeat` | `(())` | `void` | plpgsql | **yes** |
| `pilot_id` | `(())` | `text` | sql | no |
| `pilot_purge_dead_link_codes` | `(())` | `integer` | plpgsql | **yes** |
| `pilot_snapshot` | `(p_token text)` | `jsonb` | plpgsql | **yes** |
| `pilot_squadron_for_caller` | `(())` | `uuid` | sql | **yes** |
| `ping_pilot_sync` | `(())` | `timestamp with time zone` | plpgsql | **yes** |
| `recent_reminder_log` | `(())` | `jsonb` | plpgsql | **yes** |
| `regexp_match` | `(citext, citext, text)` | `text[]` | sql | no |
| `regexp_match` | `(citext, citext)` | `text[]` | sql | no |
| `regexp_matches` | `(citext, citext)` | `SETOF text[]` | sql | no |
| `regexp_matches` | `(citext, citext, text)` | `SETOF text[]` | sql | no |
| `regexp_replace` | `(citext, citext, text)` | `text` | sql | no |
| `regexp_replace` | `(citext, citext, text, text)` | `text` | sql | no |
| `regexp_split_to_array` | `(citext, citext)` | `text[]` | sql | no |
| `regexp_split_to_array` | `(citext, citext, text)` | `text[]` | sql | no |
| `regexp_split_to_table` | `(citext, citext, text)` | `SETOF text` | sql | no |
| `regexp_split_to_table` | `(citext, citext)` | `SETOF text` | sql | no |
| `reminder_schedule_status` | `(())` | `jsonb` | plpgsql | **yes** |
| `reminder_schedules_touch_updated_at` | `(())` | `trigger` | plpgsql | no |
| `replace` | `(citext, citext, citext)` | `text` | sql | no |
| `rls_auto_enable` | `(())` | `event_trigger` | plpgsql | **yes** |
| `runtime_error_capture` | `(p_app text, p_app_version text, p_page text, p_message text, p_name text DEFAULT NULL::text, p_stack text DEFAULT NULL::text, p_user_agent text DEFAULT NULL::text, p_detail jsonb DEFAULT '{}'::jsonb)` | `bigint` | plpgsql | **yes** |
| `runtime_errors_digest` | `(())` | `void` | plpgsql | **yes** |
| `runtime_errors_purge` | `(())` | `integer` | plpgsql | **yes** |
| `save_pilot_reminder_prefs` | `(p_thresholds jsonb, p_push_enabled boolean, p_expo_push_token text, p_platform text)` | `void` | plpgsql | **yes** |
| `schema_drift_check` | `(())` | `boolean` | plpgsql | **yes** |
| `schema_fingerprint_public` | `(())` | `text` | plpgsql | **yes** |
| `set_reminder_schedule` | `(p_function_url text, p_service_key text, p_cron text DEFAULT '0 6 * * *'::text)` | `jsonb` | plpgsql | **yes** |
| `split_part` | `(citext, citext, integer)` | `text` | sql | no |
| `squadron_id` | `(())` | `uuid` | sql | no |
| `squadrons_canon_guard` | `(())` | `trigger` | plpgsql | no |
| `squadrons_canon_name` | `(p_name text)` | `text` | sql | no |
| `squadrons_normalize_name` | `(())` | `trigger` | plpgsql | no |
| `strpos` | `(citext, citext)` | `integer` | sql | no |
| `texticlike` | `(citext, text)` | `boolean` | internal | no |
| `texticlike` | `(citext, citext)` | `boolean` | internal | no |
| `texticnlike` | `(citext, text)` | `boolean` | internal | no |
| `texticnlike` | `(citext, citext)` | `boolean` | internal | no |
| `texticregexeq` | `(citext, citext)` | `boolean` | internal | no |
| `texticregexeq` | `(citext, text)` | `boolean` | internal | no |
| `texticregexne` | `(citext, text)` | `boolean` | internal | no |
| `texticregexne` | `(citext, citext)` | `boolean` | internal | no |
| `transfer_pilot` | `(p_pilot_id text, p_to_squadron uuid)` | `jsonb` | plpgsql | **yes** |
| `translate` | `(citext, citext, text)` | `text` | sql | no |
| `unit_complete_approval` | `(p_request_id uuid, p_auth_user_id uuid, p_supabase_email text)` | `void` | plpgsql | **yes** |
| `unit_get_join_secret` | `(())` | `text` | plpgsql | **yes** |
| `unit_ignore_request` | `(p_request_id uuid)` | `void` | plpgsql | **yes** |
| `unit_list_devices` | `(())` | `TABLE(member_id uuid, device_id uuid, username text, display_name text, role text, tier text, squadron_allow_list text[], approved_at timestamp with time zone, last_seen_at timestamp with time zone, fingerprint_short text, status text)` | plpgsql | **yes** |
| `unit_mark_claim_consumed` | `(p_request_id uuid)` | `void` | plpgsql | **yes** |
| `unit_member_self` | `(())` | `TABLE(member_id uuid, device_id uuid, status text, role text, tier text, squadron_allow_list text[], display_name text, username text)` | plpgsql | **yes** |
| `unit_pending_requests` | `(())` | `TABLE(id uuid, requested_role text, requested_squadron_names text[], username text, display_name text, fingerprint text, originating_ip inet, originating_city text, submitted_at timestamp with time zone, status text)` | plpgsql | **yes** |
| `unit_reject_request` | `(p_request_id uuid, p_reason text)` | `void` | plpgsql | **yes** |
| `unit_remove_member` | `(p_member_id uuid, p_reason text)` | `void` | plpgsql | **yes** |
| `unit_request_join` | `(p_role text, p_requested_squadron_names text[], p_username text, p_display_name text, p_password_sha256 text, p_claim_token text, p_fingerprint text, p_originating_city text DEFAULT NULL::text)` | `uuid` | plpgsql | **yes** |
| `unit_request_status` | `(p_request_id uuid)` | `TABLE(status text, decision_reason text, supabase_email text, member_id uuid, device_id uuid, claim_consumed boolean)` | plpgsql | **yes** |
| `unit_reserve_approval` | `(p_request_id uuid, p_squadron_names_override text[])` | `TABLE(member_id uuid, device_id uuid, username text, display_name text, role text, tier text, squadron_allow_list text[], primary_squadron_id uuid)` | plpgsql | **yes** |
| `unit_rotate_join_secret` | `(())` | `text` | plpgsql | **yes** |
| `unit_squadrons_for_join` | `(())` | `TABLE(id uuid, name text, number text, base text)` | sql | **yes** |
| `unit_super_admin_complete_setup` | `(p_auth_user_id uuid, p_username text, p_display_name text)` | `uuid` | plpgsql | **yes** |
| `unit_super_admin_exists` | `(())` | `boolean` | sql | **yes** |
| `unit_super_admin_setup_allowed` | `(())` | `boolean` | plpgsql | **yes** |
| `unit_update_squadrons` | `(p_member_id uuid, p_squadron_names text[])` | `void` | plpgsql | **yes** |
| `xpc_admin_bulk_pair_in_squadron` | `(())` | `integer` | plpgsql | **yes** |
| `xpc_admin_create_pair` | `(p_a_pc_id text, p_b_pc_id text, p_a_tier text, p_b_tier text, p_a_squadron text, p_b_squadron text, p_a_seat text, p_b_seat text, p_a_user_display text, p_b_user_display text, p_justification text DEFAULT NULL::text, p_expires_at timestamp with time zone DEFAULT NULL::timestamp with time zone, p_permanent boolean DEFAULT false, p_kind_hint text DEFAULT NULL::text)` | `TABLE(a_pc_id text, b_pc_id text, kind text)` | plpgsql | **yes** |
| `xpc_admin_reset_pc` | `(p_pc_id text, p_reason text DEFAULT NULL::text)` | `integer` | plpgsql | **yes** |
| `xpc_admin_revoke_pair` | `(p_a_pc_id text, p_b_pc_id text, p_reason text)` | `void` | plpgsql | **yes** |
| `xpc_admin_set_permanent` | `(p_a_pc_id text, p_b_pc_id text, p_permanent boolean)` | `void` | plpgsql | **yes** |
| `xpc_backfill_org_chart` | `(())` | `TABLE(action text, entry_name text)` | plpgsql | **yes** |
| `xpc_caller_role` | `(())` | `text` | sql | no |
| `xpc_caller_squadron_ids` | `(())` | `text[]` | sql | no |
| `xpc_caller_tier` | `(())` | `text` | sql | no |
| `xpc_can_claim_pc_id` | `(p_pc_id text)` | `boolean` | plpgsql | **yes** |
| `xpc_canon_pc_id` | `(p_id text)` | `text` | sql | no |
| `xpc_canon_seat` | `(p_seat text)` | `text` | sql | no |
| `xpc_ensure_claim` | `(target_pc_id text)` | `void` | plpgsql | **yes** |
| `xpc_is_super_admin` | `(())` | `boolean` | sql | no |
| `xpc_messages_autoclaim` | `(())` | `trigger` | plpgsql | **yes** |
| `xpc_my_jwt_tier` | `(())` | `text` | sql | no |
| `xpc_my_pc_ids` | `(())` | `text[]` | sql | **yes** |
| `xpc_outbox_monitor` | `(())` | `integer` | plpgsql | **yes** |
| `xpc_outbox_process` | `(())` | `TABLE(processed integer, succeeded integer, failed integer)` | plpgsql | **yes** |
| `xpc_outbox_send` | `(p_target text, p_payload jsonb)` | `uuid` | plpgsql | **yes** |
| `xpc_pair_links_enforce` | `(())` | `trigger` | plpgsql | no |
| `xpc_pair_links_sweep` | `(p_inactive_days integer DEFAULT 90)` | `TABLE(revoked_count integer, expired_count integer)` | plpgsql | **yes** |
| `xpc_pair_links_sweep_internal` | `(p_inactive_days integer DEFAULT 90)` | `TABLE(revoked_count integer, expired_count integer)` | plpgsql | **yes** |
| `xpc_pair_touch` | `(p_pc_id text)` | `integer` | plpgsql | **yes** |
| `xpc_pc_id_matches_mine` | `(p_pc_id text)` | `boolean` | plpgsql | **yes** |
| `xpc_pending_autoclaim` | `(())` | `trigger` | plpgsql | **yes** |
| `xpc_purge_archived_messages` | `(())` | `integer` | plpgsql | **yes** |
| `xpc_purge_inactive_pcs` | `(p_days integer)` | `integer` | plpgsql | **yes** |
| `xpc_purge_inactive_pcs` | `(())` | `void` | plpgsql | **yes** |
| `xpc_redeem_pair_code` | `(p_code text, p_joiner_pc_id text, p_joiner_tier text, p_joiner_squadron text, p_joiner_user_display text, p_joiner_user_seat text)` | `TABLE(a_pc_id text, b_pc_id text, kind text)` | plpgsql | **yes** |
| `xpc_registry_canon_guard` | `(())` | `trigger` | plpgsql | no |
| `xpc_registry_normalize_id` | `(())` | `trigger` | plpgsql | no |
| `xpc_revoke_my_pair` | `(p_a_pc_id text, p_b_pc_id text, p_reason text DEFAULT NULL::text)` | `void` | plpgsql | **yes** |
| `xpc_schedule_autoclaim` | `(())` | `trigger` | plpgsql | **yes** |
| `xpc_snap_autoclaim` | `(())` | `trigger` | plpgsql | **yes** |
| `xpc_validate_pairing` | `(p_a_tier text, p_b_tier text, p_a_squadron text, p_b_squadron text, p_a_seat text, p_b_seat text, p_super_admin boolean, p_justification text, p_expires_at timestamp with time zone, p_kind_hint text DEFAULT NULL::text)` | `text` | plpgsql | no |

---

## APPENDIX C — Per-RPC purpose + caller + JWT claim matrix (149 functions)

For every function in `public` this table gives a derived purpose, the
  intended caller surface, and the JWT-claim prerequisite. Derivation rules:

  - Functions whose name starts with `_` are internal triggers/helpers — never
    called directly; the caller column shows where the invocation comes from
    inside the database.
  - `xpc_*` functions are the cross-PC chain — they read
    `request.jwt.claims` directly via the helpers `xpc_my_pc_ids()` and
    `xpc_my_chain_pc_ids()` and must be invoked by an authenticated member
    whose claims include the appropriate `pc_id` / tier.
  - `unit_*` functions belong to the multi-PC-join state machine; the
    reserve/complete/cancel/approve trio runs **only** under the service-role
    context inside its edge function (`unit-approve-device`,
    `unit-claim-device`).
  - `super_admin_*` functions are gated by an explicit
    `is_super_admin()` check inside the function body and additionally
    require the caller's JWT app_metadata.role to be `super_admin`.
  - All `SECURITY DEFINER` functions bypass RLS and must self-authorize;
    every one in this table that has SECURITY DEFINER carries an explicit
    permission check at the top of its body (see the function source in
    `artifacts/pilot-dashboard/supabase/migrations/`).

  | function | purpose | caller(s) | JWT claim requirement | SECURITY DEFINER |
  |---|---|---|---|---|
| `_device_request_audit` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `_hash_secret` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | no |
| `_normalize_text_input` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | no |
| `_sortie_closed_month_guard` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | no |
| `_sync_squadrons_wing_on_rename` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `_sync_xpc_denorm_on_squadron_rename` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `_unit_join_secret_ok` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `_unit_member_audit` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `_unschedule_if_exists` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | no |
| `_xpc_merge_registry_duplicates` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | no |
| `_xpc_outbox_dispatch_one` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `_xpc_outbox_dispatch_xpc_message` | Internal trigger / helper (not directly invoked) | triggers, other RPCs | n/a — runs as table owner | **yes** |
| `audit_log_archive_sweep` | Audit-log retention / archive RPC | pg_cron daily sweep | service-role (cron context) | **yes** |
| `audit_log_size_monitor` | Audit-log retention / archive RPC | pg_cron daily sweep | service-role (cron context) | **yes** |
| `audit_purge_stale_entries` | Drops audit_log rows older than the configured retention window (currently 365 days). | pg_cron daily sweep `audit-log-purge` | service-role (cron context); SECURITY DEFINER, bypasses RLS. | **yes**|
| `bind_pilot_auth_user` | Binds an auth.users row to a pilots row by setting `auth_user_id` after a successful link. | link-pilot-device edge function (after `auth.admin.createUser`) | service-role inside the edge function; SECURITY DEFINER, no client path. | **yes**|
| `citext` | PostgreSQL citext extension type / cast (case-insensitive text). Provided by the `citext` extension. | Database internals (column types, casts) | n/a — extension function, not directly invoked by app code. | no|
| `citext` | PostgreSQL citext extension type / cast (case-insensitive text). Provided by the `citext` extension. | Database internals (column types, casts) | n/a — extension function, not directly invoked by app code. | no|
| `citext` | PostgreSQL citext extension type / cast (case-insensitive text). Provided by the `citext` extension. | Database internals (column types, casts) | n/a — extension function, not directly invoked by app code. | no|
| `citext_cmp` | citext comparison operator support function. | PostgreSQL planner via `=`/`<`/`>` operators on citext | n/a — extension function. | no|
| `citext_eq` | citext equality operator support. | PostgreSQL planner | n/a — extension function. | no|
| `citext_ge` | citext `>=` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `citext_gt` | citext `>` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `citext_hash` | citext hash function used by hash indexes / UNION etc. | PostgreSQL planner | n/a — extension function. | no|
| `citext_hash_extended` | citext extended hash for partitioning. | PostgreSQL planner | n/a — extension function. | no|
| `citext_larger` | citext aggregate support (max). | PostgreSQL planner | n/a — extension function. | no|
| `citext_le` | citext `<=` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `citext_lt` | citext `<` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `citext_ne` | citext `<>` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `citext_pattern_cmp` | citext pattern-class comparison. | PostgreSQL planner (pattern ops) | n/a — extension function. | no|
| `citext_pattern_ge` | citext pattern `>=` operator. | PostgreSQL planner | n/a — extension function. | no|
| `citext_pattern_gt` | citext pattern `>` operator. | PostgreSQL planner | n/a — extension function. | no|
| `citext_pattern_le` | citext pattern `<=` operator. | PostgreSQL planner | n/a — extension function. | no|
| `citext_pattern_lt` | citext pattern `<` operator. | PostgreSQL planner | n/a — extension function. | no|
| `citext_smaller` | citext aggregate support (min). | PostgreSQL planner | n/a — extension function. | no|
| `citextin` | citext input parser (text → citext). | PostgreSQL planner | n/a — extension function. | no|
| `citextout` | citext output formatter (citext → text). | PostgreSQL planner | n/a — extension function. | no|
| `citextrecv` | citext binary input. | PostgreSQL wire protocol | n/a — extension function. | no|
| `citextsend` | citext binary output. | PostgreSQL wire protocol | n/a — extension function. | no|
| `clear_reminder_schedule` | Disables the `notify-currency-expiry-daily` pg_cron schedule (idempotent). | manage-reminder-schedule edge function (action="disable") | service-role inside the edge function; SECURITY DEFINER. | **yes**|
| `device_requests_purge_stale` | Deletes pending join requests older than 14 days plus already-consumed claim tokens older than 24h. | pg_cron weekly sweep `device-requests-purge-weekly` | service-role (cron context); SECURITY DEFINER. | **yes**|
| `get_pilot_reminder_prefs` | Returns the calling pilot's reminder thresholds + push token (single row). | Mobile app (currency reminders settings screen) | authenticated; pilot must be the row owner — enforced inside via `current_pilot()`. SECURITY DEFINER (so it can read the row even if RLS predicates would lock it). | **yes**|
| `is_month_closed` | Predicate — true if the supplied YYYY-MM is locked by a monthly close snapshot. | Sortie write RPCs, dashboard guard rails | authenticated; SECURITY DEFINER so it can consult the closed-months table without granting it to PUBLIC. | **yes**|
| `issue_pilot_link_code` | Mints a one-time link code for a pilot (used by the dashboard "Pair phone" button). | Dashboard ops officer / commander | authenticated; caller's `squadron_id` claim must match the pilot's squadron. SECURITY DEFINER. | **yes**|
| `link_pilot_device` | Server-side counterpart of the link-pilot-device edge function — verifies code + binds the device row. | link-pilot-device edge function | service-role inside the edge function; SECURITY DEFINER. | **yes**|
| `list_pilot_sync_status` | Returns per-pilot last-seen-from-phone timestamps for the roster green-dot indicator. | Dashboard pilots list (realtime + 30s poll) | authenticated; squadron-scoped via the caller's claims. SECURITY DEFINER. | **yes**|
| `max` | Aggregate `max()` overloaded for citext (provided by the citext extension). | PostgreSQL planner | n/a — extension function. | no|
| `min` | Aggregate `min()` overloaded for citext. | PostgreSQL planner | n/a — extension function. | no|
| `monthly_report_close_close` | Monthly close / snapshot RPC | pg_cron + commander dashboards | service-role for cron, commander tier for read | **yes** |
| `monthly_report_close_reopen` | Monthly close / snapshot RPC | pg_cron + commander dashboards | service-role for cron, commander tier for read | **yes** |
| `ops_backup_audit_ping` | Writes a heartbeat row to `audit_log` so the daily backup job is visible end-to-end. | pg_cron `ops-backup-audit-ping` (daily 03:05 UTC) | service-role (cron context); SECURITY DEFINER. | **yes**|
| `pilot_heartbeat` | Pilot-scoped read (RLS-helper) | Dashboard hooks, mobile app | authenticated; matches own pilot_id | **yes** |
| `pilot_id` | Pilot-scoped read (RLS-helper) | Dashboard hooks, mobile app | authenticated; matches own pilot_id | no |
| `pilot_purge_dead_link_codes` | Pilot-scoped read (RLS-helper) | Dashboard hooks, mobile app | authenticated; matches own pilot_id | **yes** |
| `pilot_snapshot` | Pilot-scoped read (RLS-helper) | Dashboard hooks, mobile app | authenticated; matches own pilot_id | **yes** |
| `pilot_squadron_for_caller` | Pilot-scoped read (RLS-helper) | Dashboard hooks, mobile app | authenticated; matches own pilot_id | **yes** |
| `ping_pilot_sync` | Updates `pilots.last_phone_sync_at` from the mobile app heartbeat (every 60s while open). | Mobile app (background heartbeat) | authenticated as the pilot user; SECURITY DEFINER so the pilot user can update only its own row. | **yes**|
| `recent_reminder_log` | Returns the last 50 entries of `currency_reminder_history` for the super-admin reminder panel. | manage-reminder-schedule edge function (action="log") | service-role inside the edge function; SECURITY DEFINER. | **yes**|
| `regexp_match` | Postgres regexp_match() overloads (citext / pg_catalog). | SQL queries | n/a — built-in. | no|
| `regexp_match` | Postgres regexp_match() overloads (citext / pg_catalog). | SQL queries | n/a — built-in. | no|
| `regexp_matches` | Postgres regexp_matches() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_matches` | Postgres regexp_matches() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_replace` | Postgres regexp_replace() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_replace` | Postgres regexp_replace() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_split_to_array` | Postgres regexp_split_to_array() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_split_to_array` | Postgres regexp_split_to_array() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_split_to_table` | Postgres regexp_split_to_table() overload for citext. | SQL queries | n/a — built-in. | no|
| `regexp_split_to_table` | Postgres regexp_split_to_table() overload for citext. | SQL queries | n/a — built-in. | no|
| `reminder_schedule_status` | Reminder / schedule helper | manage-reminder-schedule edge function | service-role inside the edge function | **yes** |
| `reminder_schedules_touch_updated_at` | Reminder / schedule helper | manage-reminder-schedule edge function | service-role inside the edge function | no |
| `replace` | citext extension overload of `replace()`. | SQL queries | n/a — built-in. | no|
| `rls_auto_enable` | Convenience helper that enables RLS + a deny-by-default policy on a freshly-created table. | Migration scripts (called from `_setup_unit_tables` etc.) | service-role at migration time; SECURITY DEFINER. | **yes**|
| `runtime_error_capture` | Inserts a row into `runtime_errors` capturing a client-side dashboard error (used by ErrorBoundary). | Dashboard global error reporter | authenticated; squadron-scoped via the caller's claims. SECURITY DEFINER so insert succeeds without a per-user policy. | **yes**|
| `runtime_errors_digest` | Runtime-error ingest / aggregate | Dashboard error reporter; cron digest | authenticated for ingest, service-role for digest | **yes** |
| `runtime_errors_purge` | Runtime-error ingest / aggregate | Dashboard error reporter; cron digest | authenticated for ingest, service-role for digest | **yes** |
| `save_pilot_reminder_prefs` | Upserts the calling pilot's reminder thresholds + push token. | Mobile app currency-reminders settings screen | authenticated as the pilot user; pilot row owner — enforced via `current_pilot()`. SECURITY DEFINER. | **yes**|
| `schema_drift_check` | Compares the running schema fingerprint against the expected one and returns the diff (used during release smoke tests). | Manual ops tooling, release CI | service-role; SECURITY DEFINER. | **yes**|
| `schema_fingerprint_public` | Returns a deterministic SHA-256 of the `public` schema (column names + types + RLS policies) — backbone of `schema_drift_check`. | schema_drift_check + manual ops | service-role; SECURITY DEFINER. | **yes**|
| `set_reminder_schedule` | Creates / updates the `notify-currency-expiry-daily` pg_cron schedule with the supplied cron expression and the project's service-role bearer. | manage-reminder-schedule edge function (action="enable") | service-role inside the edge function; SECURITY DEFINER. | **yes**|
| `split_part` | citext extension overload of `split_part()`. | SQL queries | n/a — built-in. | no|
| `squadron_id` | Squadron-scoped read | Dashboard hooks | authenticated; matches own squadron_id | no |
| `squadrons_canon_guard` | Trigger function — rejects an insert/update whose canonical name collides with an existing squadron. | Trigger on `squadrons` table | n/a — runs as table owner inside the trigger context. | no|
| `squadrons_canon_name` | Pure helper — returns the canonical (case/space-folded) form of a squadron name. Used by the canon guard trigger and by lookup queries. | squadrons_canon_guard, dashboard squadron lookup | n/a — pure function, no auth requirement. | no|
| `squadrons_normalize_name` | Trigger function — fills `canonical_name` on insert/update. | BEFORE INSERT/UPDATE trigger on `squadrons` | n/a — runs in trigger context. | no|
| `strpos` | citext extension overload of `strpos()`. | SQL queries | n/a — built-in. | no|
| `texticlike` | citext `LIKE` operator support (case-insensitive `LIKE`). | PostgreSQL planner | n/a — extension function. | no|
| `texticlike` | citext `LIKE` operator support (case-insensitive `LIKE`). | PostgreSQL planner | n/a — extension function. | no|
| `texticnlike` | citext `NOT LIKE` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `texticnlike` | citext `NOT LIKE` operator support. | PostgreSQL planner | n/a — extension function. | no|
| `texticregexeq` | citext `~` regex operator support. | PostgreSQL planner | n/a — extension function. | no|
| `texticregexeq` | citext `~` regex operator support. | PostgreSQL planner | n/a — extension function. | no|
| `texticregexne` | citext `!~` regex operator support. | PostgreSQL planner | n/a — extension function. | no|
| `texticregexne` | citext `!~` regex operator support. | PostgreSQL planner | n/a — extension function. | no|
| `transfer_pilot` | Reassigns a pilot's `squadron_id` and re-stamps related rows (sortie log, currencies) in one transaction. | Dashboard "Transfer pilot" action (super-admin only) | authenticated; caller's app_metadata.role must be `super_admin`. SECURITY DEFINER. | **yes**|
| `translate` | citext extension overload of `translate()`. | SQL queries | n/a — built-in. | no|
| `unit_complete_approval` | Unit-join state-machine step | unit-approve-device edge function (service role) | service-role inside the edge function; rejects all other callers | **yes** |
| `unit_get_join_secret` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_ignore_request` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_list_devices` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_mark_claim_consumed` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_member_self` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_pending_requests` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_reject_request` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_remove_member` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_request_join` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_request_status` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_reserve_approval` | Unit-join state-machine step | unit-approve-device edge function (service role) | service-role inside the edge function; rejects all other callers | **yes** |
| `unit_rotate_join_secret` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_squadrons_for_join` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `unit_super_admin_complete_setup` | Unit super-admin bootstrap / lifecycle | unit-super-admin-setup edge function | anon (gated by `unit_super_admin_setup_allowed()` predicate, one-shot) | **yes** |
| `unit_super_admin_exists` | Unit super-admin bootstrap / lifecycle | unit-super-admin-setup edge function | anon (gated by `unit_super_admin_setup_allowed()` predicate, one-shot) | **yes** |
| `unit_super_admin_setup_allowed` | Unit super-admin bootstrap / lifecycle | unit-super-admin-setup edge function | anon (gated by `unit_super_admin_setup_allowed()` predicate, one-shot) | **yes** |
| `unit_update_squadrons` | Unit-membership operation | Dashboard admin pane | authenticated; super_admin or unit_admin app_metadata.role | **yes** |
| `xpc_admin_bulk_pair_in_squadron` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_admin_create_pair` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_admin_reset_pc` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_admin_revoke_pair` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_admin_set_permanent` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_backfill_org_chart` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_caller_role` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_caller_squadron_ids` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_caller_tier` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_can_claim_pc_id` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_canon_pc_id` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_canon_seat` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_ensure_claim` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_is_super_admin` | Cross-PC role predicate (used in RLS USING/WITH CHECK) | RLS planner | Reads `request.jwt.claims` | no |
| `xpc_messages_autoclaim` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_my_jwt_tier` | Returns the caller's own pc_ids / claims for use in RLS | RLS, dashboard hooks | authenticated; reads claims | no |
| `xpc_my_pc_ids` | Returns the caller's own pc_ids / claims for use in RLS | RLS, dashboard hooks | authenticated; reads claims | **yes** |
| `xpc_outbox_monitor` | Cross-PC chain RPC (forward / approve / inspect) | Sqn/Wing/Base/HQ commander dashboards | authenticated; tier-gated by RLS on the underlying tables | **yes** |
| `xpc_outbox_process` | Cross-PC chain RPC (forward / approve / inspect) | Sqn/Wing/Base/HQ commander dashboards | authenticated; tier-gated by RLS on the underlying tables | **yes** |
| `xpc_outbox_send` | Cross-PC chain RPC (forward / approve / inspect) | Sqn/Wing/Base/HQ commander dashboards | authenticated; tier-gated by RLS on the underlying tables | **yes** |
| `xpc_pair_links_enforce` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_pair_links_sweep` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_pair_links_sweep_internal` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_pair_touch` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_pc_id_matches_mine` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_pending_autoclaim` | Cross-PC chain RPC (forward / approve / inspect) | Sqn/Wing/Base/HQ commander dashboards | authenticated; tier-gated by RLS on the underlying tables | **yes** |
| `xpc_purge_archived_messages` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_purge_inactive_pcs` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_purge_inactive_pcs` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_redeem_pair_code` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_registry_canon_guard` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_registry_normalize_id` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |
| `xpc_revoke_my_pair` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_schedule_autoclaim` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_snap_autoclaim` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | **yes** |
| `xpc_validate_pairing` | Cross-PC chain support | Dashboard / cron | authenticated; tier-gated | no |

---

## APPENDIX D — Per-edge-function deep dive (14 deployed functions)

For each deployed function: input body, output, who can call it, which RPCs
or tables it touches. Sourced from each function's own header comment in
`artifacts/pilot-dashboard/supabase/functions/<slug>/index.ts` plus the
deployment metadata from the Supabase Management API.

### `heal-claims`

* **Input** (POST JSON): none — operates only on the JWT-authenticated caller.
* **Output**: `{ ok: true, healed: <bool>, ... }` or 401 if unauthenticated.
* **Caller**: any signed-in user (anyone whose JWT exists). Idempotent.
* **JWT requirement**: any authenticated user. The function never accepts a
  `user_id` in its body — caller is read straight from the JWT to prevent
  cross-account claim writes.
* **Touches**: reads `auth.users.app_metadata` of the caller; writes
  `app_metadata.squadron_id` / `role` via `auth.admin.updateUserById` when
  the claims are missing. Companion to migration `0030`.

### `link-pilot-device`

* **Input** (POST JSON): `{ mil: string, code: string }` — military-number
  identifier + one-time link code shown on the dashboard.
* **Output**: `{ ok, session, pilotId, ... }` containing a real Supabase
  session that the mobile app uses thereafter.
* **Caller**: anonymous mobile-app user (this IS the mobile sign-in).
* **JWT requirement**: none (`--no-verify-jwt`); auth happens by validating
  the link code against `pair_links`.
* **Touches**: `pair_links` (reads + marks consumed), `pilots` (case-insensitive
  lookup by `mil` / `id` / `data->>phone` / `name` / `arabic_name`),
  `auth.admin.createUser` to mint a per-pilot user.

### `manage-reminder-schedule`

* **Input** (POST JSON): `{ action: 'session'|'status'|'log'|'enable'|'disable'|'run-now', token?, username?, password?, code?, cron? }`
* **Output**: shape varies per action — session returns `{ token, expiresAt }`;
  status returns `{ status }`; enable/disable return `{ result }`.
* **Caller**: dashboard super-admin panel only.
* **JWT requirement**: none on the wire; gated by an HMAC session token bound
  to the super-admin username (same `username/password/code` triple used by
  `super-admin-2fa`). Failed TOTP attempts persist into
  `super_admin_2fa.failed_attempts` with the same 5-strike, 5-minute lockout.
* **Touches**: calls SECURITY DEFINER reminder helpers from
  `0007_reminder_schedule.sql`; rewrites the `notify-currency-expiry-daily`
  pg_cron schedule; on `run-now` invokes `notify-currency-expiry`.

### `notify-alert`

* **Input** (POST JSON): `{ alertId: string }`.
* **Output**: `{ ok, sent: <count>, tickets: ExpoPushTicket[] }`.
* **Caller**: dashboard, immediately after `useCreateAlert` succeeds.
* **JWT requirement**: caller's bearer JWT must belong to the same squadron
  as the alert; the function uses the service-role key to fan out but reads
  the alert row through the caller's client first.
* **Touches**: reads `alerts` (single row), reads `pilots` + `pilot_devices`
  in the same squadron with `expo_push_token IS NOT NULL`, calls Expo
  `https://exp.host/--/api/v2/push/send`.

### `notify-currency-expiry`

* **Input** (POST JSON): empty `{}`.
* **Output**: `{ ok, sent: <count>, skipped: <count> }`.
* **Caller**: pg_cron schedule `notify-currency-expiry-daily`
  (and on-demand from `manage-reminder-schedule run-now`).
* **JWT requirement**: service-role bearer (cron context).
* **Touches**: reads `currency_reminder_prefs`, `pilots` (for `data.expiry`),
  writes `currency_reminder_history` to dedupe per
  `(pilot, currency, expiry, threshold)`, calls Expo push.

### `notify-notam`

* **Input** (POST JSON): `{ notamId: string }`.
* **Output**: `{ ok, sent: <count>, tickets: ExpoPushTicket[] }`.
* **Caller**: dashboard, immediately after `useCreateNotam` succeeds.
* **JWT requirement**: same squadron-scoped bearer as `notify-alert`.
* **Touches**: reads `notams` (single row), `pilots` + `pilot_devices` in the
  same squadron, calls Expo push.

### `provision-user` (LEGACY — still deployed; flagged §11.D)

* **Input** (POST JSON): `{ username, password, displayName?, role?: 'ops'|'deputy' }`.
* **Output**: `{ user, member }`.
* **Caller**: pre-rebuild dashboard "Add deputy ops" UI. **No live caller
  remains** — the unit-rebuild migration line replaced it with the join
  flow.
* **JWT requirement**: `app_metadata.squadron_id` set + `role IN ('ops','admin')`.
* **Touches**: `auth.admin.createUser`, `public.users` insert. Legacy
  `commanders` and `license_keys` paths it once relied on were removed by
  migration 0081.

### `super-admin-2fa`

* **Input** (POST JSON): `{ action: 'start'|'verify', username, password?, token?, code? }`.
* **Output**: action-dependent — `start` returns `{ token, enrolled, secret?, otpauth?, lockedUntil? }`;
  `verify` returns `{ ok, recoveryCodes? }`.
* **Caller**: dashboard super-admin login UI (anonymous browser).
* **JWT requirement**: none (`--no-verify-jwt`) — this IS the login.
  Authenticates using `SUPER_ADMIN_PASSWORD_HASH` env (SHA-256) and an
  HMAC challenge token (`CHALLENGE_SECRET` env).
* **Touches**: `super_admin_2fa` (reads/updates `secret`, `enrolled_at`,
  `last_verified_at`, `failed_attempts`, `locked_until`, `recovery_codes`),
  `audit_log` for security events.

### `unit-approve-device`

* **Input** (POST JSON): `{ requestId: string }`.
* **Output**: `{ ok, memberId, deviceId }`.
* **Caller**: dashboard super-admin "Approve join request" button.
* **JWT requirement**: bearer JWT with `app_metadata.role = 'super_admin'`
  (or the legacy `admin + tier=hq` combo accepted by `xpc_is_super_admin`).
* **Touches**: calls `unit_reserve_approval` (RPC, reserves a slot under a
  row-lock), `auth.admin.createUser` with a throw-away random password,
  `unit_complete_approval` (RPC, inserts `unit_members` + `devices` rows).
  See migration 0075 for the security rationale (no plaintext password
  ever held server-side).

### `unit-claim-device`

* **Input** (POST JSON): `{ requestId, claimToken, password }`.
* **Output**: `{ ok }`.
* **Caller**: the joining laptop, after its status poll shows `approved`.
* **JWT requirement**: none on the wire — the function authenticates by
  matching `sha256(password)` against the hash stored on the request row
  alongside the `claim_token` (constant-time compare).
* **Touches**: `device_requests` (reads `password_sha256`, `claim_token`,
  `claim_consumed_at`; updates `claim_consumed_at`),
  `auth.admin.updateUserById` to set the laptop's chosen password.
  Plaintext password never persisted.

### `unit-super-admin-setup`

* **Input** (POST JSON): `{ email, password, displayName, username }`.
* **Output**: `{ ok, userId }`.
* **Caller**: anonymous browser on a fresh unit (no super admin exists yet).
* **JWT requirement**: none on the wire — gated by
  `unit_super_admin_setup_allowed()` predicate (one-shot, double-checked
  inside `unit_super_admin_complete_setup` under a row-lock so two laptops
  cannot race the bootstrap).
* **Touches**: `auth.admin.createUser` with `app_metadata: { role: 'super_admin', tier: 'hq' }`,
  `public.users` insert, `unit_members` insert via
  `unit_super_admin_complete_setup`.

### `register-license` (LEGACY — still deployed; flagged §11.D)

* **Input** / **Output** / **Caller**: from the retired License-Keys
  bootstrap. The `license_keys` table was dropped by migration 0081, so
  any call to this function will now error against a missing relation.
  Kept deployed only because no one has run the cleanup task; suggested
  deletion target.

### `validate-license` (LEGACY — still deployed; flagged §11.D)

* As above — `license_keys` table no longer exists. Cleanup target.

### `provision-commander` (LEGACY — still deployed; flagged §11.D)

* As above — the `commanders` table was dropped by 0081. The function is
  also the one that the round-3 audit caught writing `role:'admin'` instead
  of `role:'commander'`; the fix landed but the function itself is
  redundant now that commanders are managed via the unit join flow.
  Cleanup target.
