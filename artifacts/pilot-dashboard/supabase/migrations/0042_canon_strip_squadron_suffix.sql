-- 0042 — Strengthen canonicalisation to collapse "NO.8", "NO.8 SQDN",
-- "NO.8 Squadron" and "NO. 8 SQN" into one canonical form, then re-run
-- the dedup that 0041 left half-finished.
--
-- 0041 stripped non-alphanumerics but did not strip trailing
-- SQDN/SQUADRON/SQN, so "NO.8" and "NO.8 SQDN" stayed separate. The
-- physical PCs are the same — operators just typed different
-- variants — so we need to be more aggressive.

begin;

-- Insert 0041 into the ledger now that we know it succeeded. Future
-- migrations will be inserted by the GitHub Actions pipeline.
insert into public._migration_ledger (filename, applied_by)
values ('0041_identity_normalization_and_automation.sql', 'manual')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Stronger canonicalisation: also strip trailing SQ-suffixes.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.xpc_canon_pc_id(p_id text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  -- Strip every char except [A-Z0-9.:#], uppercase, then strip
  -- trailing SQDN / SQUADRON / SQN (squadron suffixes that operators
  -- type inconsistently). Wing/Base/Flight prefixes are kept because
  -- they are the structural type marker.
  select regexp_replace(
    upper(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9.:#]', '', 'g')),
    '(SQDN|SQUADRON|SQN)$',
    ''
  );
$$;

create or replace function public.squadrons_canon_name(p_name text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  select regexp_replace(
    upper(regexp_replace(coalesce(p_name, ''), '[^A-Za-z0-9.]', '', 'g')),
    '(SQDN|SQUADRON|SQN)$',
    ''
  );
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. The unique indexes from 0041 reference these functions and were
-- built with the older (less aggressive) canonicalisation. Drop and
-- rebuild so they index the new canonical form.
-- ─────────────────────────────────────────────────────────────────────
drop index if exists public.xpc_registry_canon_uniq;
drop index if exists public.squadrons_canon_uniq;

-- ─────────────────────────────────────────────────────────────────────
-- 3. Re-run squadron dedup with the new canon.
-- ─────────────────────────────────────────────────────────────────────
do $$
declare
  v_keep   uuid;
  v_drop   uuid;
  v_canon  text;
  v_table  text;
  v_sql    text;
begin
  for v_canon in
    select public.squadrons_canon_name(name)
      from public.squadrons
     group by 1
    having count(*) > 1
  loop
    select id into v_keep
      from public.squadrons s
     where public.squadrons_canon_name(s.name) = v_canon
     order by (select count(*) from public.licenses where squadron_id = s.id) desc, s.id
     limit 1;

    for v_drop in
      select id from public.squadrons
       where public.squadrons_canon_name(name) = v_canon and id <> v_keep
    loop
      for v_table in
        select conrelid::regclass::text || '|' ||
               (select attname from pg_attribute
                 where attrelid = c.conrelid and attnum = c.conkey[1])
          from pg_constraint c
         where c.contype = 'f' and c.confrelid = 'public.squadrons'::regclass
      loop
        v_sql := format(
          'update %s set %I = %L where %I = %L',
          split_part(v_table,'|',1), split_part(v_table,'|',2), v_keep,
          split_part(v_table,'|',2), v_drop
        );
        execute v_sql;
      end loop;
      delete from public.squadrons where id = v_drop;
      raise notice 'merged squadron % into %', v_drop, v_keep;
    end loop;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 4. Re-run registry dedup with the new canon. Same logic as 0041 but
-- with the suffix-stripped canon, so "NO.8" and "NO. 8 SQDN" now
-- collapse together.
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
    -- Prefer the longest, most-recently-seen id as the survivor (this
    -- usually matches the formal "NO.8 SQDN" form rather than the
    -- short "NO.8").
    select id into v_keep_id
      from public.xpc_registry
     where public.xpc_canon_pc_id(id) = v_canon
     order by last_seen desc nulls last, length(id) desc, id
     limit 1;

    for v_loser in
      select id from public.xpc_registry
       where public.xpc_canon_pc_id(id) = v_canon and id <> v_keep_id
    loop
      insert into public.xpc_user_pcs (user_id, pc_id)
        select user_id, v_keep_id from public.xpc_user_pcs where pc_id = v_loser
        on conflict do nothing;
      delete from public.xpc_user_pcs where pc_id = v_loser;

      delete from public.xpc_pair_links
       where (a_pc_id = v_loser and b_pc_id = v_keep_id)
          or (a_pc_id = v_keep_id and b_pc_id = v_loser)
          or (a_pc_id = v_loser and b_pc_id = v_loser);

      update public.xpc_pair_links
         set a_pc_id = least(v_keep_id, b_pc_id),
             b_pc_id = greatest(v_keep_id, b_pc_id)
       where a_pc_id = v_loser;
      update public.xpc_pair_links
         set a_pc_id = least(a_pc_id, v_keep_id),
             b_pc_id = greatest(a_pc_id, v_keep_id)
       where b_pc_id = v_loser;

      delete from public.xpc_registry where id = v_loser;
      raise notice 'merged registry row % into %', v_loser, v_keep_id;
    end loop;
  end loop;
end $$;

-- ─────────────────────────────────────────────────────────────────────
-- 5. Rebuild unique indexes with the new canon function.
-- ─────────────────────────────────────────────────────────────────────
create unique index xpc_registry_canon_uniq
  on public.xpc_registry (public.xpc_canon_pc_id(id));

create unique index squadrons_canon_uniq
  on public.squadrons (public.squadrons_canon_name(name));

-- ─────────────────────────────────────────────────────────────────────
-- 6. Reload PostgREST schema cache.
-- ─────────────────────────────────────────────────────────────────────
notify pgrst, 'reload schema';

commit;
