#!/usr/bin/env node
// One-shot backfill — Task #272.
//
// Migration 0061 (`xpc_squadron_snapshot` SELECT policy lockdown) fail-closes
// the read path for any wing/base/HQ commander whose JWT does NOT carry an
// `app_metadata.squadron_ids` claim covering the squadrons they monitor.
// Commanders provisioned BEFORE the claim was wired into provision-commander
// therefore see empty dashboards even though their license_registry row
// authorises them. This script closes the gap by reading the registry,
// resolving authorised squadron uuids → squadron names (the value
// xpc_squadron_snapshot.squadron_id actually holds — see SquadronSnapshot
// publisher in App.tsx), and stamping the names into raw_app_meta_data.
//
// The corresponding edge-function patches (provision-commander,
// register-license, heal-claims) ensure new accounts never fall back into
// this gap. This script is for the historical install base only.
//
// Usage:
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node artifacts/pilot-dashboard/supabase/scripts/backfill-commander-squadron-ids.mjs
//
// Flags:
//   --dry-run   Print the planned changes without touching auth users.
//   --verbose   Print already-covered users too (otherwise they are silent).

import { createClient } from "@supabase/supabase-js";

const SUPA_URL = process.env.SUPABASE_URL;
const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPA_URL || !SERVICE_ROLE) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars.");
  process.exit(1);
}

const DRY_RUN = process.argv.includes("--dry-run");
const VERBOSE = process.argv.includes("--verbose");
const TARGET_TIERS = new Set(["wing", "base", "hq"]);

