# 🚨 AI AGENTS — READ `/AGENTS.md` AND `/DOMAIN.md` FIRST

Every AI agent (Replit Agent, Cursor, Claude Code, Aider, Cline, etc.) **must read both files at the repo root before any change**:
- **`AGENTS.md`** — the do-nots, the migration recipe, the test commands, the architecture in 60 seconds.
- **`DOMAIN.md`** — what every page, role, report, and number actually means in operational terms.

**Both documents are living contracts.** The instant a code change alters what a role sees, what a page does, what a number means, what a report contains, or how a flow works, the matching section in `DOMAIN.md` (and the matching `.local/memory/<area>.md` if one exists) **must be updated in the same commit as the code change**. Documentation drift is treated as a bug.

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

# Domain Logic Memory  ← READ FIRST, EVERY SESSION

Canonical rules for every settled feature in this app live in
**`.local/memory/`**. This is the operator's long-term memory of
how the app should behave. **Mandatory protocol:**

1. **Before touching ANY area listed in the index below, READ the
   matching memory file.** No exceptions. Even for "small" tweaks
   like a label change or a number adjustment. The memory file is
   the source of truth — never re-ask the operator about settled
   decisions, never guess from the code alone.
2. **After making a change, UPDATE the matching memory file** —
   adjust the rules in the body if behaviour shifted, and append
   a one-line Change Log entry at the bottom with the date and
   what changed.
3. **When the operator settles a new rule, CREATE a new memory
   file** (even for small features) and add it to the index in
   `.local/memory/README.md` AND to the index below in this
   `replit.md` so it loads with my context every session.
4. The operator may instruct me to remove a memory file once a
   feature is fully stable and unlikely to change. Until then,
   keep them all.

Index of memory files:
- `.local/memory/README.md` — index + update protocol
- `.local/memory/multi-squadron.md` — **READ EVERY SESSION.** Long-term design contract: app must work across 15-20+ squadrons on different code builds, with all five command tiers (squadron/flight/wing/base/HQ) seeing the same synchronized data and zero ongoing intervention from the operator. Defines the additive-only change discipline, defensive write pattern, tier-consistency rule, squadron-agnostic copy rule, and the rollout checklist that runs before EVERY commit.
- `.local/memory/release-process.md` — one build per push (path-filter on `main` OR `v*` tag), bump dashboard `package.json` and mobile `app.json` every release.
- `.local/memory/supabase-admin.md` — apply migrations directly via the Management API, never ask the operator to open the SQL editor. **NEW (Apr 2026):** every push to `main` that touches `artifacts/pilot-dashboard/supabase/migrations/*.sql` now auto-applies pending migrations to production via `.github/workflows/apply-supabase-migrations.yml`, idempotent through `_migration_ledger`. The Management API path remains a manual fallback only.
- **Identity normalization (0041 + 0042):** `xpc_registry.id` and `squadrons.name` are now uniqueness-protected on a canonical form (`xpc_canon_pc_id` / `squadrons_canon_name`) — strip non-alphanumerics, uppercase, drop trailing `SQDN`/`SQUADRON`/`SQN`. BEFORE INSERT/UPDATE triggers reject collisions with a readable error. Never manually re-insert a duplicate squadron row or registry row by hand — use the existing canonical id.
- `.local/memory/currency-refresh.md` — Day/Night/NVG/IRT auto, Sim monitor-only, Medical manual
- `.local/memory/dual-hour-rules.md` — Six sortie types force co-pilot hours to Dual
- `.local/memory/initial-hours.md` — Pre-Hawk-Eye baseline hours; lifetime totals only, not currency or Monthly Report
- `.local/memory/active-pc-visibility.md` — 90 s active window + offline messaging
- `.local/memory/add-pilot-form.md` — six date fields, English rank, multi-segment qualification
- `.local/memory/print-system.md` — global print rules + `data-print-area`
- `.local/memory/phone-pair-indicator.md` — Roster green dot
- `.local/memory/user-management.md` — User Manager hidden vs Assigned Ops Pilots
- `.local/memory/reminders-wording.md` — "Sent" replaces "Fired"

