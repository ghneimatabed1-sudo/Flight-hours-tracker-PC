-- 0043 — Tighten canonicalisation scope and harden the registry merge.
--
-- Code review of 0041/0042 caught three issues that would bite us
-- once the system grows past one squadron:
--
--  1. Suffix-stripping was too aggressive. "WING:NORTH-SQDN" would
--     canonicalise to "WING:NORTH" and collide with a legitimate
--     "WING:NORTH" registration. We now only strip squadron suffixes
--     from IDs that are bare squadron names (no `:` namespace marker
--     and no `#` seat marker).
--
--  2. The xpc_pair_links repoint inside the merge loop could hit a
--     PK collision when both `(X, loser)` and `(X, keep)` already
--     exist. We now pre-delete the colliding rows.
--
--  3. squadrons_canon_name had the same over-eager suffix strip and
--     could collapse "ALPHA" with "ALPHA SQUADRON" — which is
--     actually intended for squadron names, but only when the names
--     differ ONLY by the suffix. The new rule preserves that
--     behaviour.

begin;

insert into public._migration_ledger (filename, applied_by)
values ('0043_canon_scope_and_merge_safety.sql', 'self')
on conflict do nothing;

-- ─────────────────────────────────────────────────────────────────────
-- 1. Tighten xpc_canon_pc_id: only strip squadron suffix when the id
-- has no namespace separator. So:
--   NO.8                  → NO.8         (bare name, no suffix to strip)
--   NO.8 SQDN             → NO.8         (bare, suffix stripped)
--   NO. 8 SQUADRON        → NO.8         (bare, suffix stripped)
--   WING:NORTH            → WING:NORTH   (namespaced, untouched)
--   WING:NORTH-SQDN       → WING:NORTHSQDN  (namespaced, suffix kept)
--   FLIGHT:NO.8#ALPHA     → FLIGHT:NO.8#ALPHA
-- ─────────────────────────────────────────────────────────────────────
create or replace function public.xpc_canon_pc_id(p_id text)
returns text
language sql
immutable
set search_path = public, pg_catalog
as $$
  with stripped as (
    select upper(regexp_replace(coalesce(p_id, ''), '[^A-Za-z0-9.:#]', '', 'g')) as s
  )
  select case
    -- Bare squadron-name form (no namespace, no seat marker): apply
    -- the suffix strip so casing/whitespace variants collapse.
    when s !~ '[:#]' then regexp_replace(s, '(SQDN|SQUADRON|SQN)$', '')
    -- Namespaced form (WING:..., BASE:..., FLIGHT:...): leave the
    -- suffix alone. WING:NORTH and WING:NORTH-SQDN are different PCs.
    else s
  end from stripped;
$$;

-- ─────────────────────────────────────────────────────────────────────
-- 2. Squadron name canon is unchanged in spirit, but documented:
-- squadron names are always bare (never namespaced) so suffix-strip
-- is always safe here.
-- ─────────────────────────────────────────────────────────────────────
-- (squadrons_canon_name from 0042 is already correct; no rewrite.)

-- ─────────────────────────────────────────────────────────────────────
-- 3. Rebuild the unique index on xpc_registry now that the canon
-- function changed. Drop and recreate so it indexes the new form.
-- ─────────────────────────────────────────────────────────────────────
drop index if exists public.xpc_registry_canon_uniq;
create unique index xpc_registry_canon_uniq
  on public.xpc_registry (public.xpc_canon_pc_id(id));

-- ─────────────────────────────────────────────────────────────────────
-- 4. Replace the dedup-on-merge logic with a collision-safe version.
-- This is wrapped in a function so future migrations can call it,
-- and so the merge step in 0041/0042 has a successor that handles
-- the (X, loser) / (X, keep) collision case correctly.
-- ─────────────────────────────────────────────────────────────────────
create or replace function public._xpc_merge_registry_duplicates()
returns void
language plpgsql
set search_path = public, pg_catalog
as $$
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
      -- repoint user-pc claims
      insert into public.xpc_user_pcs (user_id, pc_id)
        select user_id, v_keep_id from public.xpc_user_pcs where pc_id = v_loser
        on conflict do nothing;
      delete from public.xpc_user_pcs where pc_id = v_loser;

      -- Pre-delete pair links that would collide after repoint:
      --   * direct loser↔keep links (would become self-pair)
      --   * loser↔X where keep↔X already exists (would PK-collide)
      delete from public.xpc_pair_links
       where (a_pc_id = v_loser and b_pc_id = v_keep_id)
          or (a_pc_id = v_keep_id and b_pc_id = v_loser)
          or (a_pc_id = v_loser and b_pc_id = v_loser);

      delete from public.xpc_pair_links pl
       where pl.a_pc_id = v_loser
         and exists (
           select 1 from public.xpc_pair_links pl2
            where ((pl2.a_pc_id = least(v_keep_id, pl.b_pc_id)
                and pl2.b_pc_id = greatest(v_keep_id, pl.b_pc_id)))
              and (pl2.a_pc_id, pl2.b_pc_id) <> (pl.a_pc_id, pl.b_pc_id)
         );
      delete from public.xpc_pair_links pl
       where pl.b_pc_id = v_loser
         and exists (
           select 1 from public.xpc_pair_links pl2
            where ((pl2.a_pc_id = least(v_keep_id, pl.a_pc_id)
                and pl2.b_pc_id = greatest(v_keep_id, pl.a_pc_id)))
              and (pl2.a_pc_id, pl2.b_pc_id) <> (pl.a_pc_id, pl.b_pc_id)
         );

      -- Now safe to repoint remaining rows; CHECK (a < b) requires us
      -- to swap endpoints if needed.
      update public.xpc_pair_links
         set a_pc_id = least(v_keep_id, b_pc_id),
             b_pc_id = greatest(v_keep_id, b_pc_id)
       where a_pc_id = v_loser;
      update public.xpc_pair_links
         set a_pc_id = least(a_pc_id, v_keep_id),
             b_pc_id = greatest(a_pc_id, v_keep_id)
       where b_pc_id = v_loser;

      delete from public.xpc_registry where id = v_loser;
    end loop;
  end loop;
end;
$$;

-- Run the safer version in case the new (tighter) canon revealed any
-- new collisions that 0041/0042 missed because of the over-aggressive
-- canon. On current prod data this is a no-op — only 1 registry row.
select public._xpc_merge_registry_duplicates();

notify pgrst, 'reload schema';

commit;
