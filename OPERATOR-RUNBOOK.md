# Hawk Eye — Operator Runbook

**Audience:** the squadron's IT support officer, not a developer. Every
step assumes you have local administrator rights on the host PC and
know how to right-click a PowerShell window and choose **Run as
Administrator**.

---

## What you have

- One **host PC** sitting in HQ. It runs Postgres + the api-server. It
  is on the squadron LAN. It is **NOT** on the public internet.
- Multiple **dashboard PCs** (workstations for ops officers and
  commanders). Each runs the Hawk Eye `.exe`. Each one talks to the
  host PC over the LAN.
- A **USB stick** for monthly backups + occasional update transport.

You do not need an internet connection to install, run, back up,
restore, or reset anything in this system.

---

## 1. First-time install on the host PC

1. Install Postgres 14 or newer on the host PC. Pick a strong password
   for the `postgres` superuser. Write it down.
2. Install Node.js 20 or newer on the host PC.
3. Copy the Hawk Eye source folder onto the host (USB or LAN copy).
4. Open PowerShell **as administrator** in the source folder.
5. Run:
   ```
   pnpm install
   .\scripts\lan-host\first-time-setup.ps1
   ```
6. Answer the prompts:
   - Postgres superuser password (the one from step 1).
   - First super-admin username.
   - First super-admin password (8+ characters).
7. The script writes both `.env.production` files, creates the
   database, lays out every Hawk Eye table, mints the super-admin, and
   registers two scheduled tasks: one to start the api-server on boot
   (`HawkEye-ApiServer-OnStartup`), and one to back up the database
   every night at 02:30 (`HawkEye-Postgres-Backup-Daily`).
8. Note the **bootstrap token** the script prints. Store it somewhere
   safe — it is only used once, the first time you sign in remotely.

