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
   To also broadcast this hub on the LAN as `_hawkeye-hub._tcp` so an
   aggregator install wizard can suggest it automatically, append
   `-EnableMdns` (off by default — leave it off on sites that block
   multicast):
   ```
   .\scripts\lan-host\first-time-setup.ps1 -EnableMdns
   ```
6. Answer the prompts:
   - **Squadron name** — a short, friendly name for this hub PC such
     as `tigers-hub` or `eagles-hub` (1-15 chars, letters / digits /
     hyphen, no leading or trailing hyphen, not all digits). This
     becomes the Windows computer name, so the PC is reachable on the
     LAN as `<name>.local`. If the name changes the script queues a
     **rename + reboot** — finish the script first, then run
     `shutdown /r /t 0`.
   - Postgres superuser password (the one from step 1).
   - First super-admin username.
   - First super-admin password (8+ characters).
7. The script writes both `.env.production` files (including
   `SQUADRON_NAME`), creates the database, lays out every Hawk Eye
   table, mints the super-admin, and registers two scheduled tasks:
   one to start the api-server on boot
   (`HawkEye-ApiServer-OnStartup`), and one to back up the database
   every night at 02:30 (`HawkEye-Postgres-Backup-Daily`). When
   `-EnableMdns` was passed, a third task
   (`HawkEye-Mdns-OnStartup`) keeps the Bonjour broadcast alive
   across reboots.
8. Note the **bootstrap token** the script prints. Store it somewhere
   safe — it is only used once, the first time you sign in remotely.
9. Note the **initial peer access token** the script prints in a green
   banner near the end. It looks like `phk_<uuid>_<hex>`. Copy it
   immediately — it is shown **once**. The Wing Commander PC operator
   will paste it when adding this squadron. A copy is also saved to
   `%PROGRAMDATA%\HawkEye\peer-token-initial.txt` (readable only by
   local Administrators) in case it scrolls off-screen. Lost it?
   See section 6 — `reset-peer-token.ps1` mints a fresh one any time.

The host PC is now ready. Reboot it once (mandatory if the squadron
name changed the computer name) and confirm the api-server comes back
up automatically (check Task Scheduler → "Hawk Eye API Server" →
status: Running).

---

## 1b. First-time install on a Wing/Base Commander PC

A **Wing Commander PC** rolls up several squadrons' data. A **Base
Commander PC** rolls up several wings' data. Both are *aggregator*
PCs — they have their own Postgres + api-server, but they pull
squadron data from the squadron host PCs over the LAN. They do **not**
own any squadron's data of their own.

Before you start, on each squadron's host PC:
- Confirm `first-time-setup.ps1` was run with `-EnableMdns` so this
  PC will see it on the LAN. (If not, you can still add it by hand —
  see step 6 below.)
- Have the squadron's **peer access token** ready. It was printed in a
  green banner at the end of squadron's `first-time-setup.ps1`, and a
  copy is in `%PROGRAMDATA%\HawkEye\peer-token-initial.txt` on that
  hub PC (Local Administrators only). Lost it? Run
  `reset-peer-token.ps1` on the hub to mint a fresh one.

Steps:

1. Install Postgres 14 or newer on the Wing/Base PC. Pick a strong
   password for the `postgres` superuser. Write it down.
2. Install Node.js 20 or newer on the Wing/Base PC.
3. (Optional but recommended) Install Apple Bonjour Print Services for
   Windows from <https://support.apple.com/kb/dl999>. This adds
   `dns-sd.exe`, which the wizard uses to auto-detect squadron hubs.
   Without it, the wizard falls back to manual entry.
4. Copy the Hawk Eye source folder onto the Wing/Base PC (USB or LAN
   copy).
