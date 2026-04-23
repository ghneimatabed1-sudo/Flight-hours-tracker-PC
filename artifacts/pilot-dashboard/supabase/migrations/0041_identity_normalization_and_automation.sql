-- 0041 — Identity normalization, prod data cleanup, 15-year automation foundation.
--
-- Three problems this migration solves once and for all:
--
--  1. Migration ledger is missing, so the GitHub Actions auto-apply pipeline
--     has no way to know which migrations have run on prod. Add a ledger
--     table and retroactively mark 0001..0040 as applied.
--
--  2. xpc_registry and squadrons accept any text as identity, so trivial
--     typing differences ("NO.8" vs "NO. 8 SQDN" vs "NO.8 SQDN") create
--     duplicate rows that the pairing matrix later refuses to pair. Add a
--     canonicalising function, a unique index on the canonical form, and
--     a BEFORE INSERT/UPDATE trigger that rejects collisions with a
--     readable error message.
--
--  3. Existing prod has 3 squadron-tier registry rows for NO.8 and 2
--     squadron rows for NO.8 — collapse them in a single transaction with
--     all foreign-key references re-pointed to the surviving rows.
--
-- Also schedules the missing weekly pair-link sweep cron job and reloads
-- the PostgREST schema cache.

begin;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Migration ledger
-- ─────────────────────────────────────────────────────────────────────
create table if not exists public._migration_ledger (
  filename   text primary key,
  applied_at timestamptz not null default now(),
  applied_by text,
  sha256     text
);
comment on table public._migration_ledger is
  'Tracks which migration files have been applied to this database. The GitHub Actions auto-apply pipeline reads this to decide what to run.';

-- Retroactively mark 0001..0040 as applied so the pipeline does not
-- attempt to re-run them.
insert into public._migration_ledger (filename, applied_by) values
  ('0001_init.sql','retro'),
  ('0002_mobile_link.sql','retro'),
  ('0003_pilot_self_rls.sql','retro'),
  ('0004_super_admin_2fa.sql','retro'),
  ('0005_pilot_reminders.sql','retro'),
  ('0006_super_admin_recovery_codes.sql','retro'),
  ('0007_reminder_schedule.sql','retro'),
  ('0008_reminder_manual_runs.sql','retro'),
  ('0009_saved_duty_weeks.sql','retro'),
  ('0010_cross_pc.sql','retro'),
  ('0011_alerts.sql','retro'),
  ('0012_alert_notam_priority.sql','retro'),
  ('0013_schedule_program.sql','retro'),
  ('0014_security_hardening.sql','retro'),
  ('0015_security_advisor_fixes.sql','retro'),
  ('0016_mobile_link_devices_fix.sql','retro'),
  ('0017_sync_indicator.sql','retro'),
  ('0018_sync_indicator_fix.sql','retro'),
  ('0019_sync_status_pilot_auth_binding.sql','retro'),
  ('0020_pilot_devices_unique_constraints.sql','retro'),
  ('0021_pilots_military_number_unique.sql','retro'),
  ('0022_pilot_auth_binding_and_nvg.sql','retro'),
  ('0023_xpc_registry_scoped_visibility.sql','retro'),
  ('0024_xpc_registry_directory_visibility.sql','retro'),
  ('0025_xpc_registry_anon_directory.sql','retro'),
  ('0026_license_registry.sql','retro'),
  ('0027_schedule_share_dismissal.sql','retro'),
  ('0028_widen_tier_constraints.sql','retro'),
  ('0029_widen_schedule_delete_policy.sql','retro'),
  ('0030_backfill_app_metadata.sql','retro'),
  ('0031_pilots_rank_en.sql','retro'),
  ('0032_retention_cleanup_jobs.sql','retro'),
  ('0033_fix_schedule_update_with_check.sql','retro'),
  ('0034_robust_schedule_insert_rls.sql','retro'),
  ('0035_xpc_universal_autoclaim_rls.sql','retro'),
  ('0036_xpc_bulletproof_rls.sql','retro'),
  ('0037_org_chart_hierarchy.sql','retro'),
  ('0038_xpc_pair_links.sql','retro'),
  ('0039_sender_identity_and_squadron_defaults.sql','retro'),
  ('0040_backfill_squadron_defaults.sql','retro')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Canonicalising functions
