// Round-7 acceptance test for the user-management role gate.
//
// The api-server's lan-users-reminders router is the only LAN write
// path for `lan_users`. The reviewer's first round-7 finding was that
// every commander tier (squadron, wing, base) and the ops officer were
// silently allowed to create / edit / delete user accounts because the
// gate fell back to "any authenticated lan_user". The new gate
// restricts writes to `super_admin` and `admin` only — every other
// role is read-only and the api-server enforces the same rule.
//
// This test pins that behaviour at the helper level so a future
// refactor cannot quietly re-open the door without breaking CI.
//
// Run with:
//   pnpm --filter @workspace/pilot-dashboard run test:lan-user-role-gate

import { test } from "node:test";
import assert from "node:assert/strict";
import { __testing__ } from "../../api-server/src/routes/lan-users-reminders";

const { canManageUsers, canReadUser } = __testing__;

test("super_admin and admin may manage users", () => {
  assert.equal(canManageUsers("super_admin"), true);
  assert.equal(canManageUsers("admin"), true);
  // case / whitespace tolerance via normalizeLanRole
  assert.equal(canManageUsers("  Admin  "), true);
  assert.equal(canManageUsers("SUPER_ADMIN"), true);
});

test("commander tiers and ops are read-only for user management", () => {
  for (const role of [
    "ops",
    "commander_squadron",
    "commander_wing",
    "commander_base",
    "commander", // legacy alias
    "deputy",
  ]) {
    assert.equal(
      canManageUsers(role),
      false,
      `${role} must NOT be able to create / edit / delete user accounts`,
    );
  }
});

test("unknown / null / empty roles cannot manage users", () => {
  assert.equal(canManageUsers(null), false);
  assert.equal(canManageUsers(undefined), false);
  assert.equal(canManageUsers(""), false);
  assert.equal(canManageUsers("guest"), false);
  assert.equal(canManageUsers("pilot"), false);
});

test("canReadUser: super_admin / admin see every row", () => {
  for (const role of ["super_admin", "admin"]) {
    assert.equal(
      canReadUser(
        { role, squadron_id: "S1", wing_id: "W1", base_id: "B1" },
        { squadron_id: "S99", wing_id: "W99", base_id: "B99" },
      ),
      true,
    );
  }
});

test("canReadUser: ops only sees own squadron", () => {
  const actor = { role: "ops", squadron_id: "S1", wing_id: "W1", base_id: "B1" };
  assert.equal(canReadUser(actor, { squadron_id: "S1" }), true);
  assert.equal(canReadUser(actor, { squadron_id: "S2" }), false);
  // wing/base IDs alone don't grant read for ops
  assert.equal(canReadUser(actor, { squadron_id: "S2", wing_id: "W1" }), false);
});

test("canReadUser: commander_wing sees same wing OR own squadron", () => {
  const actor = { role: "commander_wing", squadron_id: "S1", wing_id: "W1", base_id: "B1" };
  assert.equal(canReadUser(actor, { squadron_id: "S2", wing_id: "W1" }), true,
    "same wing -> visible");
  assert.equal(canReadUser(actor, { squadron_id: "S1", wing_id: "W2" }), true,
    "own squadron fallback");
  assert.equal(canReadUser(actor, { squadron_id: "S2", wing_id: "W2" }), false,
    "different wing & different squadron -> hidden");
  // empty wing IDs must NOT match each other
  const noWing = { role: "commander_wing", squadron_id: "S1", wing_id: "", base_id: "" };
  assert.equal(canReadUser(noWing, { squadron_id: "S2", wing_id: "" }), false);
});

test("canReadUser: commander_base sees same base OR own squadron", () => {
  const actor = { role: "commander_base", squadron_id: "S1", wing_id: "W1", base_id: "B1" };
  assert.equal(canReadUser(actor, { squadron_id: "S2", base_id: "B1" }), true,
    "same base -> visible");
  assert.equal(canReadUser(actor, { squadron_id: "S1", base_id: "B2" }), true,
    "own squadron fallback");
  assert.equal(canReadUser(actor, { squadron_id: "S2", base_id: "B2" }), false,
    "different base & different squadron -> hidden");
});

test("canReadUser: unknown role denies everything", () => {
  const actor = { role: "guest", squadron_id: "S1", wing_id: "W1", base_id: "B1" };
  assert.equal(canReadUser(actor, { squadron_id: "S1" }), false);
});
