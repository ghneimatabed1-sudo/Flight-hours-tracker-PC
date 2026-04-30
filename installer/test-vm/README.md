# Real-Windows VM dry-run playbook

This folder is for the next operator who has access to actual
Windows hardware (or a real Windows VM with PowerShell 5.1+).

The Replit container that built Hawk Eye is Linux-only, so the
PowerShell installers in `scripts/lan-host/` cannot be executed
end-to-end here. The bug fixes in commit accompanying this file
were derived from a static code review only — see
`dryrun-evidence/2026-04-30/STATIC-REVIEW.md`.

When you actually run the install on bare metal, please follow
the steps below and drop screenshots + logs into a new dated
folder under `dryrun-evidence/`.

---

## Prerequisites on the test machine

- Windows 10 22H2 or Windows 11 23H2 (clean snapshot strongly
  recommended — the installer makes machine-wide changes:
  hostname, scheduled tasks, firewall rules, postgres role,
  netsh URL ACLs).
- 8 GB RAM minimum, 30 GB free disk.
- Local administrator account.
- No prior PostgreSQL install (the installer probes for it but a
  pre-existing install hides class-of-bugs we need to catch).

Take a VM snapshot named `pre-install` before each role.

## Roles to dry-run (run each on its own snapshot)

1. **Squadron Lan Host** — `scripts/lan-host/first-time-setup.ps1`
2. **Aggregator Hub** — `scripts/lan-host/setup-aggregator.ps1`
3. **Viewer / Kiosk PC** — `scripts/lan-host/setup-viewer.ps1`
4. **Add-peer flow** — `scripts/lan-host/add-squadron-peer.ps1`
   (run this ON the aggregator after role 2)

For each role: revert to `pre-install`, run the installer in an
elevated PowerShell, capture the full transcript, then reboot
once and verify the auto-start tasks fire.

## What to capture per role

Drop these files into `dryrun-evidence/<YYYY-MM-DD>/<role>/`:

- `transcript.txt` — `Start-Transcript` output of the install run.
- `01-first-boot.png` — Desktop + Task Scheduler view after the
  fresh-snapshot reboot, showing `HawkEye-ApiServer-OnStartup`
  in `Ready` state.
- `02-healthz.png` — Browser at `http://127.0.0.1:3847/api/healthz`
  returning 200.
- `03-dashboard.png` — Dashboard rendering at the LAN host name.
- `04-task-history.png` — Task Scheduler → History tab for the
  startup task, proving SYSTEM context launched node successfully.
- `schtasks.txt` — `schtasks /Query /FO LIST /V /TN HawkEye-*`
- `netstat.txt` — `netstat -ano | findstr LISTENING`
- `eventvwr-app.evtx` — Application event log export from the
  install hour (catches Postgres / scheduled task errors the
  console misses).

## Specific things the static review could not verify — please
exercise these explicitly

1. **postgres password with reserved chars.** When prompted,
   type a password that contains `@`, `:`, `#` and `%` (for
   example: `Re@l:Pa#s%word!`). Confirm the api-server connects
   on first boot. Pre-fix this would silently produce
   `password authentication failed`.
2. **Scheduled task in SYSTEM context.** After install, reboot
   and confirm the api-server is reachable on `:3847` BEFORE you
   log in. (RDP into the box without logging in to the console
   user, if possible.) The Step 10 verifier in the installer now
   triggers this at install time, but a real boot is the truth.
3. **Viewer URL ACL.** Log in as a non-admin user on the viewer
   PC and double-click the desktop shortcut. Pre-fix this
   crashed with HRESULT 5; the installer now reserves the ACL
   for `BUILTIN\Users` in Step 5b. If it still fails, capture
   the popup.
4. **Aggregator dashboard CSP.** Open the dashboard in Chrome,
   open DevTools → Console, and confirm there are no
   `Refused to connect because it violates the following
   Content Security Policy directive: "connect-src ..."`
   warnings pointing at the aggregator host name.
5. **Add-peer with reserved-char password.** If the aggregator
   was set up without a stored DATABASE_URL, the add-peer
   wizard prompts for the postgres password. Type one with `@`
   and `#`. Confirm the peer row lands in `peer_squadrons`.
6. **mDNS broadcast survival.** `dns-sd.exe` in the foreground
   task does not auto-restart on death (known limitation, NOT
   fixed in this pass). Kill the `dns-sd.exe` process, wait 5
   minutes, confirm peers stop seeing this host on the LAN.
   Document that a watchdog wrapper is the next improvement.

## Known PowerShell 5.1 quirks worth eyeballing

- `schtasks /TR` quoting: confirm the registered command in the
  Task Scheduler GUI shows `powershell.exe -File "C:\...\start-api-host.ps1"`
  with quotes intact even when the path has a space.
- `Read-Host -AsSecureString` masks input differently in Windows
  Terminal vs `conhost.exe`. Try both.
- `Out-File -Encoding ASCII` (used for `.env`) writes CRLF on
  Windows. node reads this fine, but verify no BOM crept in.

## After the dry-run

1. Fill out `dryrun-evidence/<date>/SUMMARY.md` with one section
   per role: `PASSED`, `PASSED-WITH-NOTES`, or `FAILED-NEEDS-CODE-FIX`.
2. For each `FAILED-NEEDS-CODE-FIX`, open a follow-up task with
   the transcript line numbers + screenshot.
3. Append a short note to `OPERATOR-RUNBOOK.md` Appendix
   "Visual install walkthrough" linking the screenshots so the
   field operators have a known-good reference.
