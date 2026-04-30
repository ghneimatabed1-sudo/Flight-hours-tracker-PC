import { pool } from "@workspace/db";

/**
 * Idempotent full-schema bootstrap for the LAN api-server.
 *
 * Called once on every boot. Creates *every* table the internal route
 * surface reads or writes — operator accounts, sessions, audit log,
 * wings/bases (multi-tier RBAC), domain tables (pilots, sorties,
 * squadrons, currencies, leaves, unavailable, schedule, alerts,
 * notams, saved_duty_weeks), reminder tables, and the cross-PC mesh
 * (xpc_*).
 *
 * Every statement is `IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS` /
 * `ON CONFLICT DO NOTHING` so it is safe to call against:
 *   - an empty Postgres database (fresh install on a new host PC), or
 *   - a database from a previous Hawk Eye build (existing install).
 *
 * The exported name is kept as `ensureLanAuthSchema` for back-compat
 * with `index.ts` callers; `ensureFullSchema` is the new alias new
 * code should use.
 */
export async function ensureFullSchema(): Promise<void> {
  // ── Operator accounts ───────────────────────────────────────────────
  await pool.query(`
    create table if not exists lan_users (
      id text primary key,
      username text not null,
      display_name text not null default '',
      role text not null,
      squadron_id text,
      password_hash text not null,
      created_at timestamptz not null default now()
    );
    create unique index if not exists lan_users_username_lower_idx
      on lan_users (lower(username));
  `);
  // Multi-tier scope columns: nullable so existing single-squadron
  // installs keep working unchanged; only commander_wing /
  // commander_base rows use them.
  await pool.query(`
    alter table lan_users add column if not exists wing_id text;
    alter table lan_users add column if not exists base_id text;
    alter table lan_users add column if not exists disabled_at timestamptz;
  `);

  // ── Session tokens ──────────────────────────────────────────────────
  await pool.query(`
    create table if not exists lan_sessions (
      id text primary key,
      user_id text not null references lan_users (id) on delete cascade,
      token text not null,
      created_at timestamptz not null default now(),
      expires_at timestamptz not null
    );
    create unique index if not exists lan_sessions_token_idx on lan_sessions (token);
  `);

  // ── Audit log ───────────────────────────────────────────────────────
  await pool.query(`
    create table if not exists audit_log (
      id bigserial primary key,
      occurred_at timestamptz not null default now(),
      actor text,
      type text not null,
      detail jsonb
    );
    create index if not exists audit_log_occurred_at_idx
      on audit_log (occurred_at desc);
    create index if not exists audit_log_actor_idx on audit_log (actor);
  `);

  // ── Wings & bases (multi-tier RBAC) ─────────────────────────────────
  await pool.query(`
    create table if not exists wings (
      id text primary key,
      name text not null,
      created_at timestamptz not null default now()
    );
    create table if not exists bases (
      id text primary key,
      name text not null,
      wing_id text references wings (id) on delete set null,
      created_at timestamptz not null default now()
    );
  `);

  // ── Squadrons ──────────────────────────────────────────────────────
  // The Setup Wizard / migration 0039 schema the dashboard expects is
  // (id, number, name, base, wing, default_aircraft, default_monthly_targets).
  // We additionally carry `wing_id` / `base_id` UUID-style refs into the
  // multi-tier `wings` / `bases` tables, used by the new commander_wing /
  // commander_base RBAC. Both shapes coexist: legacy text columns
  // (`base`, `wing`) remain the source of truth for display + setup
  // wizard JSON, while `wing_id` / `base_id` drive scope authorisation.
  await pool.query(`
    create table if not exists squadrons (
      id uuid primary key default gen_random_uuid(),
      number text not null,
      name text,
      base text,
      wing text,
      default_aircraft jsonb,
      default_monthly_targets jsonb,
      wing_id text references wings (id) on delete set null,
      base_id text references bases (id) on delete set null,
      created_at timestamptz not null default now()
    );
    create unique index if not exists squadrons_number_idx on squadrons (number);
  `);
  // Idempotent column adds for upgraded installs whose squadrons table
  // pre-dated one of the columns above.
  await pool.query(`
    alter table squadrons add column if not exists base text;
    alter table squadrons add column if not exists wing text;
    alter table squadrons add column if not exists default_aircraft jsonb;
    alter table squadrons add column if not exists default_monthly_targets jsonb;
    alter table squadrons add column if not exists wing_id text references wings (id) on delete set null;
    alter table squadrons add column if not exists base_id text references bases (id) on delete set null;
  `);

  // ── Pilots ──────────────────────────────────────────────────────────
  await pool.query(`
    create table if not exists pilots (
      id text primary key,
      squadron_id uuid references squadrons (id) on delete set null,
      rank text,
      rank_en text,
      name text,
      arabic_name text,
      unit text,
      phone text,
      available boolean not null default true,
      data jsonb,
      created_at timestamptz not null default now(),
      updated_at timestamptz not null default now()
    );
    create index if not exists pilots_squadron_idx on pilots (squadron_id);
  `);

  // ── Sorties ─────────────────────────────────────────────────────────
  await pool.query(`
    create table if not exists sorties (
      id uuid primary key default gen_random_uuid(),
      squadron_id uuid references squadrons (id) on delete set null,
      pilot_id text references pilots (id) on delete cascade,
      co_pilot_id text references pilots (id) on delete set null,
      date date not null,
      ac_type text,
      ac_number text,
      sortie_type text,
      sortie_name text,
      data jsonb,
      created_by text,
      created_at timestamptz not null default now()
    );
    create index if not exists sorties_pilot_idx on sorties (pilot_id);
    create index if not exists sorties_date_idx on sorties (date desc);
    create index if not exists sorties_squadron_idx on sorties (squadron_id);
  `);

  // ── Currencies ──────────────────────────────────────────────────────
  await pool.query(`
    create table if not exists currencies (
      id uuid primary key default gen_random_uuid(),
      pilot_id text references pilots (id) on delete cascade,
      squadron_id uuid references squadrons (id) on delete set null,
      key text not null,
      expiry_date date,
      data jsonb,
      updated_at timestamptz not null default now()
    );
    create index if not exists currencies_pilot_idx on currencies (pilot_id);
  `);

  // ── Leaves (annual leave allotments) ────────────────────────────────
  // Schema matches GET /api/internal/leaves in ops-read-lan.ts which
  // selects (pilot_id, year, months) filtered by year — i.e. one row
  // per pilot per year listing the months they're scheduled to be
  // away. squadron_id is kept (and added on legacy DBs) so that
  // pilots-transfer.ts can re-home leave rows on transfer.
  await pool.query(`
    create table if not exists leaves (
      id uuid primary key default gen_random_uuid(),
      pilot_id text references pilots (id) on delete cascade,
      squadron_id uuid references squadrons (id) on delete set null,
      year int,
      months jsonb,
      from_date date,
      to_date date,
      reason text,
      created_at timestamptz not null default now()
    );
    alter table leaves
      add column if not exists year int,
      add column if not exists months jsonb,
      add column if not exists squadron_id uuid;
    create index if not exists leaves_pilot_idx on leaves (pilot_id);
    create index if not exists leaves_year_idx on leaves (year);
  `);

  // ── Unavailable windows ─────────────────────────────────────────────
  // squadron_id is required because pilots-transfer.ts updates it
  // directly (not wrapped in runOptionalUpdate) when re-homing a
  // pilot, so an empty-DB bootstrap must include the column.
  await pool.query(`
    create table if not exists unavailable (
      id uuid primary key default gen_random_uuid(),
      pilot_id text references pilots (id) on delete cascade,
      squadron_id uuid references squadrons (id) on delete set null,
      from_date date not null,
      to_date date not null,
      reason text,
      created_at timestamptz not null default now()
    );
    alter table unavailable
      add column if not exists squadron_id uuid;
    create index if not exists unavailable_pilot_idx on unavailable (pilot_id);
    create index if not exists unavailable_dates_idx on unavailable (from_date, to_date);
  `);

  // ── Saved duty weeks (cached schedule snapshots) ────────────────────
  await pool.query(`
    create table if not exists saved_duty_weeks (
      squadron text not null,
      start_date date not null,
      rows jsonb not null,
      saved_at timestamptz not null default now(),
      primary key (squadron, start_date)
    );
  `);

  // ── Duty week (rolling 7-day duty roster) ───────────────────────────
  // GET /api/internal/duty-week reads (day, main_duty, standby, rcm)
  // ordered by effective_from desc limit 7. The table holds one row
  // per duty day; effective_from is the publication timestamp so the
  // most recent revision wins.
  await pool.query(`
    create table if not exists duty_week (
      id uuid primary key default gen_random_uuid(),
      day date,
      main_duty text,
      standby text,
      rcm text,
      effective_from timestamptz not null default now()
    );
    create index if not exists duty_week_effective_from_idx
      on duty_week (effective_from desc);
  `);

  // ── Daily schedule (read-only here; populated by ops UI) ────────────
  await pool.query(`
    create table if not exists schedule (
      id uuid primary key default gen_random_uuid(),
      flight_date date not null,
      takeoff time,
      data jsonb,
      created_at timestamptz not null default now()
    );
    create index if not exists schedule_flight_date_idx on schedule (flight_date);
  `);

  // ── Ops-board surfaces: alerts + NOTAMs ─────────────────────────────
  await pool.query(`
    create table if not exists alerts (
      id uuid primary key default gen_random_uuid(),
      posted_at timestamptz not null default now(),
      body text not null,
      author text,
      priority text
    );
    create index if not exists alerts_posted_at_idx on alerts (posted_at desc);
  `);
  await pool.query(`
    create table if not exists notams (
      id uuid primary key default gen_random_uuid(),
      notam_no text not null,
      posted_on date not null,
      body text not null,
      priority text,
      created_at timestamptz not null default now()
    );
    create index if not exists notams_posted_on_idx on notams (posted_on desc);
  `);

  // ── Pilot device + link-code tables (mobile pairing) ────────────────
  // Column shapes match exactly what routes/pilot-links-internal.ts
  // queries — linked_at / last_seen_at / revoked_at / token_hash on
  // devices, and code_hash / issued_at / consumed_at on link codes.
  // SHA-256 hex hashes are 64 chars; we use text to keep it portable.
  // We also ALTER … ADD COLUMN IF NOT EXISTS so a legacy DB that
  // already has the older `pilot_devices` / `pilot_link_codes` shapes
  // (from earlier bootstrap revisions) is upgraded in place rather
  // than failing the index create. Index create is split out and
  // runs after the ALTERs so it always sees the new columns.
  // The legacy pilot_link_codes had `code text primary key` and no
  // `code_hash` / `issued_at` / `consumed_at` columns. The new
  // pilot-links-internal.ts INSERT doesn't supply `code`, which would
  // violate the legacy NOT NULL primary key. Detect that legacy shape
  // and drop the table so the CREATE below builds the new shape.
  // Same defensive drop applies if anyone wired an older `id text`
  // primary key; only safe because the table holds short-lived link
  // codes (no durable audit value), so wiping during bring-up is OK.
  await pool.query(`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'pilot_link_codes'
          and column_name = 'code'
      ) then
        drop table pilot_link_codes;
      end if;
    end $$;
  `);
  await pool.query(`
    create table if not exists pilot_devices (
      id uuid primary key default gen_random_uuid(),
      pilot_id text references pilots (id) on delete cascade,
      squadron_id uuid references squadrons (id) on delete set null,
      device_label text,
      token_hash text,
      linked_at timestamptz not null default now(),
      last_seen_at timestamptz not null default now(),
      revoked_at timestamptz,
      created_at timestamptz not null default now()
    );
    alter table pilot_devices
      add column if not exists token_hash text,
      add column if not exists linked_at timestamptz not null default now(),
      add column if not exists last_seen_at timestamptz not null default now(),
      add column if not exists revoked_at timestamptz;
    create index if not exists pilot_devices_pilot_idx
      on pilot_devices (pilot_id, linked_at desc);
    create index if not exists pilot_devices_active_idx
      on pilot_devices (revoked_at) where revoked_at is null;
    create table if not exists pilot_link_codes (
      id bigserial primary key,
      code_hash text,
      pilot_id text references pilots (id) on delete cascade,
      squadron_id uuid references squadrons (id) on delete set null,
      issued_at timestamptz not null default now(),
      expires_at timestamptz not null,
      consumed_at timestamptz,
      created_at timestamptz not null default now()
    );
    alter table pilot_link_codes
      add column if not exists code_hash text,
      add column if not exists issued_at timestamptz not null default now(),
      add column if not exists consumed_at timestamptz;
    create unique index if not exists pilot_link_codes_code_hash_idx
      on pilot_link_codes (code_hash);
    create index if not exists pilot_link_codes_pilot_active_idx
      on pilot_link_codes (pilot_id, issued_at desc)
      where consumed_at is null;
  `);

  // ── Reminder scheduler tables ───────────────────────────────────────
  await pool.query(`
    create table if not exists pilot_reminder_prefs (
      pilot_id text primary key references pilots (id) on delete cascade,
      thresholds jsonb,
      push_enabled boolean not null default false,
      expo_push_token text,
      platform text,
      updated_at timestamptz not null default now()
    );
    create table if not exists pilot_currency_notifications (
      id bigserial primary key,
      pilot_id text references pilots (id) on delete cascade,
      currency_key text not null,
      expiry_date date,
      threshold_days int,
      sent_at timestamptz not null default now()
    );
    create index if not exists pcn_pilot_sent_idx
      on pilot_currency_notifications (pilot_id, sent_at desc);
  `);

  // Reminder scheduler tables. Column shapes match exactly what
  // routes/reminders-internal.ts reads/writes (and what its own
  // inline ensureReminderSchema() uses), so the bootstrap and the
  // lazy in-route create stay byte-compatible. We DROP any legacy
  // earlier-revision shapes here (id text + payload + next_run_at
  // for the schedule table; ran_at/result for runs; called_at/url/
  // status/detail for http) and recreate, because the column types
  // are incompatible (int vs text primary keys) and there is no
  // production data on these tables yet (LAN bring-up). Drop is
  // gated on the legacy column existing so we never wipe a live
  // already-migrated table.
  await pool.query(`
    do $$
    begin
      if exists (
        select 1 from information_schema.columns
        where table_name = 'hawk_reminder_schedule_local'
          and column_name = 'payload'
      ) then
        drop table hawk_reminder_schedule_local;
      end if;
      if exists (
        select 1 from information_schema.columns
        where table_name = 'hawk_reminder_runs_local'
          and column_name = 'ran_at'
      ) then
        drop table hawk_reminder_runs_local;
      end if;
      if exists (
        select 1 from information_schema.columns
        where table_name = 'hawk_reminder_http_local'
          and column_name = 'called_at'
      ) then
        drop table hawk_reminder_http_local;
      end if;
    end $$;
    create table if not exists hawk_reminder_schedule_local (
      id int primary key check (id = 1),
      enabled boolean not null default false,
      schedule text not null default '0 6 * * *',
      updated_at timestamptz not null default now()
    );
    insert into hawk_reminder_schedule_local (id, enabled, schedule)
    values (1, false, '0 6 * * *')
    on conflict (id) do nothing;
    create table if not exists hawk_reminder_runs_local (
      runid bigserial primary key,
      start_time timestamptz not null default now(),
      end_time timestamptz,
      status text not null default 'succeeded',
      return_message text
    );
    create table if not exists hawk_reminder_http_local (
      id bigserial primary key,
      status_code int,
      error_msg text,
      created timestamptz not null default now(),
      content_preview text
    );
  `);

  // ── Cross-PC mesh (XPC) ─────────────────────────────────────────────
  await pool.query(`
    create table if not exists xpc_registry (
      id text primary key,
      squadron_name text,
      tier text,
      base text,
      wing text,
      device_name text,
      last_seen timestamptz not null default now(),
      parent_pc_id text,
      squadron_pc_id text
    );
    create table if not exists xpc_user_pcs (
      pc_id text primary key,
      user_id text,
      claimed_at timestamptz not null default now()
    );
    create table if not exists xpc_messages (
      id text primary key,
      thread_id text,
      from_pc_id text,
      from_pc_name text,
      from_tier text,
      from_user text,
      from_display_name text,
      from_rank text,
      from_seat_label text,
      to_pc_id text,
      to_pc_name text,
      to_tier text,
      subject text,
      body text,
      priority text,
      sent_at timestamptz not null default now(),
      read_at timestamptz,
      in_history boolean not null default false
    );
    create index if not exists xpc_messages_thread_idx on xpc_messages (thread_id);
    create index if not exists xpc_messages_to_pc_idx on xpc_messages (to_pc_id);
    create table if not exists xpc_pending (
      id text primary key,
      hosting_squadron_id text,
      hosting_squadron_name text,
      home_squadron_id text,
      home_squadron_name text,
      guest_pilot_name text,
      guest_pilot_military_number text,
      guest_seat text,
      sortie jsonb,
      submitted_at timestamptz not null default now(),
      submitted_by text,
      submitter_display_name text,
      submitter_rank text,
      submitter_seat_label text,
      status text not null default 'pending',
      decided_at timestamptz,
      decided_by text,
      decision_reason text,
      edited_sortie jsonb
    );
    create table if not exists xpc_pair_codes (
      code text primary key,
      host_pc_id text,
      host_tier text,
      host_squadron text,
      host_user_display text,
      host_user_seat text,
      expires_at timestamptz not null,
      consumed_at timestamptz,
      consumed_by_pc_id text
    );
    create table if not exists xpc_pair_links (
      a_pc_id text not null,
      b_pc_id text not null,
      a_tier text,
      b_tier text,
      a_squadron text,
      b_squadron text,
      a_user_display text,
      b_user_display text,
      a_user_seat text,
      b_user_seat text,
      kind text,
      paired_by_label text,
      justification text,
      expires_at timestamptz,
      permanent boolean,
      revoked_at timestamptz,
      revoked_reason text,
      paired_at timestamptz not null default now(),
      last_activity_at timestamptz not null default now(),
      primary key (a_pc_id, b_pc_id)
    );
    create table if not exists xpc_pair_audit (
      id bigserial primary key,
      at timestamptz not null default now(),
      action text,
      actor text,
      detail jsonb
    );
    -- Per-squadron snapshot blob published by an OPS PC and read by the
    -- chain. routes/xpc-snapshots.ts upserts on conflict (squadron_id),
    -- so squadron_id must be the primary key.
    create table if not exists xpc_squadron_snapshot (
      squadron_id text primary key,
      ops_pc_id text not null,
      snapshot_at timestamptz not null default now(),
      payload jsonb not null default '{}'::jsonb
    );
    create index if not exists xpc_squadron_snapshot_at_idx
      on xpc_squadron_snapshot (snapshot_at desc);
    -- Schedule share envelopes pushed up the squadron→wing→base chain.
    -- Column shapes match exactly what routes/xpc-schedule-shares.ts
    -- inserts/updates (chain_pc_ids and rejected_by_pc_ids are text[],
    -- rows/baseline_rows/history/edited_rows/program/edited_program
    -- are jsonb).
    create table if not exists xpc_schedule_shares (
      id text primary key,
      flight_date date not null,
      origin_squadron_id text not null,
      origin_squadron_name text,
      current_tier text not null default 'squadron',
      current_pc_id text,
      current_pc_name text,
      status text not null default 'submitted',
      rows jsonb not null default '[]'::jsonb,
      baseline_rows jsonb not null default '[]'::jsonb,
      history jsonb not null default '[]'::jsonb,
      edited_rows jsonb,
      edited_by text,
      program jsonb,
      edited_program jsonb,
      chain_pc_ids text[] not null default '{}',
      approved_at timestamptz,
      approved_by text,
      rejected_by_pc_ids text[] not null default '{}',
      originator_dismissed_at timestamptz,
      updated_at timestamptz not null default now()
    );
    create index if not exists xpc_schedule_shares_status_idx
      on xpc_schedule_shares (status);
    create index if not exists xpc_schedule_shares_flight_date_idx
      on xpc_schedule_shares (flight_date desc, updated_at desc);
  `);

  // ── Install profile + multi-PC peer plumbing ────────────────────────
  // install_profile_meta: single-row record of what this PC first booted
  // as. peer_tokens: hub-issued read tokens. peer_squadrons: aggregator's
  // list of hubs to fan out to. peer_cache: last successful read from
  // each peer (lets the dashboard show stale data when a hub is offline).
  await pool.query(`
    create table if not exists install_profile_meta (
      id int primary key check (id = 1),
      profile text not null,
      first_booted_at timestamptz not null default now(),
      last_seen_profile text,
      last_seen_at timestamptz not null default now()
    );
    alter table install_profile_meta
      add column if not exists last_seen_profile text,
      add column if not exists last_seen_at timestamptz not null default now();

    create table if not exists peer_tokens (
      id uuid primary key default gen_random_uuid(),
      token_hash text not null,
      label text,
      scope text not null default 'squadron-read',
      issued_at timestamptz not null default now(),
      issued_by text,
      expires_at timestamptz,
      revoked_at timestamptz,
      revoked_by text,
      last_used_at timestamptz
    );
    create unique index if not exists peer_tokens_token_hash_idx
      on peer_tokens (token_hash);
    create index if not exists peer_tokens_active_idx
      on peer_tokens (revoked_at) where revoked_at is null;

    create table if not exists peer_squadrons (
      id uuid primary key default gen_random_uuid(),
      squadron_id text not null,
      squadron_name text,
      base_url text not null,
      token_hash text,
      auth_token text,
      added_at timestamptz not null default now(),
      added_by text,
      last_ok_at timestamptz,
      last_error text,
      last_error_at timestamptz,
      removed_at timestamptz
    );
    -- auth_token holds the plaintext bearer credential the aggregator
    -- must send to the peer hub on every request. token_hash is the
    -- SHA-256 mirror of that same secret, kept for parity with the
    -- hub-side peer_tokens table and to support a future "rotate
    -- token" UI without re-storing the plaintext. Both columns are
    -- additive on legacy installs (added_at the time peer_squadrons
    -- itself was first introduced) so the ALTER below is the
    -- idempotent path for an already-bootstrapped DB.
    alter table peer_squadrons
      add column if not exists auth_token text;
    create unique index if not exists peer_squadrons_squadron_idx
      on peer_squadrons (squadron_id) where removed_at is null;

    create table if not exists peer_cache (
      peer_squadron_id uuid not null references peer_squadrons (id) on delete cascade,
      kind text not null,
      payload jsonb not null,
      fetched_at timestamptz not null default now(),
      primary key (peer_squadron_id, kind)
    );
    create index if not exists peer_cache_fetched_at_idx
      on peer_cache (fetched_at desc);
  `);
}

/**
 * Back-compat alias. `index.ts` and any external caller can keep using
 * the old name; new callers should prefer `ensureFullSchema`.
 */
export const ensureLanAuthSchema = ensureFullSchema;