The host PC is now ready. Reboot it once and confirm the api-server
comes back up automatically (check Task Scheduler → "Hawk Eye API
Server" → status: Running).

---

## 2. First-time install on each dashboard PC

1. Copy `Hawk Eye Setup x.y.z.exe` to the dashboard PC.
2. Run the installer as a regular user.
3. The installer creates a desktop shortcut. Launch it.
4. Sign in with the super-admin account you minted at the prompts in
   step 1.6 (username + password you typed when `first-time-setup.ps1`
   asked).
5. Inside the app: **Admin → Users → Add user** to create the per-PC
   ops officer / commander accounts.

If a dashboard PC cannot reach the host PC, check:
- Are both PCs on the same LAN?
- Does the host PC respond to `ping hawk-host.local` from the
  dashboard PC?
- Is the host PC's firewall allowing inbound TCP on port 3847?

---

## 2b. Install a Commander laptop (viewer)

Squadron Commanders and Flight Commanders use their own laptops, not
the host PC. Their laptops are **viewers** — pure dashboard clients.
A viewer laptop has **no Postgres** and **no api-server**: nothing
is stored locally and login still happens against the squadron's hub
PC over the LAN.

### Install
On the commander's laptop, with Node.js 20+ and the Hawk Eye source
folder copied across (USB or LAN):
1. Open PowerShell **as administrator** in the source folder.
2. Run:
   ```
   pnpm install
   .\scripts\lan-host\setup-viewer.ps1
   ```
3. Answer the prompt:
   - **Squadron hub address** — hostname (`tigers-hub.local`) or IP
     of the squadron's host PC. The script hits the hub on
     `/api/healthz` and refuses to proceed if nothing answers or if
     the answer is from a non-hub install.
   - Optional: re-run with `-AutoDiscover` to scan the LAN for
     `_hawkeye-hub._tcp` and pick a hub from a list (requires Bonjour
     Print Services for Windows / `dns-sd.exe`).
4. The script writes the dashboard env, builds the dashboard locally
   (or copies a `-PrebuiltDist <folder>` you shipped pre-built), and
   creates a desktop shortcut + Start Menu entry under
   `Hawk Eye → Hawk Eye Viewer`.
5. The output ends with **"This PC is a viewer — it does not store
   any data locally."** If you don't see that line, the install
   failed somewhere — re-run and read the `[FAIL]` message.

### Day-to-day use
- Double-click the desktop shortcut. The launcher first hits the hub
  on `/api/healthz` and:
  - **If reachable** — opens the dashboard in a kiosk-style browser
    window (Edge `--app=` mode, falls back to Chrome, then to the
    default browser).
  - **If unreachable** — pops a message saying "Cannot reach
    `<squadron>` hub at `<address>` — check the network or contact
    your Ops Pilot" and exits without showing a stuck loading
    spinner.
- Login is the user's normal Hawk Eye username + password — same
  accounts the host PC serves to every other dashboard. Create them
  on the host via **Admin → Users** as you would for any new user.

### Re-point a viewer at a different hub
When a laptop is reassigned (e.g. Tigers → Eagles):
1. On the commander's laptop, in PowerShell **as administrator**:
   ```
   .\scripts\lan-host\change-viewer-hub.ps1
   ```
   The script prints the current hub it is pointed at, then asks for
   the new one (or accepts `-HubAddress <new-hub.local>`). It
   re-validates the new hub, rewrites the dashboard env, rebuilds
   the local bundle, updates `.viewer-config.json`, and refreshes
   the existing desktop / Start Menu shortcuts.
2. Existing shortcuts keep working — no reinstall needed.

### Useful flags
- `setup-viewer.ps1 -PrebuiltDist <folder>` — copy a prebuilt
  `dist/public` instead of building locally (useful when the laptop
  has no Node.js or is air-gapped from npm). The prebuilt bundle
  **must** have been built with `VITE_INTERNAL_API_URL=http://<this
  hub>:<port>` — Vite bakes the hub URL into the JS, so a generic
  bundle would silently call the wrong hub. The script verifies the
  bundle contains the configured URL and refuses to install if not.
- `setup-viewer.ps1 -SkipBuild` — keep the existing
  `dist/public` as-is; only rewrite env, patch CSP, and refresh
  shortcuts. Same constraint as `-PrebuiltDist`: the existing bundle
  must already target the configured hub.
- `setup-viewer.ps1 -SquadronName "Tigers"` — labels the desktop
  shortcut "Hawk Eye — Tigers" and shows "Tigers hub" in the
  unreachable-hub message.
- `setup-viewer.ps1 -LocalPort 5500` — change the local launcher
  port if 5500 is already in use on the laptop.

If Bonjour `dns-sd.exe` is missing on the laptop, `-AutoDiscover`
warns and falls back to manual entry — install Bonjour Print
Services from Apple's site if you want auto-discovery.

---

## 3. Daily monitoring

There is nothing to do daily. The api-server runs as a scheduled task
and restarts on failure. The dashboard logs every action to the audit
log; commanders can review it under **Admin → Audit Log**.

Glance once a week:
- Task Scheduler → "Hawk Eye API Server" → still Running?
- Task Scheduler → "Hawk Eye Backup" → last run succeeded?

---

## 4. Backups

Automatic: the nightly backup task runs at **02:30** local time and
writes a `.dump` file under
`<repo>\artifacts\api-server\backups\hawk-eye-lan-YYYYMMDD-HHMMSS.dump`.
Files older than 14 days are pruned automatically. To put backups
somewhere else, re-run `install-backup-task.ps1` (it overwrites the
task) and pass `-RunAt "HH:mm"`; to change the directory, pass
`-BackupDir` to `backup-postgres.ps1` or wrap it in your own scheduled
task.

Manual on-demand (also writes under
`artifacts\api-server\backups\` by default):
```
.\scripts\lan-host\backup-postgres.ps1
```

Move the resulting `.dump` file to the USB stick once a week and store
it off-site. **A backup that lives only on the host PC is not a
backup** — if the host PC dies, it dies with it.

---

## 5. Restore from backup

On a fresh host PC (after re-installing Postgres and Node) — empty
database, no existing tables:
```
.\scripts\lan-host\restore-postgres.ps1 -BackupFile "D:\hawk-eye-lan-20260429-023000.dump"
```

If the database already has data (you are restoring on top of an
existing install), pass `-DropAndRecreate` so the restore wipes the
existing schema first:
```
.\scripts\lan-host\restore-postgres.ps1 -BackupFile "D:\hawk-eye-lan-20260429-023000.dump" -DropAndRecreate
```

The script reads `DATABASE_URL` from your shell environment by default;
pass `-DatabaseUrl "postgresql://..."` to override it. The api-server
picks up the restored data on next boot.

---

## 6. Reset password / add user

Day-to-day account work is done from the dashboard, not from the host
PC scripts:

1. On any PC, sign in as **super-admin**.
2. Open **Admin → Users** in the sidebar.
3. From this page you can:
   - **Add User** — create a new ops officer or commander account
     (deputy / ops / commander_squadron / commander_wing /
     commander_base). Pick a squadron when prompted; the wing and
     base are filled in automatically from that choice.
   - **Edit** — change role or squadron scope, or use the
     "Reset password" field to set a new password (minimum 8
     characters). Tell the user to sign in with the new password and
     then go to **Settings → Change Password** to pick a personal one.
   - **Disable / Enable** — soft-disable an account without losing
     its history. A disabled user cannot sign in and any in-flight
     session is dropped on its next request. The page refuses to
     disable the last super-admin so you can never lock the host out.
   - **Delete** — permanently remove the account. Use this only when
     the person is leaving and you do not want their username sitting
     around.

All four actions write through the LAN api-server, hash passwords
before storage, and add an audit log row under your username.

Fallback for total lock-out (e.g. the only super-admin password is
lost and no other super-admin exists), run on the **host PC** —
export the database URL once per shell, then run the reset:
```
$env:DATABASE_URL = "postgresql://postgres:<pg-pw>@127.0.0.1:5432/hawkeye_internal"
.\scripts\lan-host\reset-admin-password.ps1 -Username "superadmin"
```

(or pass `-DatabaseUrl "postgresql://..."` directly to the script).
Without one of those the script aborts with `DATABASE_URL not set`.
You can read the same URL out of `artifacts\api-server\.env`.

You will be prompted for the new password twice. The new password is
hashed (never stored as plain text) and written directly to the
`lan_users` table; an audit log row is added under
`actor='host_script'`. Use this only when the in-app page is
unreachable — it bypasses the audit chain that the **Admin → Users**
page provides.

---

## 7. Push an updated build via USB

Hawk Eye has auto-update **disabled** by default — that is the safe
choice for a private LAN install.

To apply a new release:
1. Receive the new `Hawk Eye Setup x.y.z.exe` on a USB stick.
2. On each dashboard PC: close Hawk Eye, run the new installer
   (it overwrites the previous install in place; no settings are
   lost), launch.
3. The title bar shows the new version + git short hash. Confirm it
   matches what you were given.

If the host-side api-server source needs to change (rare):
1. Stop the "Hawk Eye API Server" scheduled task.
2. Replace the source folder on the host PC with the new copy.
3. From the source folder, in an elevated PowerShell:
   ```
   pnpm install
   ```
4. Restart the scheduled task. Watch the log under
   `scripts\lan-host\first-time-setup.log` (or the api-server's stdout)
   for the "Server listening" line.

---

## 8. Troubleshooting

First, on the host PC, run the two diagnostic scripts. Together they
cover ~80% of first-run failures:

```
pnpm lan:host:preflight   # checks .env, pnpm/pg_dump on PATH, port 3847 free
pnpm lan:host:health      # hits http://127.0.0.1:3847/api/healthz
```

| Symptom | Try this |
| --- | --- |
| Dashboard says "Cannot reach API server" | `ping hawk-host.local` from the dashboard PC. If it fails, the host PC is offline, mDNS is blocked on the LAN, or the LAN path is broken. Run `pnpm lan:host:health` on the host to confirm the api-server itself is alive. |
| Commander laptop pops "Cannot reach `<squadron>` hub at `<address>`" | The viewer launcher pre-checked `/api/healthz` and got nothing. `ping <address>` from the laptop. If the host is up but the laptop moved squadrons, run `change-viewer-hub.ps1` on the laptop to re-point it. |
| `setup-viewer.ps1` refuses with "installProfile='viewer' (expected 'hub')" | You pointed the viewer at another viewer / aggregator PC by mistake. Re-run with the **squadron host PC's** address (the one running Postgres + api-server). |
| Viewer launcher says "local launcher port busy" | Something else on the laptop is using port 5500. Re-run `setup-viewer.ps1 -LocalPort <free-port>`, or pass `-LocalPort` to `launch-viewer.ps1` for a one-off. |
| Sign-in keeps failing | Check the audit log on the host PC's Postgres for `lan_login_failed` rows. Ask user to wait 5 minutes (rate limit) and try again. If the user account was disabled, sign in as super-admin and re-enable it from **Admin → Users**. |
| Sign-in returns "lan_user_disabled" | The account is soft-disabled. Sign in as super-admin and toggle it back to **Active** from **Admin → Users**. |
| All sign-ins fail and we just rebuilt the host | Run `reset-admin-password.ps1` for the super-admin on the host PC, then sign in and use **Admin → Users** to reset everything else. |
| Dashboard title bar shows "v? · nogit" | The build was made from a tarball without `.git`. Functionally fine; cosmetic. |
| Auto-update toggled on by accident | Set `RJAF_ENABLE_AUTO_UPDATE=0` (or unset it) in the dashboard launch environment. The Settings → Auto-Update toggle in the app also controls this per-role. |
| Audit log row shows `actor: unknown` | Someone made a write while the api-server was in `HAWK_LAN_DEV_NO_AUTH=1` mode. Flip it back to `0` immediately. |

---

## 9. What to escalate

Contact the developer (with logs) only when:
- The api-server crashes on boot and `first-time-setup.log` shows a
  schema error — you may have an unsupported Postgres version.
- The dashboard refuses to launch with a `webSecurity` or
  `electron-updater` error in the renderer log — there is a packaging
  defect.
- An audit log search reveals writes you cannot account for, especially
  any with `actor_unknown:true` outside an expected dev-no-auth window.

Everything else is recoverable with the scripts in this folder.
