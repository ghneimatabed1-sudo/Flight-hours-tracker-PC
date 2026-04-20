# Overview

This project is a pnpm workspace monorepo using TypeScript, designed to build a comprehensive flight hours management system for the Royal Jordanian Air Force (RJAF). The product is branded **"Hawk Eye"** (Arabic: عين الصقر) across the dashboard, mobile app, PDF headers, and packaged installers. It includes a web-based command dashboard ("Hawk Eye HQ") for super administrators and commanders, and a mobile application for pilots.

The system aims to provide:
- **Centralized Administration:** Super admin panel for system overview, license key management, commander accounts, squadron control, and audit logging.
- **Operational Oversight:** Commander dashboard for multi-squadron overview, pilot tracking, and alerts.
- **Pilot Management:** Detailed pilot profiles, currency tracking, and sortie logging.
- **Data Archiving:** Local, periodic archiving of operational data for historical analysis and backup.
- **Secure Access:** Role-based access control, TOTP for super admin, and license key binding to hardware and user.
- **Multilingual Support:** Full English and Arabic (RTL) localization.

The business vision is to modernize RJAF's flight operations management, improve data accuracy, enhance decision-making through real-time insights, and streamline administrative tasks.

# Brand Assets

The Hawk Eye / RJAF Squadron Ops brand assets live in `artifacts/pilot-dashboard/public/brand/`:
- `hawkeye-logo.png` — 1024×1024 master logo (source for icons).
- `hawkeye-logo.svg` — vector logo.
- `hawkeye-wordmark.png` / `.svg` — wordmark.
- `emblem.png` — RJAF emblem (286×326).
- `wings.png` — pilot wings graphic.

Windows installer/EXE icon: `artifacts/pilot-dashboard/build/icon.ico` — multi-resolution (16/24/32/48/64/128/256), generated from `hawkeye-logo.png` via ImageMagick. Referenced in `electron-builder.json` as `win.icon`, `nsis.installerIcon`, `nsis.uninstallerIcon`, and `nsis.installerHeaderIcon`. Regenerate with:
```
magick public/brand/hawkeye-logo.png -background none \
  \( -clone 0 -resize 16x16 \) \( -clone 0 -resize 24x24 \) \
  \( -clone 0 -resize 32x32 \) \( -clone 0 -resize 48x48 \) \
  \( -clone 0 -resize 64x64 \) \( -clone 0 -resize 128x128 \) \
  \( -clone 0 -resize 256x256 \) -delete 0 build/icon.ico
```

# User Preferences

- **Communication Style:** All updates and changes should be clearly documented and explained.
- **Workflow:** Prioritize iterative development.
- **Interaction:** Ask before making major architectural changes or significant modifications to existing features.
- **Data Preservation:** Updates must be additive. Existing pilots, logs, monthly summaries, ops officer accounts, license keys, squadron attachments, and admin settings MUST survive every release. Breaking changes (field renames, removals, storage key changes) require explicit user sign-off before shipping. LocalStorage keys should remain stable across releases. New schema fields must be optional and default to a sensible empty value.
- **Code Changes:** Pre-existing TypeScript errors should remain untouched unless directly related to the current task.

# System Architecture

The system is built as a pnpm workspace monorepo.

**Core Technologies:**
- **Node.js:** v24
- **TypeScript:** v5.9
- **Package Manager:** pnpm
- **API Framework:** Express 5
- **Database:** PostgreSQL with Drizzle ORM
- **Validation:** Zod (`zod/v4`), `drizzle-zod`
- **API Codegen:** Orval (from OpenAPI spec)
- **Build Tool:** esbuild (CJS bundle)

**Monorepo Structure:**
- Each package in the monorepo manages its own dependencies.
- `pnpm-workspace` skill is used for workspace structure, TypeScript setup, and package details.

