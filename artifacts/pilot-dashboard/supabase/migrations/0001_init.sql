-- RJAF Squadron Ops — initial schema with squadron-isolated RLS.
-- Apply this to the Supabase project before going to production.

create extension if not exists "pgcrypto";

create table if not exists squadrons (
  id uuid primary key default gen_random_uuid(),
  number text not null,
  name text not null,
  base text not null,
  created_at timestamptz not null default now()
);

create table if not exists licenses (
  key text primary key,
  squadron_id uuid not null references squadrons(id) on delete cascade,
  bound_fingerprint text,
  issued_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz
);

create table if not exists app_users (
  id uuid primary key references auth.users(id) on delete cascade,
  squadron_id uuid not null references squadrons(id) on delete cascade,
  username text not null,
  display_name text not null,
  role text not null check (role in ('ops','deputy','admin','superadmin')),
  created_at timestamptz not null default now()
);

create table if not exists pilots (
  id text primary key,
  squadron_id uuid not null references squadrons(id) on delete cascade,
  rank text not null,
  name text not null,
  arabic_name text,
  unit text,
  phone text,
  data jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists sorties (
  id uuid primary key default gen_random_uuid(),
  squadron_id uuid not null references squadrons(id) on delete cascade,
  pilot_id text not null,
  date date not null,
  data jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id bigserial primary key,
  squadron_id uuid references squadrons(id) on delete cascade,
  type text not null,
  actor text,
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);

-- Helper: read squadron_id from current JWT app_metadata.
create or replace function auth.squadron_id() returns uuid
language sql stable as $$
  select nullif(coalesce(
    current_setting('request.jwt.claims', true)::jsonb #>> '{app_metadata,squadron_id}',
    ''
  ), '')::uuid;
$$;

alter table squadrons   enable row level security;
alter table licenses    enable row level security;
alter table app_users   enable row level security;
alter table pilots      enable row level security;
alter table sorties     enable row level security;
alter table audit_log   enable row level security;

-- Each squadron only sees its own rows.
create policy sq_select on squadrons for select using (id = auth.squadron_id());
create policy lic_select on licenses for select using (squadron_id = auth.squadron_id());
create policy users_rw on app_users for all using (squadron_id = auth.squadron_id()) with check (squadron_id = auth.squadron_id());
create policy pilots_rw on pilots for all using (squadron_id = auth.squadron_id()) with check (squadron_id = auth.squadron_id());
create policy sorties_rw on sorties for all using (squadron_id = auth.squadron_id()) with check (squadron_id = auth.squadron_id());
create policy audit_insert on audit_log for insert with check (squadron_id is null or squadron_id = auth.squadron_id());
create policy audit_select on audit_log for select using (squadron_id = auth.squadron_id());
