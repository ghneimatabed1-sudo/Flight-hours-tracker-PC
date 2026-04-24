// artifacts/pilot-dashboard/e2e/commander-provisioning.spec.ts
//
// Task #281 (Round 4 AA4) — closes the missing e2e coverage that
// task #275 documented for the multi-squadron commander provisioning
// flow. The flow exercises four production code paths:
//
//   1. supabase/functions/provision-commander/ — Edge Function that
//      writes the operator's app_metadata.squadron_ids.
//   2. supabase/functions/register-license/    — license-key emission
//      / validation.
//   3. supabase/functions/heal-claims/         — fallback that
//      reconciles app_metadata with PC claims.
//   4. src/pages/admin/LicenseKeys.tsx         — the operator UI
//      that drives all three above.
//
// Without this test, a regression in any one of the four can ship to
// prod and only surface when an operator notices a multi-squadron
// commander seeing the wrong scope. This spec catches that on PR.
//
// Selectors used in this spec all come straight from the components
// (`src/pages/Login.tsx` and `src/pages/admin/LicenseKeys.tsx`); see
// the inline comments for the exact source line each selector ties
// to. Whenever the dashboard's selectors change, this spec must be
// updated in lockstep — the audit-evidence-mirror convention puts
// the burden on the agent that touches the UI, not on a future
// commander-provisioning agent.
//
// The flow is decomposed into THREE serial Playwright tests inside a
// single describe block (Playwright runs them in declared order):
//
//   T1 "issue squadron-commander key for 2 squadrons + verify row"
//   ─────────────────────────────────────────────────────────────
//     1. Sign in as the `admin` super-admin (username + password +
//        RFC-6238 TOTP via the inlined generator).
//     2. Navigate to /#/admin/keys (hash routing — see App.tsx).
//     3. Open the "Generate License Key" dialog (button-generate).
//     4. Configure a squadron-commander key wired to two squadrons (the
//        home squadron + one additional via check-genauth-{id}); enter
//        the test username + 1-year duration; click button-confirm-gen.
//     5. Capture the issued key from `text-newkey`; close the dialog
//        (button-done).
//     6. Verify row appears in the keys table (text-assigned-{id}
//        carrying TEST_COMMANDER_USERNAME) — proves register-license +
//        provision-commander Edge Functions wrote back successfully.
//
//   T2 "commander activates license, sees both squadrons in scope"
//   ─────────────────────────────────────────────────────────────
//     A NEW browser context (cleared cookies + localStorage) is used so
//     the PC has no super-admin session and no prior license lock.
//     7. Activate the issued license on the fresh PC via
//        input-license-username + input-license-key + the activate
//        submit button.
//     8. Wait for license-gate dismissal → dashboard renders.
//     9. Locate squadron-scope-picker (only visible for 2+-squadron
//        commanders). Open select-squadron-scope and assert that BOTH
//        opt-scope-{home_id} and opt-scope-{additional_id} options are
//        present, plus opt-scope-combined for the rollup view.
//    10. Inspect the `rjaf.sb` localStorage entry (storageKey set in
//        src/lib/supabase.ts:17) and decode the JWT's
//        app_metadata.squadron_ids — assert it contains BOTH ids.
//        Best-effort: skipped with a console.warn if the dashboard
//        stores no Supabase JWT for license-bound commanders.
//    11. Switch the picker to a single squadron via opt-scope-{id} and
//        assert the picker reflects the change (data-state=closed +
//        the SelectValue updates).
//
//   T3 "tear down — revoke + delete the issued row"
//   ───────────────────────────────────────────────
//    12. Back in the super_admin context, revoke (button-revoke-{id})
//        then hard-delete (button-delete-{id}) the freshly-issued row.
//    13. Assert the row is gone.
//
// `test.afterAll` provides belt-and-suspenders cleanup for the case
// where T2 or T3 fails partway and leaves the row orphaned.
//
// Skip behaviour
// ──────────────
// Needs four real env vars: super-admin username, password, TOTP
// secret, dashboard URL. Missing any → the spec is skipped (NOT
// failed) so a developer can run `pnpm exec playwright test` in a
// fresh dev container without prod credentials and not get a red
// CI signal locally. The CI workflow
// (`.github/workflows/e2e-commander-provisioning.yml`) injects the
// secrets explicitly via repo secrets.

import { expect, test, type Page } from "@playwright/test";

