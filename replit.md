# Overview

This project is a pnpm workspace monorepo using TypeScript, designed to build a comprehensive flight hours management system for the Royal Jordanian Air Force (RJAF). It includes a web-based command dashboard ("Eagle Eye HQ") for super administrators and commanders, and a mobile application for pilots.

The system aims to provide:
- **Centralized Administration:** Super admin panel for system overview, license key management, commander accounts, squadron control, and audit logging.
- **Operational Oversight:** Commander dashboard for multi-squadron overview, pilot tracking, and alerts.
- **Pilot Management:** Detailed pilot profiles, currency tracking, and sortie logging.
- **Data Archiving:** Local, periodic archiving of operational data for historical analysis and backup.
- **Secure Access:** Role-based access control, TOTP for super admin, and license key binding to hardware and user.
- **Multilingual Support:** Full English and Arabic (RTL) localization.

The business vision is to modernize RJAF's flight operations management, improve data accuracy, enhance decision-making through real-time insights, and streamline administrative tasks.

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
- **CodeMagic:** CI/CD for the `pilot-mobile` Expo application.
- **Authenticator Apps:** (e.g., Google Authenticator, Authy, 1Password) for Super Admin TOTP.