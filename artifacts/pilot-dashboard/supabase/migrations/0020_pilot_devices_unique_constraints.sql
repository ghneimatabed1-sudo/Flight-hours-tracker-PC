-- 0020_pilot_devices_unique_constraints.sql
--
-- Replace the partial unique INDEXES on pilot_devices with real unique
-- CONSTRAINTS so that PostgREST `upsert(..., { onConflict: "user_id" })`
-- (and the same for `token_hash`) actually works.
--
-- Background: the previous schema declared
--   CREATE UNIQUE INDEX pilot_devices_user_id_uniq
--     ON pilot_devices (user_id) WHERE user_id IS NOT NULL;
-- which Postgres will not honour for `INSERT ... ON CONFLICT (user_id)`
-- without an explicit matching `WHERE` clause. PostgREST does not emit one,
-- so the link-pilot-device edge function's upsert raised
-- "no unique or exclusion constraint matching the ON CONFLICT specification"
-- — the error was logged to the function console but the function still
-- returned ok:true, leaving the dashboard stuck on "NOT LINKED / Never"
-- after a successful phone pairing.
--
-- A real UNIQUE constraint allows multiple NULLs by default, which preserves
-- the original intent of the partial index (only enforce uniqueness when
-- the column is non-NULL).

BEGIN;

DROP INDEX IF EXISTS public.pilot_devices_user_id_uniq;
DROP INDEX IF EXISTS public.pilot_devices_token_hash_uniq;

ALTER TABLE public.pilot_devices
  ADD CONSTRAINT pilot_devices_user_id_key UNIQUE (user_id);

ALTER TABLE public.pilot_devices
  ADD CONSTRAINT pilot_devices_token_hash_key UNIQUE (token_hash);

COMMIT;