When the operator settles a new non-trivial domain decision, add a
new file under `.local/memory/` and link it from
`.local/memory/README.md` and from this index.

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

# v1.1.81 (PC) / v1.0.11 (mobile) — Periodic Summary (paper-logbook H1/H2/Annual)

**Goal.** Replicate the canonical RJAF paper-logbook periodic summary page that every pilot signs at the squadron every six months — three scopes (First Half = Jan–Jun, Second Half = Jul–Dec, Annual = full calendar year) plus a year picker covering the past 4 years. PC dashboard exports the page as PDF; mobile shows the same numbers inline on the Home tab.

**PC dashboard (`src/lib/pdf.ts`).** New `exportPeriodicSummary(sqdn, pilot, sorties, year, scope, lang)` produces the canonical 10-column layout: `Date | A/C Type | Day-1P | Day-2P | Day-Dual | Night-1P | Night-2P | Night-Dual | Total(1-6) | Captain | Sim | Instr-Act`, grouped by aircraft type with a TOTAL footer row, certification banner ("Certified correct from <DD MMM YYYY> to <DD MMM YYYY>"), three signature blocks (Self / Sqdn Cdr / Flight Cdr), and a stamp box. Per-pilot attribution rule: `t = sortie.actual` is credited ONCE to the bucket dictated by THIS pilot's `pilotSeatStatus` (or `coPilotSeatStatus`) — never both. Sim and `ifAct` follow standard logbook convention (both crewmembers credit the full sortie value). NVG sorties fold into the Night columns per paper-book convention (book has no NVG column).

**Legacy fallback subtlety:** when seat-status fields are missing on legacy rows, we derive the seat from `pilotIsCaptain`. If `coPilotIsCaptain` is undefined we INVERT the pilot's flag (standard 2-seat assumption — exactly one crewmember is captain) so the co-pilot doesn't silently default to "2nd" when both pilots flew as 2nd seat.

**PC UI (`src/pages/PdfExports.tsx`).** Added a `Year` dropdown in the controls strip (current year + past 3) and 3 new `perPilot` entries: `periodicH1`, `periodicH2`, `periodicAnnual`. Title labels include the selected year so the operator sees `Periodic Summary · H1 · 2026` before clicking. Wired into the run handler with a `PeriodicScope` union (`H1` | `H2` | `FULL`). Filename pattern: `periodic-{scope}-{year}-{pilotId}-{lang}-{stamp}.pdf`.

**Mobile (`lib/calculations.ts` + Home tab).** New `computePeriodicSummary(profile, sorties, year, scope)` returns `{day, night, nvg, sim, captain, secondPilot, instrument, total, grandTotal, sorties, startISO, endISO}`. Local Y/M/D parse for the date filter (TZ-safe, matches `squadron-data` convention). Captain attribution = `Day + Night` flying time only (matches the dashboard contract — sim is excluded). Mobile sortie shape doesn't carry per-seat 1P/2P/Dual splits or `ifAct`, so the on-screen card surfaces the simpler 6-line breakdown (Day / Night / NVG / Sim / Captain / Second Pilot) plus the Total(1-6) and Grand Total rows.

**Mobile UI (`app/(tabs)/index.tsx`).** New "Periodic Summary" card on the Home tab between the year-breakdown and sync cards. Year picker (4 chips for past 4 years) + scope picker (H1 / H2 / Annual chips) drive the `computePeriodicSummary` memo. Card reuses the existing `styles.card` visual language (gold accent on active chips, tabular-nums for hours, empty-state copy when the period has no sorties). EN+AR i18n keys added (`home_periodic_*`).

**Verification:** `tsc --noEmit` clean on both projects. Existing dashboard PDF tests unaffected. Mobile workflow shows the card at runtime; APK/IPA picked up automatically by `.github/workflows/mobile-unsigned-builds.yml` on next mobile-path push.

## v1.1.101 — return-to-originator unblock (2026-04-23)
**Bug**: After Ops edits/rejects a flight schedule composed by a Flight Cmdr (or any tier), the returned share appeared on the originator's PC in the Sent card with NO approve/edit/reject buttons ("no option for approval, no option for edit, no option for reject. Nothing").

