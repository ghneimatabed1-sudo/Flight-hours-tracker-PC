# Supabase seed data

This folder contains the demo seed for a freshly provisioned Supabase
project. Running it gives the app the same baseline data the in-memory
preview shows: one squadron, 16 pilots, 50 sorties, currencies, leaves,
duty roster, NOTAMs, and today's flight schedule.

## Files

- **`generate-seed.mjs`** — deterministic generator that mirrors the RNG
  in `src/lib/mock.ts`. Re-run after changing the mock data:
  ```sh
  node artifacts/pilot-dashboard/supabase/seed/generate-seed.mjs
  ```
- **`seed.sql`** — generated SQL ready to apply against a clean DB.

## Run order

1. **Apply migrations** (Supabase SQL editor or `supabase db push`):
   - `migrations/0001_init.sql`
   - `migrations/0002_mobile_link.sql`
2. **Run the seed** with the **service role** (Supabase SQL editor is
   already service-role; psql callers must use the service-role
   connection string). RLS would otherwise block the inserts.
   ```sh
   psql "$SUPABASE_SERVICE_ROLE_URL" -f seed.sql
   ```
3. **Create an admin auth user** (manual, see comment block at the
   bottom of `seed.sql`):
   - In the Supabase dashboard: Authentication → Users → "Add user".
   - Edit `app_metadata` to:
     `{"squadron_id": "00000000-0000-0000-0000-000000000001", "role": "admin"}`
   - Run the small `insert into users (...)` statement at the bottom of
     `seed.sql`, replacing `<auth-user-uuid>` with the new user's id.
4. **Activate the license** in the desktop app using the seeded key:
   `DEMO-RJAF-1234-5678`.

## What gets seeded

| Table         | Rows | Notes                                                   |
| ------------- | ---- | ------------------------------------------------------- |
| `squadrons`   | 1    | Fixed UUID `00000000-0000-0000-0000-000000000001`        |
| `licenses`    | 1    | `DEMO-RJAF-1234-5678`, expires in 365 days              |
| `pilots`      | 16   | Same names/ranks/hours as the in-memory preview         |
| `sorties`     | 80   | Same count as the preview; dates relative to `CURRENT_DATE` |
| `currencies`  | 240  | 16 pilots × 15 six-month tasks                          |
| `leaves`      | 16   | One row per pilot for the current calendar year         |
| `duty_week`   | 5    | Sun–Thu standing roster                                 |
| `unavailable` | 2    | Sample medical leave / course attendance                |
| `notams`      | 3    | Recent NOTAMs                                           |
| `schedule`    | 4    | Today's flight line                                     |

## Re-running

The seed is idempotent for stable-key tables (squadrons, licenses,
pilots, currencies, leaves) via `ON CONFLICT … DO UPDATE`. Tables that
either use UUID PKs or key on the run date — sorties, unavailable,
notams, today's schedule, and duty_week — are wiped for this squadron
before reinsert, so re-running on a later day cannot accumulate stale
duplicates.
