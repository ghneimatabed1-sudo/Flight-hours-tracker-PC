# Overview

This project is a pnpm workspace monorepo using TypeScript, designed to build a comprehensive flight hours management system for the Royal Jordanian Air Force (RJAF), branded as "Hawk Eye". It includes a web-based command dashboard ("Hawk Eye HQ") for super administrators and commanders, and a mobile application for pilots. The system aims to modernize RJAF's flight operations management by providing centralized administration, operational oversight, pilot management, data archiving, and secure, multilingual access. The business vision is to improve data accuracy, enhance decision-making through real-time insights, and streamline administrative tasks.

# User Preferences

- **Communication Style:** All updates and changes should be clearly documented and explained.
- **Workflow:** Prioritize iterative development.
- **Interaction:** Ask before making major architectural changes or significant modifications to existing features.
- **Data Preservation:** Updates must be additive. Existing pilots, logs, monthly summaries, ops officer accounts, license keys, squadron attachments, and admin settings MUST survive every release. Breaking changes (field renames, removals, storage key changes) require explicit user sign-off before shipping. LocalStorage keys should remain stable across releases. New schema fields must be optional and default to a sensible empty value.
- **Code Changes:** Pre-existing TypeScript errors should remain untouched unless directly related to the current task.

# System Architecture

The system is built as a pnpm workspace monorepo using Node.js v24, TypeScript v5.9, pnpm, Express 5, PostgreSQL with Drizzle ORM, Zod for validation, Orval for API codegen, and esbuild.

**Monorepo Structure:**
Each package manages its own dependencies within the workspace.

**UI/UX and Features:**
- **`pilot-dashboard` (Web):**
    - **Super Admin Panel:** System overview, license key management, commander account management, squadron control, and audit logging.
    - **Commander Dashboard:** Read-only multi-squadron overview, pilot tracking, and alerts.
    - **Authentication:** Mocked (with Supabase integration planned), RFC 6238 TOTP for super admin, and license key binding.
    - **Internationalization:** Full English and Arabic (RTL) localization.
    - **Pilot Currency Hiding:** UI to toggle visibility of specific pilot currencies.
    - **Historical Import Management:** Undo last CSV import functionality.
    - **XLSX Export:** Functionality to export pilot data.
    - **Sortie Log Management:** Edit and delete sortie logs.
    - **Archiving:** Client-side monthly and yearly data archiving stored in `localStorage`, viewable on a dedicated archives page.
    - **Monthly Report Page:** Renders ORFG RCN Forms 1-4 and Arabic roster sheet, with dynamic calculations and user input persistence.
    - **Lock Screen:** Manual lock screen and 30-minute idle auto sign-out.
    - **Sync Indicator:** Roster column shows pilot sync status (last seen) with mobile app.
    - **Inactivity Auto-Logout:** Configurable auto-logout based on user inactivity.
- **`pilot-mobile` (Mobile):** Expo app for iOS/Android, with inactivity lock when the app goes to background.

**Technical Implementations:**
- **Supabase Integration:** Used for PostgreSQL database, planned authentication, and Edge Functions (e.g., `validate-license`). Features `isLive()` for switching between live and mock data, RLS policies, and seed scripts for demo data.
- **License Key Management:** License keys are bound to hardware fingerprints and operator usernames, with `expiresAt` for duration control. Super admin manages key generation, and server-side validation enforces key constraints.
- **Audit Logging:** System-wide logging for key actions.
- **Data Preservation Policy:** Strict adherence to additive updates and stable localStorage keys across releases.

# External Dependencies

- **Supabase:** PostgreSQL database, authentication (planned), and Edge Functions (for `validate-license`).
- **React Query:** Data fetching and state management in the web application.
- **`xlsx` package:** For XLSX export functionality.
- **Mobile Builds (unsigned IPA + APK):** GitHub Actions workflow for building unsigned iOS and Android apps.
- **Authenticator Apps:** For Super Admin TOTP (e.g., Google Authenticator, Authy, 1Password).