**Root cause**: `FlightProgramShareInbox` (pages/FlightProgram.tsx:612) incoming filter was `matchesMe(currentPcId) && !matchesMe(originSquadronId)`. When a share bounces back to its originator, both sides match the same PC — the `!matchesMe(originSquadronId)` clause excluded it from Incoming entirely and it fell into Sent (view-only). Schedule Chain had the correct partition all along.

**Fix**: Mirror Schedule Chain (ScheduleChain.tsx:358-359): `incoming = current-holder`, `sent = origin-AND-NOT-current`. Tier-agnostic so it protects Flight/Sqn/Wing/Base/HQ as we scale to 15-20 squadrons.

**Secondary fix**: `cross-pc.ts` edit+reject-return paths were hard-coding `currentTier = "squadron"`. New `tierFromPcId()` helper derives tier from the origin PC id prefix (FLIGHT:/WING:/BASE:/SQDNCMD:/HQ:) so bounce-back badges & sidebar counts reflect the real origin tier.

Commit: 737368d · auto-build via `.github/workflows/dashboard-windows-installer.yml`.

## v1.1.108 — Task #127 schedule-flow fixes + regression dry-run (2026-04-23)
**Four interlocking schedule-flow bugs.** (1) Schedule Chain on the Ops PC double-counted program-style shares that already lived in the Flight Schedule inbox. Fix: `sidebar-badges.ts` and `ScheduleChain.tsx` skip `share.program` rows for the roles that ALSO have `/flight-program` in their sidebar (Ops, Sqn Cmdr, Flight Cmdr, super_admin). Wing+Base intentionally keep program shares in Schedule Chain — that's their only path to act on them. (2) Ops composer reported "no registered PC" because the strict tier filter dropped legacy Flight Cmdr rows that didn't carry the `FLIGHT:` prefix. Fix: third elimination clause in the Ops target filter (`FlightProgram.tsx`) accepts bare-id rows whose tier resolves to flight. (3) Flight Cmdr PC didn't pulse the red dot when Ops sent a sheet. Fix: new `flightProgramCount` key in the badge map; HQLayout commander shell now reads the same `useSidebarBadges()` map as the squadron `Layout` so commander seats see the dot too. Per-PC seen-marker (`rjaf.lastSeenFlightProgram`) clears the badge on visit and re-arms only when a strictly-newer share arrives. (4) Approve/Reject silent on failure. Wrapped every `decide.mutateAsync` (approve, reject, hold, edit, forward) in try/catch with destructive toasts so RLS rejections / network drops surface to the operator. Also: when Flight Cmdr / Sqn Cmdr Approve without an upstream PC registered, the toast is explicit — "Approved — no Sqn Cmdr/Wing PC registered, chain paused here".

**New page.** Read-only Schedule History (`/schedule-history` and `/dashboard/schedule-history`) gated by `canUseScheduleChain`. Tabular view (Date / Squadron / Current Tier / Last Action / Last Actor / Status) with filters All / Approved / Rejected / In flight; per-row View + Print. Includes in-flight items where this PC made a move, plus terminal approvals/rejections — uses the default `useScheduleShares(myPcId)` query, NOT the wing-final-only `viewAllApproved` path.

**Operational verification (regression dry-run, B.8 spec).**
- Ops composes a schedule and sends to Flight Cmdr → Flight Cmdr `/flight-program` badge increments to 1, red dot visible on both Layout (squadron) and HQLayout (commander) shells. Visiting `/flight-program` clears the dot.
- Flight Cmdr Approve with no Sqn Cmdr PC registered → toast reads "Approved — no Sqn Cmdr PC registered, chain paused here", share status flips to approved, Ops Schedule Chain inbox empties (program share filtered out for Ops dedup).
- Flight Cmdr Reject → destructive toast on RLS failure (verified by transient network kill); success toast otherwise. Originator (Ops) sees the rejected share back in their Sent list with returned edits.
- Wing commander on a program-style share → still sees it in Schedule Chain (program filter NOT applied for Wing/Base) and can Approve & send to Base.
- Schedule History on Flight Cmdr PC → shows a sheet they forwarded (in-flight) AND the same sheet after Wing approval (Final tag). Print button opens the row first, then the browser print dialog.

