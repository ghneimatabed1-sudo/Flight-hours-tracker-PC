-- 0037 — Multi-squadron org chart hierarchy.
--
-- Operator-stated chain (DOMAIN.md §7.1, restated 2026-04-23):
--   Ops PC ↔ Flight Cmdr (interactive ping-pong, multiple round trips OK)
--   Flight Cmdr → Sqn Cmdr (after Flight approves)
--   Sqn Cmdr ↔ Flight Cmdr (edit-bounce) OR Sqn Cmdr → Wing Cmdr (after approve)
--   Wing Cmdr → Base Cmdr (Base approves = final archive)
-- Hard rule: Ops cannot reach Wing or Base or Sqn Cmdr directly.
--
-- For multi-squadron deployments (5-20+ squadrons), the chain needs a real
-- org chart so each Sqn Cmdr's "forward to Wing" goes ONLY to that
-- squadron's parent Wing Cmdr — not to every Wing PC in the country.
--
-- This migration is purely additive. Every column is nullable so the
-- existing single-squadron install keeps working unchanged. The UI falls
-- back to today's behaviour when parent_pc_id is not set, with a
-- "setup-incomplete" warning. Once the operator pins parents in
-- Settings → Chain Setup, the dropdowns lock to the org chart.

-- ── Tables: bases, wings ─────────────────────────────────────────────────
create table if not exists public.bases (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.wings (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  base_id uuid references public.bases(id) on delete restrict,
  created_at timestamptz not null default now()
);
create index if not exists wings_base_idx on public.wings(base_id);

-- ── Columns: squadrons get wing_id + base_id (nullable until backfill) ──
alter table public.squadrons
  add column if not exists wing_id uuid references public.wings(id) on delete restrict,
  add column if not exists base_id uuid references public.bases(id) on delete restrict;
create index if not exists squadrons_wing_idx on public.squadrons(wing_id);
create index if not exists squadrons_base_idx on public.squadrons(base_id);

-- ── xpc_registry gets the parent-PC pointer + structured wing/base ids ──
-- parent_pc_id is the heart of the routing fix. Each Squadron PC declares
-- "my parent is Wing PC <id>"; each Wing PC declares "my parent is Base PC
-- <id>". Forward dropdowns then filter `p.id = myParentPcId` instead of
-- listing every wing/base PC in the registry.
alter table public.xpc_registry
  add column if not exists parent_pc_id text,
  add column if not exists wing_id uuid references public.wings(id) on delete set null,
  add column if not exists base_id uuid references public.bases(id) on delete set null,
  -- For Flight PCs: which Squadron PC do we belong under? Lets a Sqn Cmdr's
  -- "down-chain to Flight" picker show only their own flights.
  add column if not exists squadron_pc_id text;
create index if not exists xpc_registry_parent_idx on public.xpc_registry(parent_pc_id);
create index if not exists xpc_registry_squadron_pc_idx on public.xpc_registry(squadron_pc_id);

-- ── RLS: org chart is non-secret reference data ─────────────────────────
alter table public.bases enable row level security;
alter table public.wings enable row level security;

drop policy if exists bases_read on public.bases;
create policy bases_read on public.bases
  for select to authenticated using (true);

drop policy if exists wings_read on public.wings;
create policy wings_read on public.wings
  for select to authenticated using (true);

-- Writes to bases/wings are restricted to service_role (no policy = denied
-- for authenticated). Operators add new wings/bases by running an admin
-- INSERT through the Supabase dashboard, OR via a future Settings → Org
-- Chart screen that calls a SECURITY DEFINER RPC. Keeping writes locked
-- prevents a compromised commander account from rewriting the org chart.

-- ── Backfill helper RPC for the operator to call manually ───────────────
-- Reads the existing free-text base/wing strings from squadrons and
-- xpc_registry, dedups them by trimmed name, and pins each squadron/PC
-- to a row in the new tables. Idempotent — safe to re-run.
create or replace function public.xpc_backfill_org_chart()
returns table(action text, name text)
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  -- 1. bases from squadrons.base
  for r in (select distinct trim(base) as nm from public.squadrons where base is not null and trim(base) <> '') loop
    insert into public.bases (name) values (r.nm) on conflict (name) do nothing;
    return query select 'base'::text, r.nm;
  end loop;
  -- 2. bases from xpc_registry.base (in case wing/base PCs declared bases unknown to squadrons)
  for r in (select distinct trim(base) as nm from public.xpc_registry where base is not null and trim(base) <> '') loop
    insert into public.bases (name) values (r.nm) on conflict (name) do nothing;
  end loop;
  -- 3. wings from xpc_registry.wing (squadrons table has no wing yet)
  for r in (select distinct trim(wing) as nm, trim(base) as bnm from public.xpc_registry where wing is not null and trim(wing) <> '') loop
    insert into public.wings (name, base_id)
      values (r.nm, (select id from public.bases where name = r.bnm))
      on conflict (name) do update set base_id = excluded.base_id where public.wings.base_id is null;
    return query select 'wing'::text, r.nm;
  end loop;
  -- 4. backfill squadrons.base_id from squadrons.base
  update public.squadrons s
     set base_id = b.id
    from public.bases b
   where b.name = trim(s.base) and s.base_id is null;
  -- 5. backfill xpc_registry.base_id / wing_id from text columns
  update public.xpc_registry r
     set base_id = b.id
    from public.bases b
   where b.name = trim(r.base) and r.base_id is null;
  update public.xpc_registry r
     set wing_id = w.id
    from public.wings w
   where w.name = trim(r.wing) and r.wing_id is null;
end;
$$;
grant execute on function public.xpc_backfill_org_chart() to authenticated;

comment on function public.xpc_backfill_org_chart() is
  'Reads existing free-text base/wing strings from squadrons + xpc_registry, dedups, and populates the new bases/wings tables and FK columns. Idempotent. Operator runs once after applying 0037, then verifies the result before calling out renames or merges.';