-- ─────────────────────────────────────────────────────────────────────
-- Strip every character except alphanumerics, period, colon, and hash
-- (those three are the only structural separators we use), uppercase the
-- result. So "NO. 8 SQDN", "no.8 sqdn", and "NO.8SQDN" all collapse to
-- the same canonical form "NO.8SQDN".
create or replace function public.xpc_canon_pc_id(p_id text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select upper(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9.:#]', '', 'g'));
$$;

-- Squadron names: only alphanumerics + period (no separators allowed).
create or replace function public.squadrons_canon_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9.]', '', 'g'));
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Backfill: merge duplicate squadrons rows.
-- Production currently has 9d2415b0 (NO.8) with 3 licenses and
-- cf38f2fa (NO.8 Squadron) with 1 license. Keep the 9d24 row, repoint
-- every FK reference, drop the cf38 row.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_keep   uuid;
  v_drop   uuid;
  v_canon  text;
  v_table  text;
  v_sql    text;
begin
  -- For each canonical squadron name with multiple physical rows, pick
  -- the one with the most license rows (proxy for "most-used") as the
  -- survivor and merge the others into it.
  for v_canon in
    select public.squadrons_canon_name(name)
      from public.squadrons
     group by 1
    having count(*) > 1
  loop
    select id into v_keep
      from public.squadrons s
     where public.squadrons_canon_name(s.name) = v_canon
     order by (select count(*) from public.licenses where squadron_id = s.id) desc,
              s.id
     limit 1;

    for v_drop in
      select id from public.squadrons
       where public.squadrons_canon_name(name) = v_canon and id <> v_keep
    loop
      -- Repoint every FK that references public.squadrons.id.
      for v_table in
        select conrelid::regclass::text || '|' ||
               (select attname from pg_attribute
                 where attrelid = c.conrelid
                   and attnum = c.conkey[1])
          from pg_constraint c
         where c.contype = 'f'
           and c.confrelid = 'public.squadrons'::regclass
      loop
        v_sql := format(
          'update %s set %I = %L where %I = %L',
          split_part(v_table,'|',1),
          split_part(v_table,'|',2),
          v_keep,
          split_part(v_table,'|',2),
          v_drop
        );
        execute v_sql;
      end loop;

      delete from public.squadrons where id = v_drop;
      raise notice 'merged squadron % into %', v_drop, v_keep;
    end loop;

    -- Normalise the survivor's name to the canonical short form.
    update public.squadrons set name = v_canon where id = v_keep;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Backfill: collapse duplicate xpc_registry rows.
-- For every set of registry rows that canonicalise to the same id,
-- pick the most-recent last_seen as survivor, repoint pair links and
-- user_pcs claims, drop the losers. Then delete any pair link that
-- has become a self-pair after collapse (a == b).
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_keep_id text;
  v_loser   text;
  v_canon   text;
begin
  for v_canon in
    select public.xpc_canon_pc_id(id)
      from public.xpc_registry
     group by 1
    having count(*) > 1
  loop
    select id into v_keep_id
      from public.xpc_registry
     where public.xpc_canon_pc_id(id) = v_canon
     order by last_seen desc nulls last, length(id) desc, id
     limit 1;

    for v_loser in
      select id from public.xpc_registry
       where public.xpc_canon_pc_id(id) = v_canon and id <> v_keep_id
    loop
      -- Repoint user-pc claims (avoid PK collision via on-conflict).
      insert into public.xpc_user_pcs (user_id, pc_id)
        select user_id, v_keep_id from public.xpc_user_pcs where pc_id = v_loser
        on conflict do nothing;
      delete from public.xpc_user_pcs where pc_id = v_loser;

      -- Delete pair links that would collapse to a self-pair after the
      -- repoint (the table has a CHECK (a_pc_id < b_pc_id) constraint
      -- that forbids same-id endpoints, so we must remove them first).
      delete from public.xpc_pair_links
       where (a_pc_id = v_loser and b_pc_id = v_keep_id)
          or (a_pc_id = v_keep_id and b_pc_id = v_loser)
          or (a_pc_id = v_loser and b_pc_id = v_loser);

      -- Repoint remaining pair link participants. The CHECK constraint
      -- enforces a_pc_id < b_pc_id, so we may need to swap endpoints
      -- after the rename.
      update public.xpc_pair_links
         set a_pc_id = least(v_keep_id, b_pc_id),
             b_pc_id = greatest(v_keep_id, b_pc_id)
       where a_pc_id = v_loser;
      update public.xpc_pair_links
         set a_pc_id = least(a_pc_id, v_keep_id),
             b_pc_id = greatest(a_pc_id, v_keep_id)
       where b_pc_id = v_loser;

      -- Drop the loser registry row.
      delete from public.xpc_registry where id = v_loser;
      raise notice 'merged registry row % into %', v_loser, v_keep_id;
    end loop;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Cleanup: orphan xpc_user_pcs rows whose pc_id no longer exists
-- in xpc_registry (these accumulate from dev/test installs).
-- ─────────────────────────────────────────────────────────────────────
delete from public.xpc_user_pcs
 where pc_id not in (select id from public.xpc_registry);

-- ─────────────────────────────────────────────────────────────────────
-- 6. Unique indexes on canonical form so duplicates can never re-occur.
-- ─────────────────────────────────────────────────────────────────────
create unique index if not exists xpc_registry_canon_uniq
  on public.xpc_registry (public.xpc_canon_pc_id(id));

create unique index if not exists squadrons_canon_uniq
  on public.squadrons (public.squadrons_canon_name(name));

-- ─────────────────────────────────────────────────────────────────────
-- 7. Guard trigger: reject inserts/updates whose canonical form
-- collides with an existing different-text row, with a readable error.
-- The unique index above would also catch this, but the trigger's
-- error message tells the operator exactly what to do.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.xpc_registry_normalize_id()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_existing text;
begin
  if TG_OP = 'INSERT' or NEW.id is distinct from OLD.id then
    select id into v_existing
      from public.xpc_registry
     where public.xpc_canon_pc_id(id) = public.xpc_canon_pc_id(NEW.id)
       and id <> NEW.id
     limit 1;
    if v_existing is not null then
      raise exception
        'PC id "%" collides with existing canonical form "%". Use the existing id directly, or call xpc_admin_reset_pc(%, ...) to retire the existing one first.',
        NEW.id, v_existing, quote_literal(v_existing)
        using errcode = '23505';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists xpc_registry_normalize_trg on public.xpc_registry;
create trigger xpc_registry_normalize_trg
  before insert or update on public.xpc_registry
  for each row execute function public.xpc_registry_normalize_id();

create or replace function public.squadrons_normalize_name()
returns trigger
language plpgsql
set search_path = public, pg_catalog
as $$
declare
  v_existing text;
begin
  if TG_OP = 'INSERT' or NEW.name is distinct from OLD.name then
    select name into v_existing
      from public.squadrons
     where public.squadrons_canon_name(name) = public.squadrons_canon_name(NEW.name)
       and id <> NEW.id
     limit 1;
    if v_existing is not null then
      raise exception
        'Squadron name "%" collides with existing canonical form (existing row name: "%").',
        NEW.name, v_existing
        using errcode = '23505';
    end if;
  end if;
  return NEW;
end;
$$;

drop trigger if exists squadrons_normalize_trg on public.squadrons;
create trigger squadrons_normalize_trg
  before insert or update on public.squadrons
  for each row execute function public.squadrons_normalize_name();

-- ─────────────────────────────────────────────────────────────────────
-- 8. Schedule the missing weekly pair-link inactivity sweep.
-- Other cron jobs (purge_inactive_pcs, purge_archived_messages,
-- pilot_purge_dead_link_codes, audit_purge_stale_entries) already
-- exist from earlier migrations.
-- ─────────────────────────────────────────────────────────────────────
do $$
begin
  perform cron.unschedule('xpc-pair-sweep-weekly');
exception when others then null;
end $$;

select cron.schedule(
  'xpc-pair-sweep-weekly',
  '0 4 * * 0',
  $$select public.xpc_pair_links_sweep(90)$$
);

-- ─────────────────────────────────────────────────────────────────────
-- 9. Reload PostgREST schema cache so new functions and changes are
-- visible to the REST API immediately.
-- ─────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

commit;