Typecheck remains clean for everything in this diff (4 pre-existing errors in BackupCard / DateInput / FinalSchedules.tsx:483 / admin/LicenseKeys are unrelated). Forward error-toast wrapping for the standalone Send button is included; the auto-forward inside Approve was already wrapped in the outer try/catch.

## Task #131 — Connection Diagnostic page + Supabase build-secret guard (2026-04-23)
**New page** `/diagnostic` (mounted in SquadronOps, Commander, and Admin route trees + sidebar entries under Settings, plus a "I think my PC isn't connecting" link from Settings → header). Surfaces:
- **Backend card**: shows the Supabase project HOST only (anon key never displayed). When `VITE_EXPECTED_SUPABASE_HOST` is baked into the build, mismatches render a red banner so an installer wired to the wrong project is obvious in seconds. The Windows-installer workflow now sets `VITE_EXPECTED_SUPABASE_HOST = VITE_SUPABASE_URL` so every official build self-checks at runtime.
- **This-PC card**: canonical PC id, tier, scope, signed-in user, device suffix, fingerprint, last heartbeat OK timestamp + heartbeat error if any.
- **Verify Connectivity** button: forces an immediate `registerLocalPC` upsert, reads the row back from `xpc_registry`, reports round-trip ms or the exact Supabase error message (covers "RLS silently dropped the write" — most common cause of an invisible PC).
- **Live PCs table**: polled every 5 s (faster than the default 30 s elsewhere) with online/offline dots (online = heartbeat within `ACTIVE_WINDOW_MS`) and a "this PC" tag on the local row.
- **Browser session check card** + **persistent yellow banner** (`SessionCollisionBanner`, mounted in both `Layout` and `HQLayout` chrome): uses a `BroadcastChannel("rjaf.session.collision")` ping/pong handshake to detect another tab in the SAME browser profile signed in as a DIFFERENT auth user. Two such tabs share Supabase's auth storage and silently overwrite each other — the #1 cause of "second PC won't show up" bug reports during testing. Banner directs operators to the Diagnostic page and explains the fix (separate browser profile / different browser).

**GitHub Actions hard-fail.** `.github/workflows/dashboard-windows-installer.yml` now has a "Verify Supabase build secrets were injected" step that runs BEFORE `pnpm run build` and fails the pipeline if either `VITE_SUPABASE_URL` or `VITE_SUPABASE_ANON_KEY` is empty. The build log prints the URL HOST + the anon-key length (never the key itself) so the build is auditable without leaking the credential. Mirrors the existing `VITE_API_SERVER_URL` guard.

### Test-rig setup for simulating multiple PCs on one machine
The full multi-PC environment runs across many physical machines; for desk-side testing you can stand up several "PCs" on one laptop, but ONLY if you keep their auth storage isolated. Things that look like separate PCs but aren't:
- Two tabs in the **same** Chrome profile → same `localStorage`, same Supabase auth session. The second sign-in silently kicks out the first. The yellow `SessionCollisionBanner` will fire.
- Two windows in the same browser profile → same as above (windows ≠ profiles).
- An incognito window + a normal window → these ARE isolated (incognito gets its own storage), counts as two PCs.

Recommended rig (one laptop = up to ~5 simulated PCs):
1. **PC A** — Chrome, default profile, sign in as the Squadron Ops account.
2. **PC B** — Chrome → People → "Add" → new profile "Cmdr". Sign in as the Squadron Commander account.
3. **PC C** — Edge (or Firefox), sign in as Wing Commander.
4. **PC D** — A different browser again (Brave / Safari / second Edge profile), sign in as Base Commander.
5. **PC E** — The packaged Electron app (always its own process, fully isolated regardless of browser profiles).

Visit `/diagnostic` on each "PC" and confirm:
- The Backend card shows the **same** host on every PC. Different hosts ⇒ those PCs are talking to different Supabase projects and will never see each other.
- The PCs table on every PC lists every other PC (online dot if last heartbeat ≤ 90 s).
- No yellow `SessionCollisionBanner` is showing — if it is, two of your "PCs" are actually two tabs in the same browser profile and the rig isn't isolated.
- "Verify Connectivity" returns OK with a small ms number on each PC.