const admin = createClient(SUPA_URL, SERVICE_ROLE, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function toLower(s) {
  return (s ?? "").toString().trim().toLowerCase();
}

async function main() {
  console.log(`[backfill-272] mode=${DRY_RUN ? "dry-run" : "apply"}`);

  // 1. Pull the entire license registry. assignedUsername lives inside meta;
  //    open RLS on this table allows the service role free read access.
  const { data: registry, error: regErr } = await admin
    .from("license_registry")
    .select("id, full_key, meta");
  if (regErr) {
    console.error("Failed reading license_registry:", regErr.message);
    process.exit(2);
  }
  console.log(`[backfill-272] license_registry rows: ${registry.length}`);

  // 2. Pull every squadron (uuid + canonical name) so we can translate the
  //    registry's authorizedSquadronIds (uuids) into the names that the
  //    snapshot.squadron_id text column carries.
  const { data: squadrons, error: sqErr } = await admin
    .from("squadrons")
    .select("id, name, number");
  if (sqErr) {
    console.error("Failed reading squadrons:", sqErr.message);
    process.exit(2);
  }
  const sqByUuid = new Map(squadrons.map((s) => [s.id, s]));
  const allSquadronNames = squadrons
    .map((s) => s.name)
    .filter((n) => typeof n === "string" && n.length > 0);

  // 3. Group registry entries by lowercased assignedUsername. A single
  //    commander may hold multiple keys; we union all authorizedSquadronIds.
  const regByUsername = new Map();
  for (const row of registry) {
    const meta = row.meta ?? {};
    const u = toLower(meta.assignedUsername);
    if (!u) continue;
    const arr = regByUsername.get(u) ?? [];
    arr.push({ id: row.id, meta });
    regByUsername.set(u, arr);
  }
  console.log(`[backfill-272] distinct assignedUsername values: ${regByUsername.size}`);

  // 4. Walk auth users in pages. Only wing/base/HQ tier are candidates.
  let scanned = 0;
  let candidates = 0;
  let alreadyOk = 0;
  let healed = 0;
  let failed = 0;
  const unmapped = [];
  let page = 1;
  const PAGE_SIZE = 1000;

  for (;;) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) {
      console.error("listUsers failed:", error.message);
      process.exit(3);
    }
    const users = data?.users ?? [];
    if (users.length === 0) break;

    for (const u of users) {
      scanned++;
      const meta = (u.app_metadata ?? {});
      const tier = meta.tier;
      if (!TARGET_TIERS.has(tier)) continue;
      candidates++;

      const existing = Array.isArray(meta.squadron_ids)
        ? meta.squadron_ids.filter((x) => typeof x === "string" && x.length > 0)
        : [];

      // Inspect xpc_user_pcs as a secondary coverage signal — a commander
      // with explicit user-pc bindings already passes the snapshot RLS check
      // for those squadrons.
      const { data: pcsRows, error: pcsErr } = await admin
        .from("xpc_user_pcs")
        .select("pc_id")
        .eq("user_id", u.id);
      if (pcsErr) {
        console.warn(`[backfill-272] xpc_user_pcs lookup failed for ${u.id}: ${pcsErr.message}`);
      }
      const pcs = (pcsRows ?? []).map((r) => r.pc_id).filter(Boolean);

      const email = (u.email ?? "").toLowerCase();
      const username = email.split("@")[0] ?? "";

      // Find license_registry rows assigned to this username.
      const regRows = regByUsername.get(username) ?? [];
      const desiredUuids = new Set();
      for (const r of regRows) {
        const auth = Array.isArray(r.meta.authorizedSquadronIds) ? r.meta.authorizedSquadronIds : [];
        for (const id of auth) desiredUuids.add(id);
      }
      const desiredNames = [];
      for (const id of desiredUuids) {
        const sq = sqByUuid.get(id);
        if (sq?.name) desiredNames.push(sq.name);
      }
      // HQ tier with no explicit registry list defaults to every known
      // squadron — that is the operational expectation (HQ sees everything).
      // Wing/base tiers require an explicit registry mapping.
      let desired = Array.from(new Set(desiredNames)).sort();
      if (desired.length === 0 && tier === "hq") {
        desired = Array.from(new Set(allSquadronNames)).sort();
      }

      const have = new Set([...existing, ...pcs]);
      const fullyCovered =
        desired.length > 0 && desired.every((n) => have.has(n));

      if (fullyCovered) {
        alreadyOk++;
        if (VERBOSE) {
          console.log(`OK   ${username} tier=${tier} have=${[...have].join(",") || "(none)"}`);
        }
        continue;
      }

      if (desired.length === 0) {
        unmapped.push({ id: u.id, username, tier, email });
        continue;
      }

      const next = { ...meta, squadron_ids: desired };
      if (DRY_RUN) {
        console.log(`PLAN ${username} tier=${tier} squadron_ids=[${desired.join(", ")}]`);
        healed++;
        continue;
      }

      // Audit-first ordering: write the audit row BEFORE mutating the
      // auth user. If audit_log refuses the insert we abort the heal so
      // there is no chance of a silently-modified JWT claim with no
      // forensic trail. Both writes go through the service role so the
      // only realistic failure modes are network blips or a future RLS
      // tightening — either of which we want to surface, not swallow.
      const { error: auErr } = await admin.from("audit_log").insert({
        squadron_id: meta.squadron_id ?? null,
        type: "commander.squadron_ids.backfill",
        actor: "backfill-task-272",
        detail: {
          user_id: u.id,
          username,
          tier,
          previous_squadron_ids: existing,
          squadron_ids: desired,
          source: regRows.length > 0 ? "license_registry" : "all_squadrons_default",
          script: "backfill-commander-squadron-ids.mjs",
        },
      });
      if (auErr) {
        console.error(`FAIL ${username}: audit insert refused: ${auErr.message}`);
        failed++;
        continue;
      }

      const { error: updErr } = await admin.auth.admin.updateUserById(u.id, { app_metadata: next });
      if (updErr) {
        console.error(`FAIL ${username}: ${updErr.message} (audit row was written and now points to a heal that did not happen — investigate manually)`);
        failed++;
        continue;
      }

      healed++;
      console.log(`HEAL ${username} tier=${tier} squadron_ids=[${desired.join(", ")}]`);
    }

    if (users.length < PAGE_SIZE) break;
    page++;
  }

  console.log("");
  console.log(`[backfill-272] scanned: ${scanned} auth users`);
  console.log(`[backfill-272] candidates (tier ∈ wing/base/hq): ${candidates}`);
  console.log(`[backfill-272] already covered: ${alreadyOk}`);
  console.log(`[backfill-272] healed${DRY_RUN ? " (planned)" : ""}: ${healed}`);
  if (failed > 0) console.log(`[backfill-272] failed: ${failed}`);
  if (unmapped.length > 0) {
    console.log(`[backfill-272] unmapped (no license_registry match): ${unmapped.length}`);
    for (const u of unmapped) {
      console.log(`  - ${u.username} tier=${u.tier} email=${u.email}`);
    }
    console.log("[backfill-272] unmapped commanders need manual provisioning — re-issue their license key or stamp squadron_ids by hand.");
  }
  if (failed > 0) process.exit(4);
}

main().catch((err) => {
  console.error("[backfill-272] fatal:", err);
  process.exit(99);
});
