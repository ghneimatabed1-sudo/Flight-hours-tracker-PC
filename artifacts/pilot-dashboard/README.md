# Hawk Eye — Desktop App

> For the master engineering handoff (today's live state, every migration /
> RPC / edge function / cron job, source-tree index, known-broken list,
> release process), see `HANDOFF.md` at the repo root. This README is the
> per-artifact developer quickstart.

A bilingual (English / العربية) Windows desktop application for the squadron
ops officer to manage all flight data — pilot roster, sortie log, currencies,
risk assessments, duty week, NOTAMs, and more. Built with Electron + React +
TypeScript on top of Vite. Designed to replace the legacy SqDn App 21.10.16.

## Two ways to run it

| Mode | What you see | How |
|---|---|---|
| **Web preview** (development on Replit) | The full UI in your browser | `pnpm --filter @workspace/pilot-dashboard run dev` |
| **Windows .exe** (production for ops officers) | A native desktop app | See `ELECTRON_BUILD.md` |

The same React code runs in both modes — only the shell changes.

## Security architecture (implemented + scaffolded)

> ⚠️ **The "License key required" bullet below is SUPERSEDED — see
> `HANDOFF.md` §10 and §11.D.** The `license_keys` table was dropped by
> migration 0081 and bootstrap is now the multi-PC join flow
> (`unit-super-admin-setup` for the first PC of a fresh unit, then
> `device-requests` Join → Approve → Bind for every additional PC).
> Three legacy edge functions (`register-license`, `validate-license`,
> `provision-commander`) are still deployed but reference dropped tables
> and will error if invoked — flagged for cleanup in §11.D / task #316.

- **Installer is password-protected** — NSIS macro in `build/installer.nsh`
  prompts for a master install password supplied at build time via the
  `INSTALL_PASSWORD` env var.
- **License key required** — _LEGACY, no longer in effect_. First launch
  now shows the join flow described in HANDOFF.md §10. The
  `license_keys` table no longer exists.
- **Hardware fingerprint** — derived from CPUs + MAC addresses + hostname
  in the Electron main process and exposed to the renderer through a secure
  preload bridge.
- **Failed-login lockout** — 5 wrong passwords lock the account for 5
  minutes (see `src/lib/auth.tsx`).
- **Audit log** — every login, sortie entry, edit shows in the Audit Log
  page with user + timestamp + fingerprint.
- **TLS in transit + Supabase encryption at rest** — Supabase URL is read
  from environment secrets, never hard-coded.
- **Row Level Security sketch** — see `ELECTRON_BUILD.md` for the SQL.
- **Auto-update** — `electron-updater` configured against a generic update
  channel; new installer rolled silently on launch.
- **Offline mode** — preload exposes a writable queue path; failed
  mutations get queued and replayed when back online.

## Screens
Dashboard · Squadron Sortie Log · Add Sortie · Pilot Roster · Pilot Detail ·
Currency Views (Day / Night / IRT / Medical / Sim) · Expired After Report ·
Rankings & Totals · 6-Month Cycle · Leaves · Unavailable Pilots · Duty Week ·
Flight Schedule · Risk Assessment (Day / NVG with auto-score) · Coordinating
Form (Arabic) · NOTAMs · Nav Routes · Pilot Unit Manager · PDF Exports ·
User Manager · Audit Log · Settings.

## Localization
Toggle EN / العربية in the top bar or on the login screen. The whole UI
flips to RTL when Arabic is active, including the sidebar and tables.

## Theming
Military dark theme — deep navy background with gold/amber accents and
color-coded statuses (green / amber / red). NVG is rendered in red across
the app to match the legacy convention.

## Where the data lives
- **Demo / Replit preview:** mock data in `src/lib/mock.ts` (16 pilots, 80
  sorties, NOTAMs, duty roster).
- **Production:** Supabase Postgres at `fxlqmigioerimyrbszcz.supabase.co`.
  Wire the real client by replacing the body of the helpers in
  `src/lib/auth.tsx` and adding a `src/lib/supabase.ts` that reads
  `import.meta.env.VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`. RLS on
  the server enforces squadron isolation.

## Brand assets
- `public/brand/emblem.png` — RJAF eagle emblem
- `public/brand/wings.png` — Pilot wings

## Build the Windows installer
See [`ELECTRON_BUILD.md`](./ELECTRON_BUILD.md).
