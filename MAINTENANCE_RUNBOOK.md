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

---

## What the cron jobs do

The system runs three scheduled jobs in Supabase (see
migration 0043_pgcron_long_term.sql):

| Job | When | What it does |
| --- | ---- | ------------ |
| `xpc_pair_links_sweep` | nightly | Revokes pair links that have been inactive for 90 days; expires links past their `expires_at`. |
| Currency expiry notifier | daily | Pushes a notification to any pilot whose Day / Night / NVG / IRT / Medical currency is within 30 days of expiry. |
| Reminder dispatcher | hourly | Fires any one-shot or recurring reminder created by ops officers. |

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

## Versions of record

| Component | Current version | Notes |
| --------- | --------------- | ----- |
| Desktop installer | v1.1.109 | Windows-signed, auto-update enabled |
| Mobile app        | v1.1.x   | TestFlight + Play Store internal track |
| Database migrations | 0001..0044 (44 files; ledger has 47 rows — see defect D2) |
| Edge functions | 11 (heal-claims, link-pilot-device, manage-reminder-schedule, notify-alert, notify-currency-expiry, notify-notam, provision-commander, provision-user, register-license, super-admin-2fa, validate-license) |