If a PC fails to appear on the others, the Diagnostic page on THAT PC tells you exactly why (Supabase not configured / wrong host / RLS rejected the write / heartbeat error).

## Task #138 — PC Pairing system (2026-04-23)
**Replaces implicit registry-heartbeat discovery with explicit, persistent pair links.** Migration `0038_xpc_pair_links.sql` adds three tables (`xpc_pair_codes` 5-min handshake codes, `xpc_pair_links` canonical `a<b` pairs with `kind` check + `permanent` flag + `last_activity_at`, `xpc_pair_audit` super-admin-only ledger) plus four SQL functions (`xpc_validate_pairing` is the single-source-of-truth allowed-pairing matrix, `xpc_pair_links_sweep(days)` revokes time-bound expiries + 90-day inactive non-permanent links, `xpc_pair_touch(pc_id)` bumps `last_activity_at`, `xpc_redeem_pair_code(...)` is the SECURITY DEFINER atomic consume-+-insert RPC the joiner calls). Server-side enforcement is layered: a BEFORE INSERT/UPDATE trigger on `xpc_pair_links` re-runs `xpc_validate_pairing` and rejects writes the matrix forbids — so even a hostile client cannot mint a forbidden pair. The codes-table UPDATE policy is super_admin only (joiners must go through the redeem RPC), and `xpc_pair_links_sweep` checks `xpc_is_super_admin()` (or `current_user IN ('postgres','supabase_admin')` for the pg_cron path) inside its body before mutating anything. RLS for the link/audit tables gates by `xpc_my_pc_ids()` membership OR `xpc_is_super_admin()`. Idempotent backfill DO-block at the bottom of the migration seeds in-squadron pairs from existing `xpc_registry` rows so the first deploy doesn't blow away current routing.

**New library** `src/lib/pairs.ts` is the only place the client reaches the pairing tables. Exports: `issuePairCode`, `redeemPairCode`, `adminCreatePair`, `revokePair`, `setPairPermanent`, `resetRegisteredPc`, `runSweep`, plus React-Query hooks (`useMyPairs`, `useAllPairs`, `usePairAudit`, `usePairedPeers`, `useWatchForIncomingPair` for auto-closing the host modal once the join side redeems). `resolvePairKind` mirrors the SQL `xpc_validate_pairing` matrix client-side so the picker can grey-out forbidden combinations BEFORE round-tripping. `daysUntilInactivityExpiry` + `expiryUrgencyClass` give the Connections page the amber/rose countdown chip.

**Two new pages:**
- `/connections` (Settings → Connections, mounted in all three route trees + sidebar entries in Layout / HQLayout commander shell / HQLayout admin shell): self-service. Shows This-PC card, My Pairs list with revoke + countdown, and two pair-modals — Show Code (mints a single-use 6-digit code valid 5 min, auto-closes when the other side redeems) and Enter Code (validates against the matrix client + server side; explicit error message names the forbidden tier combo and points the operator at the super-admin Map).
- `/admin/connection-map` (super_admin only, AdminRoutes): god-mode three-pane layout — registered PCs (filterable, click two to pair), active pairs (revoke, mark permanent), audit (last 150 entries). Cross-squadron-ops escape-hatch dialog requires a written justification (≥ 8 chars) + hard expiry datetime. "Reset selected PC" revokes every pair the PC participates in and removes its `xpc_registry` + `xpc_user_pcs` rows so the operator can rebuild it from a clean state — documented hardware-replacement / corrupted-state path.

**90-day sweep is operator-driven for now.** The Connection Map "Run sweep now" button calls `xpc_pair_links_sweep(90)` and toasts how many it revoked / expired. Adding a Supabase `pg_cron` daily schedule is left as a follow-up — the SQL function is already idempotent and `security definer`, so wiring cron is a one-liner once the operator decides on a time.

**Cross-squadron portability.** The pair model has zero squadron-specific code. The same backend can serve any number of squadrons (just register their PCs and pair them) — no per-squadron config, no per-base partition, no DNS tricks. The Connection Map filter box scales to any number of PCs.


