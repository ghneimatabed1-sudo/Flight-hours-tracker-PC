#!/usr/bin/env node
// Integration probe for `provision-commander` JWT enforcement.
//
// Audit A defect D-A-01 (audit-2026-04-25) found that the deployed
// `provision-commander` function accepted unauthenticated requests, which
// allowed any internet caller to mint HQ-tier admin accounts. The fix has
// two layers of defence:
//   1. `supabase/config.toml` pins `verify_jwt = true` for the function so
//      the Supabase edge runtime rejects unauth'd requests before our
//      handler runs.
//   2. The function handler itself inspects the caller's JWT claims and
//      enforces a role allow-list of {"ops","admin"}.
//
// This probe asserts the OUTER gate (layer 1) by sending three requests
// that must all fail with HTTP 401:
//   * No Authorization header at all (anonymous request).
//   * Authorization: Bearer <SUPABASE_ANON_KEY> — the anon JWT does not
//     identify a real user.
//   * Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY> — service-role is
//     not a real user JWT either; it's a privileged API key meant for
//     server-to-server use, never for end-user-facing functions.
//
// Run from the repo root after a deploy:
//   SUPABASE_URL="https://<ref>.supabase.co" \
//   SUPABASE_ANON_KEY="<anon>" \
//   SUPABASE_SERVICE_ROLE_KEY="<service>" \
//   node artifacts/pilot-dashboard/supabase/functions/provision-commander/probe-auth.mjs
//
// Exit code 0 = all three probes returned 401 as expected.
// Exit code 1 = at least one probe returned an unexpected status — the
//               function is open to the internet and must be redeployed
//               with `verify_jwt = true` (see supabase/config.toml).

const url  = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const svc  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url) {
  console.error("FATAL: SUPABASE_URL env var is required.");
  process.exit(2);
}
if (!anon) {
  console.error("FATAL: SUPABASE_ANON_KEY env var is required.");
  process.exit(2);
}
if (!svc) {
  console.error("FATAL: SUPABASE_SERVICE_ROLE_KEY env var is required.");
  process.exit(2);
}

const endpoint = `${url.replace(/\/+$/, "")}/functions/v1/provision-commander`;

// Body is intentionally a valid-looking provision request. If the outer
// gate is missing, we want the probe to actually attempt account creation
// so the test fails LOUDLY (with an unexpected 200 / 4xx-other) instead of
// being masked by a JSON parse error inside the handler.
const probeBody = JSON.stringify({
  username: "audit-probe-should-never-exist",
  squadron: { number: 0, name: "PROBE", base: "PROBE" },
  role: "commander",
});

async function probe(label, headers) {
  let res;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: probeBody,
    });
  } catch (e) {
    return { label, ok: false, status: 0, detail: `network error: ${e?.message ?? e}` };
  }
  // Read the body for diagnostics but don't fail if it isn't JSON — the
  // edge runtime returns text/plain "Missing authorization header" for
  // some rejection paths.
  const text = await res.text().catch(() => "");
  return { label, ok: res.status === 401, status: res.status, detail: text.slice(0, 200) };
}

const probes = [
  { label: "no-auth",      headers: {} },
  { label: "anon-bearer",  headers: { Authorization: `Bearer ${anon}`, apikey: anon } },
  { label: "service-role", headers: { Authorization: `Bearer ${svc}`,  apikey: svc  } },
];

const results = [];
for (const p of probes) {
  // Sequential on purpose: keeps logs ordered and avoids hammering the
  // edge runtime if it's having a bad day.
  // eslint-disable-next-line no-await-in-loop
  results.push(await probe(p.label, p.headers));
}

let allPassed = true;
for (const r of results) {
  if (r.ok) {
    console.log(`PASS  ${r.label.padEnd(14)} → ${r.status}`);
  } else {
    allPassed = false;
    console.log(`FAIL  ${r.label.padEnd(14)} → ${r.status}  body=${JSON.stringify(r.detail)}`);
  }
}

if (!allPassed) {
  console.error(
    "\nprovision-commander is NOT enforcing JWT verification on at least one " +
    "probe. Re-deploy with `supabase functions deploy provision-commander` " +
    "(supabase/config.toml pins verify_jwt=true) and re-run this probe.",
  );
  process.exit(1);
}

console.log("\nAll probes returned 401. provision-commander is correctly JWT-gated.");
process.exit(0);
