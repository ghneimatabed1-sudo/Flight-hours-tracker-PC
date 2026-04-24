# Overview

This project, "Hawk Eye" (عين الصقر), is a pnpm workspace monorepo using TypeScript, designed for the Royal Jordanian Air Force (RJAF). It provides a comprehensive flight hours management system, including a web-based command dashboard ("Hawk Eye HQ") for super administrators and commanders, and a mobile application for pilots.

Key capabilities include:
- **Centralized Administration:** Super admin panel for system overview, license key management, commander accounts, squadron control, and audit logging.
- **Operational Oversight:** Commander dashboard for multi-squadron overview, pilot tracking, and alerts.
- **Pilot Management:** Detailed pilot profiles, currency tracking, and sortie logging.
- **Data Archiving:** Local, periodic archiving of operational data.
- **Secure Access:** Role-based access control, TOTP for super admin, and license key binding.
- **Multilingual Support:** Full English and Arabic (RTL) localization.

The business vision is to modernize RJAF's flight operations, improve data accuracy, enhance decision-making, and streamline administrative tasks.

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
- **Build Tool:** esbuild

**Monorepo Structure:**
- Each package in the monorepo manages its own dependencies, leveraging pnpm workspaces for TypeScript configuration.

**UI/UX and Features:**
- **`pilot-dashboard` (Web):**
    - **Super Admin Panel (`/admin/*`):** System overview, license key management, commander accounts, squadron control, and audit log.
    - **Commander Dashboard (`/dashboard/*`):** Read-only multi-squadron overview, pilot tracking, and alerts.
    - **Authentication:** Mocked via localStorage, with planned Supabase Auth integration. Super admin uses RFC 6238 TOTP.
    - **Internationalization:** Bilingual EN/AR with full RTL support.
    - **Pilot Currency Hiding:** UI to toggle visibility of specific pilot currencies.
    - **Historical Import Management:** Undo last CSV import functionality.
    - **XLSX Export:** Data export for pilot tables.
    - **Sortie Log Management:** Edit and delete functionality for sortie logs.
    - **Archiving:** Idempotent, client-side monthly/yearly data archiving with a dedicated view page.
    - **Monthly Report:** Renders ORFG RCN Forms 1-4 and Arabic roster sheet, with auto-fill and bilingual inputs.
    - **Lock Screen:** Manual lock, 30-min idle auto sign-out, pilot ID badge.
    - **Schedule Flow:** Management of flight schedules with approval/rejection chain, and a read-only Schedule History page.
    - **Connection Diagnostic Page:** Displays backend host, PC ID, user info, connectivity verification, live PCs table, and session collision detection.
    - **PC Pairing System:** Explicit pairing of PCs using codes, with administrative management for super-admins.
- **`pilot-mobile` (Mobile):** Expo app for iOS/Android, mirroring key dashboard functionalities.
    - **Roster Sync Indicator:** Displays pilot mobile app sync status.
    - **Inactivity Auto-Logout:** User-configurable inactivity timeout.
    - **Periodic Summary:** Replicates paper-logbook summary for H1/H2/Annual periods.

**Technical Implementations:**
- **Supabase Integration:** Used for database, planned authentication, and Edge Functions (e.g., `validate-license`). Schema, RLS policies, and seed data are managed via migrations.
- **License Key Management:** Keys bind to hardware and username, with `expiresAt` control. Server-side validation via `validate-license` Edge Function.
- **Audit Logging:** System-wide logging for key actions.
- **Data Preservation Policy:** Strict adherence to additive updates; existing data and localStorage keys must be stable.
- **Identity Normalization:** Database-level canonicalization for `xpc_registry.id` and `squadrons.name` to prevent duplicate entries, enforced by unique indexes and triggers.
- **Automated Migrations:** GitHub Actions workflow applies pending Supabase migrations to production upon push to `main`.
- **Scheduled Background Jobs:** `pg_cron` schedules for `xpc_pair_links_sweep`, `xpc-purge-archived-messages`, and `ops-backup-audit-ping`.

# External Dependencies

- **Supabase:** PostgreSQL database, planned authentication, and Edge Functions.
- **React Query:** For data fetching and state management in the web application.
- **`xlsx` package:** For XLSX export functionality.
- **Authenticator Apps:** For Super Admin TOTP (e.g., Google Authenticator, Authy).
- **GitHub Actions:** For mobile unsigned builds (IPA/APK) and automated Supabase migration application.