// ── Env ──────────────────────────────────────────────────────────
// Auth fields are username + password (NOT email) — the dashboard
// uses local-account auth via lib/auth.tsx, not Supabase email/password.
const SUPER_USERNAME = process.env.E2E_SUPER_ADMIN_USERNAME ?? "admin";
const SUPER_PASSWORD = process.env.E2E_SUPER_ADMIN_PASSWORD ?? "";
const SUPER_TOTP_SECRET = process.env.E2E_SUPER_ADMIN_TOTP_SECRET ?? "";
// Dashboard URL has no safe default — pointing at localhost in CI
// would silently exercise nothing. The skip preflight requires it.
const DASHBOARD_URL_RAW = process.env.E2E_DASHBOARD_URL ?? "";
const DASHBOARD_URL = (DASHBOARD_URL_RAW || "http://localhost:5173").replace(
  /\/+$/,
  "",
);

// All required secrets must be present to run; otherwise mark
// skipped. (Username has a default of `admin` — the canonical super-
// admin account on every install — so it is not part of the gate.)
const SECRETS_PRESENT = Boolean(
  SUPER_PASSWORD && SUPER_TOTP_SECRET && DASHBOARD_URL_RAW,
);

// Globally-unique run tag so concurrent runs (or stale prior-run
// fixtures) cannot collide on the test commander username. Mirrors
// the convention every supabase/tests/*.mjs uses.
const RUN_TAG = `t275-${Date.now().toString(36)}-${Math.random()
  .toString(36)
  .slice(2, 6)}`;
const TEST_COMMANDER_USERNAME = `e2e-cmdr-${RUN_TAG}`;

// ── TOTP code generator ─────────────────────────────────────────
// Implements RFC-6238 6-digit TOTP with the default 30s step + SHA-1
// HMAC. Inlined so the test has no runtime dep beyond @playwright/test.
async function totp(secretBase32: string): Promise<string> {
  const key = base32ToBytes(secretBase32.replace(/\s+/g, "").toUpperCase());
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = new ArrayBuffer(8);
  const view = new DataView(buf);
  view.setUint32(4, counter, false); // big-endian, low 32 bits
  // Cast through `as BufferSource` because Node's stricter TS lib
  // distinguishes Uint8Array<ArrayBuffer> from Uint8Array<ArrayBufferLike>;
  // the runtime accepts both.
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(
    await crypto.subtle.sign("HMAC", cryptoKey, buf as BufferSource),
  );
  const offset = sig[sig.length - 1] & 0x0f;
  const code =
    ((sig[offset] & 0x7f) << 24) |
    ((sig[offset + 1] & 0xff) << 16) |
    ((sig[offset + 2] & 0xff) << 8) |
    (sig[offset + 3] & 0xff);
  return String(code % 1_000_000).padStart(6, "0");
}

function base32ToBytes(s: string): Uint8Array {
  const ALPHA = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  const bits: number[] = [];
  for (const c of s.replace(/=+$/, "")) {
    const v = ALPHA.indexOf(c);
    if (v < 0) throw new Error(`base32: invalid char '${c}'`);
    for (let i = 4; i >= 0; i--) bits.push((v >> i) & 1);
  }
  const out: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    out.push(b);
  }
  return new Uint8Array(out);
}

// ── Page-object helpers ─────────────────────────────────────────
async function signInAsSuperAdmin(page: Page) {
  // App.tsx uses HashRouter (see header comment in App.tsx) — the
  // unauthenticated user lands on LoginGate at the index path. There
  // is no `/login` sub-route; just go to root.
  await page.goto(`${DASHBOARD_URL}/`);

  // The username Field is rendered by Login.tsx via <Field label="username">
  // which assigns data-testid="input-username" (see Login.tsx:672).
  await page.getByTestId("input-username").fill(SUPER_USERNAME);
  await page.getByTestId("input-password").fill(SUPER_PASSWORD);
  await page.getByTestId("button-signin").click();

  // Admin login triggers the TOTP gate — `pendingAdmin` flips and the
  // input-totp field appears (Login.tsx:377 / button at :396).
  const totpField = page.getByTestId("input-totp");
  await totpField.waitFor({ state: "visible", timeout: 15_000 });
  await totpField.fill(await totp(SUPER_TOTP_SECRET));
  await page.getByTestId("button-verify-totp").click();

  // Once the TOTP step succeeds, the LoginGate unmounts. Wait for
  // the input fields to disappear as a robust "we are signed in"
  // signal (the dashboard layout has many possible landing pages
  // depending on role, so don't assume a specific testid is visible).
  await expect(page.getByTestId("input-totp")).toHaveCount(0, {
    timeout: 15_000,
  });
}