5. Open PowerShell **as administrator** in the source folder.
6. Run:
   ```
   pnpm install
   .\scripts\lan-host\aggregator-first-time-setup.ps1
   ```
   The wizard will:
   - Ask whether this is a `wing` or `base` PC.
   - Ask for a short hostname (`wing-cmd-pc`, `base-cmd-pc`, …) and
     queue a Windows rename if the current name doesn't match. **A
     reboot is mandatory after the script finishes if the rename
     happened.**
   - Auto-install Postgres via `winget` if it isn't already present.
   - Create the local `hawkeye_aggregator` database, write
     `artifacts/api-server/.env` with `INSTALL_PROFILE=aggregator-wing`
     (or `aggregator-base`), build the api-server, and lay out every
     table this PC needs.
   - Mint the first super-admin account on this Wing/Base PC.
   - **Auto-discover squadron hubs** by browsing `_hawkeye-hub._tcp`
     on the LAN. Detected squadrons appear in a numbered picker
     showing the squadron name and the resolved `<host>:<port>`. Pick
     them by number (or type `a` to add all), and for each one paste
     that squadron's **peer access token** when prompted. The wizard
     validates the hub responds with `installProfile=hub` before
     adding it, then stores the entry in `peer_squadrons` (visible
     later in the dashboard's address book).
   - **Manual fallback:** when discovery is finished, the wizard asks
     "Add another squadron by hand?" — answer `y` for any squadron
     whose LAN blocks multicast or whose hub didn't opt in to mDNS.
     Type the squadron handle, the hostname (`tigers-hub.local`),
     port (default 3847), and the peer token. Same validation runs.
   - Register two scheduled tasks: one to start the api-server on
     boot (`HawkEye-ApiServer-OnStartup`), and one to back up the
     database every night at 02:30 (`HawkEye-Postgres-Backup-Daily`).
7. Note the **bootstrap token** the script prints. It's only used
   once for first sign-in if you ever need to recover the super-admin.
8. The aggregator dashboard is just the regular Hawk Eye `.exe` aimed
   at this Wing/Base PC instead of a squadron hub. Install it on
   each commander's workstation the same way as section 2 below; the
   address book is reachable in the dashboard under
   **Admin → Squadrons (peers)**.

To **add or rotate squadrons later** (e.g. a new squadron joins, or a
peer token was rotated), you have two options:
- Re-run `aggregator-first-time-setup.ps1` — the database / env / build
  steps are idempotent, and the discovery + manual-entry steps will
  add new peers (existing ones return "peer already exists" and are
  left alone).
- Or call the API directly: `POST /api/aggregate/peers` adds an entry,
  `PATCH /api/aggregate/peers/:id` swaps the token, and `DELETE
  /api/aggregate/peers/:id` removes one. All three are super-admin
  only and recorded in `audit_log`.

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

## 2a. Install a Wing or Base Commander PC (aggregator)

A Wing Commander or Base Commander PC is an **aggregator**. It runs
the api-server in `aggregator-wing` or `aggregator-base` mode. That
mode does **not** host squadron data of its own; instead it fans out
reads to one or more squadron hub PCs and aggregates the responses
into a single dashboard for the wing/base view.

A small local Postgres database is still installed — it stores the
local super_admin, the squadron-hub address book, the audit log, and
a per-peer response cache. No squadron sortie/pilot data is ever
written here.

### Install

On the new aggregator PC, with Node.js 20+ and the Hawk Eye source
folder copied across (USB or LAN):

1. Open PowerShell **as administrator** in the source folder.
2. Run:
   ```
   pnpm install
   .\scripts\lan-host\setup-aggregator.ps1
   ```
   The script prompts in order for:
   - **PC role** — `wing` or `base`. Determines the install profile
     (`aggregator-wing` vs `aggregator-base`) recorded in
     `install_profile_meta` on first boot.
   - **Local super_admin username + password** — the operator who
     will manage the squadron-hub address book on this PC. Stored
     hashed (bcrypt) in `lan_users` like every other Hawk Eye user.
   - **Squadron hubs** — for each hub: display name (e.g. "Tigers"),
     hostname or IP (e.g. `tigers-hub.local`), and the peer access
     token from that hub's **Admin → Peer Tokens** page. The script
     loops until you say "done".
   - **Postgres superuser password** — used once to create the local
     database and run the schema bootstrap.
3. Optional auto-discover — re-run with `-AutoDiscover` to scan the
   LAN for `_hawkeye-hub._tcp` first; the script lists every hub it
   sees and asks Y/N for each one before falling through to manual
   entry. Requires Bonjour Print Services for Windows (`dns-sd.exe`).
4. The script writes:
   - `artifacts\api-server\.env` with `INSTALL_PROFILE=
     aggregator-<role>`, `DATABASE_URL`, `PORT`, a fresh bootstrap
     token, and `HAWK_INTERNAL_SESSION_AUTH=required`.
   - `artifacts\pilot-dashboard\.env.production.local` with
     `VITE_INTERNAL_API_URL` pointing at this PC's local aggregator
     (so the dashboard talks to its own api-server).
5. The script then:
   - Builds the api-server, boots it briefly to run
     `ensureFullSchema()` (creates `peer_squadrons`, `peer_cache`,
     `install_profile_meta`, `lan_users`, etc.).
   - Mints the local super_admin (single transaction; bcrypt-hashed).
   - Seeds `peer_squadrons` from the hubs you entered (single
     transaction — a partial failure leaves nothing committed; same
     for the audit log entries).
   - Builds the dashboard once.
   - Registers two scheduled tasks so both auto-start on boot:
     `HawkEye-ApiServer-OnStartup` and `HawkEye-Dashboard-OnStartup`.
6. The output ends with a self-check that hits
   `/api/aggregate/peers/health` on the local api-server. A `200`
   confirms the route is mounted with the configured peer count;
   a `401`/`403` is also a healthy outcome — it means the route is
   mounted correctly and just needs a signed-in super_admin to read
   the body. Anything else gets a clear `[FAIL]` line.

### Add a squadron later

When a new squadron stands up after the initial install, do **not**
re-run `setup-aggregator.ps1`. Use the lighter helper instead — same
validation, same audit log entry:

```
.\scripts\lan-host\add-squadron-peer.ps1 `
    -DisplayName "Eagles" `
    -Address "eagles-hub.local" `
    -Token   "<paste-from-hub>"
```

Without arguments the script prompts interactively. It picks up
`DATABASE_URL` from `artifacts\api-server\.env` automatically.

The address book is also editable via the dashboard later (super_admin
only) under **Admin → Address Book** — that path uses the same
`/api/aggregate/peers` API the script writes to.

### Useful flags

- `setup-aggregator.ps1 -Role wing` — skip the role prompt.
- `setup-aggregator.ps1 -AutoDiscover` — scan the LAN first.
- `setup-aggregator.ps1 -SkipDashboardBuild -SkipApiBuild` — useful
  on a re-run when the bundles are already up to date.
- `setup-aggregator.ps1 -SkipScheduledTasks` — install env + DB
  only, don't touch Windows Task Scheduler. Pair with
  `pnpm lan:host:install-startup-task` and
  `pnpm lan:aggregator:install-dashboard-task` to register the
  tasks later.
- `add-squadron-peer.ps1 -SquadronId tigers-east` — override the
  auto-slug if the default collides with an existing entry.

### Day-to-day

- The api-server scheduled task starts on boot and serves
  `/api/aggregate/*` to anything on the LAN that authenticates as
  the local super_admin.
- The dashboard scheduled task starts on boot and serves the
  built bundle on the configured local port (default 5173). Open it
  in the browser of your choice on the same PC; sign in with the
  local super_admin.
- A separate dashboard task adds the squadron status panel (online /
  offline indicator per peer) — until that ships, you can self-check
  reachability with:
  ```
  Invoke-WebRequest -UseBasicParsing http://127.0.0.1:3847/api/aggregate/peers/health
  ```

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

### Re-issue a peer access token

The peer access token is what the Wing Commander PC sends to read this
hub's data. The first one is printed by `first-time-setup.ps1` and
saved to `%PROGRAMDATA%\HawkEye\peer-token-initial.txt`. To mint a
fresh one (lost token, suspected leak, or routine rotation), on the
host PC, with the api-server running:

```
.\scripts\lan-host\reset-peer-token.ps1 -Username "superadmin"
```

You will be prompted for that super_admin's password. The script logs
in over HTTP, calls `POST /api/internal/peer-tokens`, prints the new
plain token in a green banner (shown **once**), and rewrites
`%PROGRAMDATA%\HawkEye\peer-token-initial.txt`. Earlier tokens stay
valid until you revoke them — sign in as super_admin and remove them
from the dashboard, or `DELETE /api/internal/peer-tokens/<id>`.

If the api-server is not running, start it first:
```
schtasks /Run /TN HawkEye-ApiServer-OnStartup
```

### Turn the LAN broadcast on or off later

If you skipped `-EnableMdns` during first-time setup but later want
this hub to be auto-discovered by an aggregator install wizard:

```
.\scripts\lan-host\register-mdns.ps1 -SquadronName "tigers-hub" -ApiPort 3847
```

To stop broadcasting:
```
.\scripts\lan-host\register-mdns.ps1 -SquadronName "tigers-hub" -Unregister
```

This requires `dns-sd.exe` (ships with Apple Bonjour Print Services).
On a stripped-down PC the script warns and exits cleanly so you can
install Bonjour and re-run.

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
| Wing Commander PC asks for the squadron's peer token and we don't have it | The initial token is in `%PROGRAMDATA%\HawkEye\peer-token-initial.txt` on the host (Local Administrators only). If that file is gone, mint a fresh one with `reset-peer-token.ps1 -Username "<super_admin>"` — it overwrites the file and prints the new token in a green banner. |
| Aggregator wizard cannot see this hub on the LAN | mDNS may be off. Re-run `register-mdns.ps1 -SquadronName "<name>" -ApiPort 3847` on the host. If `dns-sd.exe` is missing, install Apple Bonjour Print Services and re-run. Either way, the operator can still type `<squadron>.local` by hand. |
| Dashboard title bar shows "v? · nogit" | The build was made from a tarball without `.git`. Functionally fine; cosmetic. |
| Auto-update toggled on by accident | Set `RJAF_ENABLE_AUTO_UPDATE=0` (or unset it) in the dashboard launch environment. The Settings → Auto-Update toggle in the app also controls this per-role. |
| Audit log row shows `actor: unknown` | Someone made a write while the api-server was in `HAWK_LAN_DEV_NO_AUTH=1` mode. Flip it back to `0` immediately. |
| `setup-aggregator.ps1` reports "Failed to seed peer_squadrons (transaction rolled back)" | One of the hubs you entered has the same auto-slug as another (the address book has a unique index on `squadron_id` per active row). Re-run with distinct display names, or run `add-squadron-peer.ps1 -SquadronId <unique>` to add the duplicate after the install completes. |
| Aggregator dashboard shows an empty squadron list | Run `Invoke-WebRequest http://127.0.0.1:3847/api/aggregate/peers/health` on the aggregator PC. Empty `peers` means nothing was seeded — re-run `setup-aggregator.ps1` (it's idempotent) or use `add-squadron-peer.ps1`. |
| Want to confirm this PC's install profile | Hit `http://127.0.0.1:3847/api/healthz`. The `installProfile` field is `hub`, `aggregator-wing`, or `aggregator-base`. The first-boot value is canonical and pinned in `install_profile_meta`. |

---

## 9. Quarterly operator checklist

Hawk Eye is built to run unattended for ~15 years on the squadron LAN.
A short quarterly walk-through (≈10 minutes per host PC) is the only
maintenance the operator owes the system. Every step below is also
surfaced on the **Admin → System Health** page in the dashboard, so the
operator can do most of this without opening PowerShell.

Schedule: **15 January, 15 April, 15 July, 15 October.** (Same day the
backup-verify Scheduled Task fires automatically.)

1. **Open the System Health page** — sign in as super-admin and visit
   **Admin → System Health**. Every tile should be green. Yellow tiles
   include the operator action right in the message; red tiles must be
   resolved immediately (writes are blocked when the disk tile turns
   red). The page refreshes every 30 seconds.
2. **Check the disk** — the *disk* tile must read >20% free. If it is
   yellow, archive old `.dump` files in
   `artifacts/api-server/backups/` to a USB stick and delete them from
   the host PC; the rest of the data lives in Postgres and does not
   prune itself.
3. **Confirm the nightly backup ran** — the *last_backup* tile should
   read "<24h ago". If it is yellow/red, run
   `pnpm lan:host:backup` once by hand to confirm the script still
   works, then re-install the Scheduled Task with
   `pnpm lan:host:install-backup-task`.
4. **Confirm the quarterly verify ran** — the *last_backup_verify*
   tile should read "<120 days ago". If older, run
   `pnpm lan:host:verify-backup` once by hand and re-install the
   quarterly task with `pnpm lan:host:install-verify-backup-task`.
5. **Check peer reachability (aggregator PCs only)** — the *peers*
   tile lists every squadron hub. Any offline peer is also listed in
   the address book on **Admin → Squadrons**; ping the listed
   hostname from the aggregator PC. If a peer reports a clock skew
   over 5 minutes, fix that PC's system clock (right-click the
   taskbar clock → *Adjust date/time*).
6. **Glance at the audit log** — the *audit_log* tile shows row count
   and on-disk size. The table is append-only and is fine to grow
   (the composite index keeps reads fast even at 10M+ rows). Open
   **Admin → Audit Log** and confirm there are no recent
   `actor: unknown` rows from outside an expected
   `HAWK_LAN_DEV_NO_AUTH=1` bring-up window.
7. **Note the schema/install-profile drift** — the
   *install_profile* tile reports the originally-installed profile
   pinned in `install_profile_meta`. If it disagrees with the
   currently-running profile, escalate to the developer; the
   first-boot value is canonical.

If every tile is green, you are done — write the date in the host PC's
log book and move on. The host PC needs no further attention until
next quarter.

### Scheduled tasks installed by the runbook

| Task | Cadence | Installed by |
| --- | --- | --- |
| `HawkEye-Postgres-Backup-Daily` | 02:30 every day | `pnpm lan:host:install-backup-task` |
| `HawkEye-Backup-Verify-Quarterly` | 03:30 on the 15th of Jan/Apr/Jul/Oct | `pnpm lan:host:install-verify-backup-task` |

Both tasks run as `SYSTEM`, read `DATABASE_URL` from
`artifacts\api-server\.env`, and write nothing to the public internet.

---

## 10. What to escalate

Contact the developer (with logs) only when:
- The api-server crashes on boot and `first-time-setup.log` shows a
  schema error — you may have an unsupported Postgres version.
- The dashboard refuses to launch with a `webSecurity` or
  `electron-updater` error in the renderer log — there is a packaging
  defect.
- An audit log search reveals writes you cannot account for, especially
  any with `actor_unknown:true` outside an expected dev-no-auth window.

Everything else is recoverable with the scripts in this folder.
