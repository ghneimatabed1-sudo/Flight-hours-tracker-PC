# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details.

## Artifacts

### pilot-dashboard (web)
Eagle Eye HQ — Royal Jordanian Air Force command dashboard. Two role-based views:
- **Super Admin Panel** (`/admin/*`): system overview, license keys (generate/revoke/release), commander accounts (create/delete/reset), squadrons (enable/disable), audit log.
- **Commander Dashboard** (`/dashboard/*`): read-only multi-squadron overview, cross-squadron pilot table with sort/filter, squadron drill-down, pilot detail, expired/expiring alerts.

Auth is mocked via localStorage (`src/lib/auth.tsx`) with 30-min idle timeout and 5-attempt lockout, ready to be swapped for Supabase Auth. Mock data lives in `src/lib/mockData.ts`. Bilingual EN/AR with full RTL support via `src/lib/i18n.tsx`. Demo credentials: `admin / admin123` (super admin), `commander1 / commander`, `wing1`, `base1`, `hq1` (commanders, all use password `commander`).