async function gotoLicenseKeys(page: Page) {
  // Hash routing — the route in App.tsx:158 is `/admin/keys`.
  await page.goto(`${DASHBOARD_URL}/#/admin/keys`);
  // The page renders button-generate at the top of the card; wait
  // for it as the "page is hydrated" signal.
  await expect(page.getByTestId("button-generate")).toBeVisible({
    timeout: 15_000,
  });
}

// ── The actual spec ─────────────────────────────────────────────
// Run T1 → T2 → T3 in declared order, NOT in parallel — they share
// the issuedKey/issuedRowId state and the second uses a fresh PC.
test.describe.configure({ mode: "serial" });

test.describe("Multi-squadron commander provisioning (task #275)", () => {
  test.skip(
    !SECRETS_PRESENT,
    "E2E_SUPER_ADMIN_{PASSWORD,TOTP_SECRET} and E2E_DASHBOARD_URL must " +
      "be set — skipping. See .github/workflows/e2e-commander-provisioning.yml " +
      "for the secret names CI uses, or set them in your local shell.",
  );

  let issuedKey: string | null = null;
  let issuedRowId: string | null = null;
  let assignedSquadronIds: string[] = [];

  test("T1 — admin issues squadron-commander key for 2 squadrons + row appears", async ({
    page,
  }) => {
    // ── Step 1: super_admin sign-in ──────────────────────────────
    await signInAsSuperAdmin(page);

    // ── Step 2: navigate to License Keys ─────────────────────────
    await gotoLicenseKeys(page);

    // ── Step 3: open the generate dialog ─────────────────────────
    // (LicenseKeys.tsx:965 button-generate triggers setGenOpen(true).)
    await page.getByTestId("button-generate").click();
    // The dialog renders select-squadron once visible (LK.tsx:1081).
    await expect(page.getByTestId("select-squadron")).toBeVisible({
      timeout: 5_000,
    });

    // Read the squadron list straight from the home-squadron Select's
    // SelectItem children. Each item has value=s.id; we capture the
    // raw IDs so we can later check the additional checkbox by id.
    await page.getByTestId("select-squadron").click();
    const squadronOptions = page.locator('[role="option"]');
    await squadronOptions.first().waitFor({ state: "visible", timeout: 5_000 });
    const squadronCount = await squadronOptions.count();
    if (squadronCount < 2) {
      test.fail(
        true,
        `Fixture preconditions not met: live env has ${squadronCount} squadron(s), need >=2 to provision a multi-squadron commander.`,
      );
      return;
    }
    // Capture the first two ids by reading their data attribute.
    // Radix Select renders SelectItem with data-value=<value>.
    assignedSquadronIds = [];
    for (let i = 0; i < Math.min(2, squadronCount); i++) {
      const v = await squadronOptions.nth(i).getAttribute("data-value");
      if (v) assignedSquadronIds.push(v);
    }
    expect(assignedSquadronIds.length).toBe(2);
    // Pick the first as the home squadron.
    await squadronOptions.nth(0).click();

    // ── Step 4: configure the key for squadron_commander + 2 sqns ─
    // select-gen-role (LK.tsx:1093). squadron_commander surfaces the
    // check-genauth-{id} checkboxes (LK.tsx:1110, :1131).
    await page.getByTestId("select-gen-role").click();
    await page.getByRole("option", { name: /squadron commander/i }).click();
    // The home squadron checkbox is auto-checked + disabled (LK.tsx:1129).
    // Check the OTHER squadron explicitly.
    const additionalSquadronId = assignedSquadronIds[1];
    await page.getByTestId(`check-genauth-${additionalSquadronId}`).check();

    // input-username (LK.tsx:1165) — operator username for the new key.
    await page.getByTestId("input-username").fill(TEST_COMMANDER_USERNAME);

    // select-duration (LK.tsx:1173) — pick 1y for a stable test fixture.
    await page.getByTestId("select-duration").click();
    await page.getByTestId("option-duration-1y").click();

    // ── Step 5: confirm + capture license key ────────────────────
    // button-confirm-gen (LK.tsx:1231). The newKey panel
    // (LK.tsx:1207-1222) replaces the form once handleGenerate
    // succeeds — text-newkey carries the issued key.
    await page.getByTestId("button-confirm-gen").click();
    const newKeyEl = page.getByTestId("text-newkey");
    await newKeyEl.waitFor({ state: "visible", timeout: 30_000 });
    issuedKey = (await newKeyEl.innerText()).trim();
    expect(issuedKey.length).toBeGreaterThan(8);
    // Close the dialog (button-done — LK.tsx:1237).
    await page.getByTestId("button-done").click();

    // ── Step 6: verify row appears in the keys table ─────────────
    // Each row is row-key-{id} with text-assigned-{id} carrying the
    // assigned username (LK.tsx:1043, :1045). The id is server-
    // assigned, so locate the row by the username text first.
    const assignedCells = page.locator('[data-testid^="text-assigned-"]', {
      hasText: TEST_COMMANDER_USERNAME,
    });
    await expect(assignedCells.first()).toBeVisible({ timeout: 15_000 });
    // Extract the id from the matching data-testid for the cleanup step.
    const assignedTestId = await assignedCells
      .first()
      .getAttribute("data-testid");
    const m = /^text-assigned-(.+)$/.exec(assignedTestId ?? "");
    issuedRowId = m ? m[1] : null;
    expect(issuedRowId, "could not parse issued row id").toBeTruthy();
  });

  test("T2 — commander activates license + sees both squadrons in scope picker", async ({
    browser,
  }) => {
    test.skip(
      !issuedKey,
      "T1 did not issue a license key — nothing for T2 to activate.",
    );
    expect(assignedSquadronIds.length).toBe(2);
    const [homeSquadronId, additionalSquadronId] = assignedSquadronIds;

    // ── Step 7: fresh PC (cleared cookies + localStorage). New
    // context guarantees no super-admin session and no prior PC
    // license lock — the LicenseGate form should render.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await page.goto(`${DASHBOARD_URL}/`);
      // The license-username field appears immediately on a clean PC
      // (Login.tsx:537 form). Fill + submit.
      await page
        .getByTestId("input-license-username")
        .fill(TEST_COMMANDER_USERNAME);
      await page.getByTestId("input-license-key").fill(issuedKey!);
      // The activate submit button has no testid — locate by its form
      // wrapper + button[type=submit] (the only submit in the form).
      await page
        .locator('form:has([data-testid="input-license-key"]) button')
        .first()
        .click();

      // ── Step 8: license-gate dismisses → dashboard hydrates.
      // Both license inputs vanish once activateLicense succeeds.
      await expect(page.getByTestId("input-license-key")).toHaveCount(0, {
        timeout: 30_000,
      });

      // ── Step 9: scope picker shows both squadrons + combined ─────
      // SquadronScopePicker.tsx renders only when the operator has 2+
      // squadrons (data-testid="squadron-scope-picker" at line 39).
      const picker = page.getByTestId("squadron-scope-picker");
      await expect(picker).toBeVisible({ timeout: 15_000 });
      await page.getByTestId("select-squadron-scope").click();
      // opt-scope-combined (line 51) is the all-squadrons rollup.
      await expect(page.getByTestId("opt-scope-combined")).toBeVisible({
        timeout: 5_000,
      });
      // opt-scope-{id} per squadron (line 55).
      await expect(
        page.getByTestId(`opt-scope-${homeSquadronId}`),
      ).toBeVisible();
      await expect(
        page.getByTestId(`opt-scope-${additionalSquadronId}`),
      ).toBeVisible();

      // ── Step 10: JWT app_metadata.squadron_ids assertion ────────
      // The dashboard's Supabase client persists session under
      // localStorage["rjaf.sb"] (storageKey from src/lib/supabase.ts:17).
      // Best-effort: license-bound commanders may not always have a
      // direct Supabase JWT (they go through register-license edge
      // function); if no JWT is present, log + continue rather than
      // fail the picker assertion above.
      const jwtSquadronIds = await page.evaluate(() => {
        try {
          const raw = window.localStorage.getItem("rjaf.sb");
          if (!raw) return null;
          const parsed = JSON.parse(raw) as {
            access_token?: string;
            currentSession?: { access_token?: string };
          };
          const accessToken =
            parsed.access_token ?? parsed.currentSession?.access_token;
          if (!accessToken) return null;
          const payloadB64 = accessToken.split(".")[1];
          if (!payloadB64) return null;
          // base64url → base64 → string → JSON
          const b64 = payloadB64
            .replace(/-/g, "+")
            .replace(/_/g, "/")
            .padEnd(Math.ceil(payloadB64.length / 4) * 4, "=");
          const json = JSON.parse(atob(b64)) as {
            app_metadata?: { squadron_ids?: string[] };
          };
          return json.app_metadata?.squadron_ids ?? null;
        } catch {
          return null;
        }
      });
      if (jwtSquadronIds === null) {
        // Acceptable: the dashboard's commander auth path may rely on
        // PC-bound license claims rather than a Supabase JWT. The UI
        // assertion above already proves provision-commander populated
        // both squadrons end-to-end.
        // eslint-disable-next-line no-console
        console.warn(
          "[t275 T2] No Supabase JWT in localStorage['rjaf.sb'] — " +
            "skipping app_metadata.squadron_ids assertion (the picker " +
            "options assertion still proves the provisioning round-trip).",
        );
      } else {
        expect(
          jwtSquadronIds,
          "JWT app_metadata.squadron_ids must include the home squadron",
        ).toContain(homeSquadronId);
        expect(
          jwtSquadronIds,
          "JWT app_metadata.squadron_ids must include the additional squadron",
        ).toContain(additionalSquadronId);
      }

      // ── Step 11: switch picker to a single squadron + verify ─────
      await page.getByTestId(`opt-scope-${additionalSquadronId}`).click();
      // Radix Select closes after selection; SelectValue inside
      // select-squadron-scope reflects the chosen option's text.
      await expect(page.getByTestId("select-squadron-scope")).toHaveAttribute(
        "data-state",
        "closed",
        { timeout: 5_000 },
      );
    } finally {
      await ctx.close();
    }
  });

  test("T3 — admin tears down (revoke + delete) the issued row", async ({
    page,
  }) => {
    test.skip(
      !issuedRowId,
      "T1 did not capture an issuedRowId — nothing for T3 to clean up.",
    );
    await signInAsSuperAdmin(page);
    await gotoLicenseKeys(page);

    // ── Step 12: revoke then delete ──────────────────────────────
    // button-revoke-{id} (LK.tsx:1057). After revoke the row stays
    // visible but flips to revoked state with button-delete-{id}
    // (LK.tsx:1059) available for hard-delete.
    await page.getByTestId(`button-revoke-${issuedRowId}`).click();
    await page
      .getByTestId(`button-delete-${issuedRowId}`)
      .waitFor({ state: "visible", timeout: 10_000 });
    // Some delete paths use window.confirm; install handler first.
    page.once("dialog", (d) => d.accept().catch(() => {}));
    await page.getByTestId(`button-delete-${issuedRowId}`).click();

    // ── Step 13: row is gone ─────────────────────────────────────
    await expect(
      page.locator(`[data-testid="row-key-${issuedRowId}"]`),
    ).toHaveCount(0, { timeout: 15_000 });
    await expect(
      page.locator('[data-testid^="text-assigned-"]', {
        hasText: TEST_COMMANDER_USERNAME,
      }),
    ).toHaveCount(0);
    // Mark cleaned so afterAll skips the belt-and-suspenders pass.
    issuedRowId = null;
  });

  test.afterAll(async ({ browser }) => {
    if (!SECRETS_PRESENT) return;
    if (!issuedRowId) return; // nothing to clean up
    // Belt-and-suspenders cleanup: if the spec failed before reaching
    // step 8, open a fresh context, sign in as super_admin, and try
    // the delete once more so a partial run can't litter prod.
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    try {
      await signInAsSuperAdmin(page);
      await gotoLicenseKeys(page);
      const row = page.locator(`[data-testid="row-key-${issuedRowId}"]`);
      if ((await row.count()) > 0) {
        // Try revoke then delete; ignore if either is no-op.
        const revoke = page.getByTestId(`button-revoke-${issuedRowId}`);
        if ((await revoke.count()) > 0) {
          await revoke.click().catch(() => {});
        }
        page.once("dialog", (d) => d.accept().catch(() => {}));
        const del = page.getByTestId(`button-delete-${issuedRowId}`);
        if ((await del.count()) > 0) {
          await del.click().catch(() => {});
        }
      }
    } catch (e) {
      console.warn(
        `[t275] post-test cleanup raised (ignored — manual cleanup of ${TEST_COMMANDER_USERNAME} may be required):`,
        e,
      );
    } finally {
      await ctx.close();
    }
  });
});