## Task #145 — Identity normalization + 15-year automation foundation (2026-04-23)

**Two-week burn-in revealed three classes of failure** that all needed fixing before the system can be left alone for 15 years: (1) migrations land on `main` but never reach production because the only deploy path was a human pasting SQL into the Supabase editor, (2) duplicate identity rows accumulated in production (3 `xpc_registry` rows for "NO.8" / "NO. 8 SQDN" / "NO.8 SQDN" that all meant the same PC, 2 `squadrons` rows for "NO.8" / "NO.8 Squadron"), (3) no scheduled background jobs beyond the four added in 0032 — the operator-driven 90-day sweep button was a 6-month time bomb.

**0041_canon_identity.sql** — DB-level normalization. Two SQL functions: `xpc_canon_pc_id(text)` strips whitespace + uppercases (preserves dots so "NO.8" stays "NO.8"), `squadrons_canon_name(text)` does the same and ALSO strips trailing `SQDN` / `SQUADRON` suffixes (so "NO.8" and "NO.8 Squadron" canonicalise to the same key). Unique indexes on the canonical form + BEFORE INSERT/UPDATE triggers raise an instructive 23505 error naming the colliding row and pointing the operator at the Connection Map. **Verified** in production with `insert into xpc_registry values ('NO. 8 SQDN ', ...)` — rejected as expected.

**0042_prod_data_backfill.sql** — one-shot collapse, idempotent. Picks the most-recent `last_seen` row per canonical key, re-points `xpc_pair_links` and `xpc_user_pcs` to the survivor, deletes orphans, deletes self-referential pair links that arise post-collapse. Squadron collapse re-points 15 explicit FK tables (pilots, schedules, audit_log, alerts, license_keys, etc.). Backfills `wing` to '8 WG' where null. Designed to run multiple times safely.

**0043_pgcron_long_term.sql** — three new schedules on top of the four from 0032: `xpc-pair-links-sweep-weekly` (Sun 03:30 UTC, runs `xpc_pair_links_sweep(90)` so the 6-month time bomb is gone), `xpc-purge-archived-messages-weekly` (Sun 03:35 UTC), `ops-backup-audit-ping` (daily 04:00 UTC, writes a `type='ops.backup.completed'` row to `audit_log` with `squadron_id=null` so operators can grep the Audit Log without leaving the dashboard to confirm the daily Supabase backup window elapsed). Uses a `_unschedule_if_exists` helper so re-running the migration doesn't double-schedule.

**0044_migration_ledger.sql** — `public._migration_ledger (filename PK, applied_at, applied_by, sha256)` plus retroactive backfill of every 0001..0040 file marked `applied_by='retroactive'` with NULL hash, and 0041..0044 marked `applied_by='task-145'`. RLS enables read for super_admin only; writes are Management-API-only (which bypasses RLS). The NULL-hash convention means the ledger only fails on a CHANGED hash, never a missing one — so retroactive entries don't trip drift detection.

**.github/workflows/apply-migrations.yml** — on push to main touching `artifacts/pilot-dashboard/supabase/migrations/**.sql`, lists every file, reads `_migration_ledger`, applies missing files via the Management API, records each in the ledger with sha256. **Drift detection**: if a file's on-disk sha256 differs from the recorded one, the job fails fast and tells the operator to write a forward-only patch migration (never retroactively rewrite history). Required GitHub secrets: `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`. Uses `concurrency: apply-migrations` so two pushes can never race.

**`notify pgrst, 'reload schema'` is now the standard tail** of every migration that adds a function, table, or column. Retro-appended to 0038 / 0039 / 0040 (which previously needed a manual REST-API restart before new RPCs were callable). Documented in 0041's header so future migrations follow the convention.

**Production state after this task:** single registry row, single squadrons row with `wing='8 WG'`, all 5 user_pcs re-pointed to the survivor, 8 active cron jobs (4 from 0032 + 3 new + 1 pre-existing pair-sweep), 46 ledger entries. Trigger guards are live and reject whitespace-polluted inserts with named, actionable error messages.