**UI/UX and Features:**
- **`pilot-dashboard` (Web):**
    - **Super Admin Panel (`/admin/*`):** System overview, license key generation/revocation, commander account management, squadron enable/disable, audit log.
    - **Commander Dashboard (`/dashboard/*`):** Read-only multi-squadron overview, sortable/filterable pilot table, squadron drill-down, pilot detail, expiring/expired alerts.
    - **Authentication:** Mocked via localStorage with 30-min idle timeout and 5-attempt lockout. Super admin uses RFC 6238 TOTP. Ready for Supabase Auth integration.
    - **Internationalization:** Bilingual EN/AR with full RTL support.
    - **Pilot Currency Hiding:** UI to toggle visibility of specific pilot currencies, excluding them from alerts and displaying as "N/A".
    - **Historical Import Management:** `useUndoLastImport` hook allows undoing the last CSV import by tracking `rjaf.lastImportStamp`.
    - **XLSX Export:** PilotsTable includes functionality to export data to XLSX format.
    - **Loading/Error States:** Implemented for data fetching operations with spinners and error banners.
    - **Sortie Log Management:** Edit and delete functionality for sortie logs via modal dialogs and confirmation.
    - **Archiving:** Idempotent, client-side monthly and yearly data archiving stored in `localStorage`, with a dedicated `/archives` page for viewing and JSON downloads.
- **`pilot-mobile` (Mobile):** Expo app built for iOS/Android.

