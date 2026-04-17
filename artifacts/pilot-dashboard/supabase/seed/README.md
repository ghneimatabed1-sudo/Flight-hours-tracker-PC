# Supabase seed data

This folder contains the demo seed for a freshly provisioned Supabase
project. Running it gives the app the same baseline data the in-memory
preview shows: one squadron, 16 pilots, 80 sorties, currencies, leaves,
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
   connection string). RLS would otherwise block the inserts, and the
   admin-user provisioning at the end writes directly to the `auth.*`
   tables.
   ```sh
   psql "$SUPABASE_SERVICE_ROLE_URL" -f seed.sql
   ```
   The seed creates a ready-to-use admin account in one step:
   - **Email:** `admin@demo.rjaf.local`
   - **Password:** `admin123`
   - `app_metadata`: `{"squadron_id": "00000000-0000-0000-0000-000000000001", "role": "admin"}`
   Change the password immediately for any non-demo environment.
3. **Activate the license** in the desktop app using the seeded key:
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

## Verifying

Right after running the seed, these counts should match (one squadron):

```sql
select 'pilots'      as t, count(*) from pilots      where squadron_id = '00000000-0000-0000-0000-000000000001'
union all select 'sorties',     count(*) from sorties      where squadron_id = '00000000-0000-0000-0000-000000000001'
union all select 'currencies',  count(*) from currencies   where squadron_id = '00000000-0000-0000-0000-000000000001'
union all select 'leaves',      count(*) from leaves       where squadron_id = '00000000-0000-0000-0000-000000000001'
union all select 'duty_week',   count(*) from duty_week    where squadron_id = '00000000-0000-0000-0000-000000000001'
union all select 'notams',      count(*) from notams       where squadron_id = '00000000-0000-0000-0000-000000000001';
-- expect: 16, 80, 240, 16, 5, 3
```

## Re-running

The seed is idempotent for stable-key tables (squadrons, licenses,
pilots, currencies, leaves) via `ON CONFLICT … DO UPDATE`. Tables that
either use UUID PKs or key on the run date — sorties, unavailable,
notams, today's schedule, and duty_week — are wiped for this squadron
before reinsert, so re-running on a later day cannot accumulate stale
duplicates.