**Technical Implementations:**
- **Supabase Integration:**
    - `isLive()` function checks for `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to switch between live Supabase data and in-memory mock data.
    - Supabase schema and squadron-isolated Row Level Security (RLS) policies are defined in migrations.
    - Edge Functions handle specific logic (e.g., `validate-license`).
    - Seed scripts are used to populate demo data, including multiple squadrons and admin users with specific `app_metadata.squadron_id` claims for RLS.
- **License Key Management:**
    - License keys bind to both a hardware fingerprint (`lockedToDevice`) and an operator username (`assignedUsername`).
    - `expiresAt` field controls license validity duration.
    - Super admin interface allows generating keys with various durations and assigning usernames.
    - Client-side license registry (`src/lib/license-registry.ts`) mirrors issued keys.
    - Server-side validation via `validate-license` Edge Function enforces key uniqueness, expiry, device binding, and username binding.
    - Audit logs record `license.activate.ok` and `license.activate.failed` events with actor username.
- **Audit Logging:** System-wide audit logging for key actions (e.g., import, undo, sortie updates, license activation).
- **Data Preservation Policy:** Strict adherence to additive updates; existing data and localStorage keys must be stable. New schema fields must be optional.

# External Dependencies

- **Supabase:** Used for database (PostgreSQL), authentication (planned), and Edge Functions (for `validate-license`).
- **React Query:** For data fetching and state management in the web application.
- **`xlsx` package:** For XLSX export functionality.
- **Mobile Builds (unsigned IPA + APK):** GitHub Actions workflow `.github/workflows/mobile-unsigned-builds.yml` builds both platforms with zero Apple credentials or EAS account required.
  - **Method:** `expo prebuild` generates native projects → iOS uses `xcodebuild` with `CODE_SIGNING_ALLOWED=NO` → packaged into `PilotLogbook-unsigned.ipa` → downloadable from GitHub Actions artifacts. Android uses `gradlew assembleRelease`.
  - **Trigger:** Go to GitHub repo → Actions → "Hawk Eye — Unsigned Mobile Builds" → Run workflow (select branch `replit-latest`). OR trigger via API: `POST /repos/ghneimatabed1-sudo/Flight-hours-tracker-PC/actions/workflows/mobile-unsigned-builds.yml/dispatches` with `{"ref":"replit-latest"}` using `$GITHUB_PERSONAL_ACCESS_TOKEN`.
  - **Artifacts:** `HawkEye-ios-unsigned` (IPA, sideload via Sideloadly/AltStore) and `HawkEye-android` (APK, direct install). Available under the completed Actions run → Artifacts section.
  - **IMPORTANT:** Always use this method when the user asks for a new IPA or APK build. Never use EAS managed builds (requires paid Apple Developer account). Never use Codemagic (user ran out of billing).
  - Supabase env vars (`EXPO_PUBLIC_SUPABASE_URL` + `EXPO_PUBLIC_SUPABASE_ANON_KEY`) are baked in the workflow file directly so the app connects to the live backend.
- **Authenticator Apps:** (e.g., Google Authenticator, Authy, 1Password) for Super Admin TOTP.
# v1.0.5 — Monthly Report

Ops-only `/monthly-report` page renders ORFG RCN Forms 1, 2, 3, 4 and the Arabic roster sheet. Engine in `src/lib/monthly-report.ts` computes per-pilot day/night/dual hours, IF totals, currency state (C/R/N/C/U/R), and mission-bucket sortie/hour breakdown directly from `usePilots` + `useSorties`. A small wizard collects only the values that vary month-to-month (squadron strength, OPS/attached/course/sick, morale, planned vs achieved, four abort categories, five lectures, next-month plan with ammo, optional per-pilot status/remarks overrides). User inputs persist to `localStorage` under `rjaf.monthlyReport.YYYY-MM`. Forms render as printable HTML with `@media print` page breaks; the toolbar's Print / Save PDF button uses `window.print()`. Sidebar entry gated to `user.role === "ops"`. EN+AR strings under `monthlyReport*` and `nav_monthly_report`. Build: dashboard-windows-installer.yml triggered on main after wiping the previous run + artifact.

# v1.0.6 — Polish, Help, Auto-fill

- **Monthly Report polish:** Form 1/2/3 now show TOTAL rows; Form 3 also derives ACHIEVEMENT %, TOTAL ABORTS and WEATHER % via `deriveForm3Stats`. Wizard auto-fill seeds next-month plan from prior achievement (`suggestNextMonthPlanFrom`).
- **Bilingual inputs:** Lecture rows, exercise rows, ammo, per-pilot status/remarks all carry `dir="auto"` so officers can type Arabic and English in the same field — direction flips automatically.
- **Add/remove rows:** Plus/Trash2 buttons added for lectures and next-month exercises in the wizard.
- **Pilot model:** New optional `militaryNumber` on `Pilot` (mock + roundtripped through `squadron-data.ts` JSON `data` blob). Roster edit form exposes the field next to Arabic name.
- **Add Sortie auto-fill:** When the ops officer picks a pilot or co-pilot, a read-only `PilotAutoFill` line appears under the dropdown showing the pilot's call sign, flight name, military number, Arabic name and qualification badges from the roster — so the officer can confirm they picked the right person without leaving the form.
- **Help page:** Now covers every major area — Sortie Logging, Roster/Pilots/Rankings, Currency & Expirations, Schedule/Duty/Risk, NOTAMs/Routes/Units, PDF Exports & Archives, Monthly Report, Users/Audit/Ops Team, Settings/License/Updates and the existing Pilot Mobile App + Support sections. EN + AR strings.
- **Build:** dashboard-windows-installer.yml triggered on main commit `57be433` after wiping prior runs + artifacts.

# v1.0.26–1.0.32 — Lock Screen + The Black Screen Saga

**v1.0.26** shipped Task #83 (manual Lock screen, 30-min idle auto sign-out, pilot ID badge with QR/photo). Immediately introduced a black-screen-on-launch regression on Windows. Six builds (1.0.27 → 1.0.32) were spent isolating the cause — final fix in **v1.0.32**.

**Root cause:** Vite/Rollup minifier left six lucide-react icons (`Inbox`, `Mail`, `Share2`, `UserPlus`, `Users2`, `FileBarChart`) un-renamed in the production bundle while never binding them to the import — they appeared as bare global identifiers (`I:Inbox`) in the menu array, throwing `ReferenceError: Inbox is not defined` the moment the renderer mounted Layout.tsx. Because Layout wraps every signed-in route, the entire app crashed to a blank window.

**Fix:** Alias the affected icons at import (`import { Inbox as InboxIcon, ... } from "lucide-react"`) and use the `*Icon` names everywhere. This forces the bundler to bind the import properly. Verified by grepping the built `dist/public/assets/index-*.js` for `I:Inbox|Mail|Share2|...` — no matches.

**Lesson — lucide-react bundler gotcha:** When adding a new lucide-react icon whose name collides with a possible global or HTML element name (`Inbox`, `Mail`, `Image`, `Link`, etc.), always alias it as `Foo as FooIcon` at import time. The minifier's name-mangler can intermittently skip these, leaving an undefined global in the bundle.

**Diagnostics added during the bisect (kept as safety nets):**
- Inline pre-bundle error trap in `index.html` paints any uncaught error or unhandled promise rejection to the screen if the React bundle never mounts (8s timeout). Removed from index.html in v1.0.33 cleanup if no longer needed — currently still present.
- `safeParse` wrapper in `src/lib/auth.tsx` for all `JSON.parse` of localStorage values (defensive, kept).
- `sandbox: false` + `webSecurity: false` on the Electron BrowserWindow (legitimate for an offline desktop app loading file:// — kept).
- Auto-open DevTools (v1.0.30) — **removed in v1.0.33**.

**v1.0.33** — clean release. DevTools no longer auto-open. Lock screen + idle timeout fully active. Brand polished.

# v1.0.50 (PC) / v1.0.5 (mobile) — Sync Indicator + Inactivity Auto-Logout

**Roster sync indicator.** New migration `0018_sync_indicator_fix.sql` (supersedes 0017) adds `pilot_reminder_prefs.last_seen_at` plus two RPCs:
- `ping_pilot_sync()` — resolves `squadron_id` from `pilots.auth_user_id = auth.uid()` and upserts `last_seen_at`. Rejects forged/unbound pilot_id claims.
- `list_pilot_sync_status()` — **scope-enforced**: pilot mobile callers get their own row only; ops/command callers get every pilot in their squadron (left-joined so pilots with no prefs row still show as "no phone linked"). Never crosses squadrons.

Mobile (`lib/notifications.ts` `pingSync()`) calls the RPC on cold launch, every `AppState → active` foreground, and on a timer driven by the pilot's `autoSyncHours` pref (1/3/6/12h, default 3h). The timer re-arms automatically when Settings writes a new value via `subscribePrefsChange` in `storage.ts`.

PC Roster column shows a coloured dot per pilot with a "Last sync: N min ago" tooltip — 🟢 ≤24h, 🟡 >24h, ⚫ no phone. `usePilotSyncStatus` (inline in `pages/Roster.tsx`) refetches every 60s via React Query.

**Inactivity auto-logout.** Per-user preference (localStorage key `rjaf.inactivityMin.<userId>`, options 0/15/30/60/120/240/480 min, default 120; 0 disables). Settings page has an `InactivityTimeoutSection` picker. `auth.tsx` runs a useEffect idle watcher on `mousemove/keydown/pointerdown/scroll/touchstart`, pauses cleanly on tab-hidden (using wall-clock accounting on return to visible), and re-arms instantly when the Settings picker writes a new value (via an in-process `inactivityListeners` pub/sub — the browser's native `storage` event only fires across tabs).

**Mobile inactivity lock.** When the app goes to `background`/`inactive` we stash `Date.now()`; on return to `active`, if elapsed > `prefs.inactivityMinutes * 60_000` (and the pref is > 0) we call `setUnlocked(false)` so the pilot lands on the lock screen on re-open.

**Deployed:** Migration 0018 via Supabase Management API (HTTP 201). Both apps compile clean (`tsc --noEmit` passes).

**Still pending (next build):** Commander accounts → Supabase table + RLS + login RPCs (currently localStorage-only in `src/lib/commander-store.ts`); remove `DEFAULT_ADMIN_PASSWORD_HASH` + `MASTER_RECOVERY_HASH` from production PC build; trigger PC v1.0.50 + mobile v1.0.5 Windows/EAS builds.
