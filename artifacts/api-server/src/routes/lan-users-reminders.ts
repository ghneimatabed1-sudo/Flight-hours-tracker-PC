import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { hashPassword } from "../lib/password";
import { requireInternalWriteSecret } from "../lib/internal-write-auth";
import { appendInternalAudit } from "../lib/internal-audit";
import { buildSquadronReadFilter, normalizeLanRole, readLanUser } from "../lib/lan-authz";

const router: IRouter = Router();

const ASSIGNABLE_ROLES = new Set([
  "deputy",
  "ops",
  "commander_squadron",
  "commander_wing",
  "commander_base",
]);

/**
 * Roles that may create / edit / delete other LAN users.
 *
 * Hawk Eye keeps user-account mutation locked to the host-PC
 * super_admin and the admin tier — every other role (including
 * commanders at every echelon and the squadron ops officer) is
 * READ-ONLY for `lan_users`. This matches the production-readiness
 * requirement that "commanders are read-only and write rules are
 * unchanged" and prevents a same-scope ops or commander actor from
 * resetting another user's password or deleting accounts (including
 * privileged ones if the scope happens to match).
 *
 * If product later approves delegated provisioning, widen this set
 * deliberately and add explicit tests, instead of treating every
 * commander tier as a writer by default.
 */
function canManageUsers(roleRaw: string | null | undefined): boolean {
  const role = normalizeLanRole(roleRaw);
  return role === "admin" || role === "super_admin";
}

function isMissingTableError(err: unknown): boolean {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01";
}

function trimOrNull(v: unknown): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

/**
 * Decide whether `actor` is allowed to **read** a user row belonging to
 * `(targetSquadronId, targetWingId, targetBaseId)`.
 *
 * Used for GET /users filtering only — write paths are gated by
 * `canManageUsers` (super_admin/admin only) and ignore this helper.
 *
 *  - super_admin / admin: see every row.
 *  - commander_wing:      same wing_id, OR same squadron when wing_id
 *                         is missing on either side.
 *  - commander_base:      same base_id, OR same squadron fallback.
 *  - ops / commander* :   same squadron only.
 *  - unknown:             nothing.
 */
function canReadUser(
  actor: { role?: string | null; squadron_id?: string | null; wing_id?: string | null; base_id?: string | null },
  target: { squadron_id?: string | null; wing_id?: string | null; base_id?: string | null },
): boolean {
  const role = normalizeLanRole(actor.role);
  if (role === "super_admin" || role === "admin") return true;

  const same = (a: string | null | undefined, b: string | null | undefined) =>
    (a ?? "").trim().toLowerCase() === (b ?? "").trim().toLowerCase()
    && (a ?? "").trim() !== "";

  if (role === "commander_wing") {
    return same(actor.wing_id, target.wing_id) || same(actor.squadron_id, target.squadron_id);
  }
  if (role === "commander_base") {
    return same(actor.base_id, target.base_id) || same(actor.squadron_id, target.squadron_id);
  }
  if (role === "ops" || role === "commander_squadron" || role === "commander") {
    return same(actor.squadron_id, target.squadron_id);
  }
  return false;
}

router.get("/users", async (req, res, next) => {
  try {
    const q = await pool.query<{
      id: string;
      username: string;
      display_name: string | null;
      role: string;
      squadron_id: string | null;
      wing_id: string | null;
      base_id: string | null;
      disabled_at: string | null;
      created_at: string;
    }>(
      `
      select id, username, display_name, role, squadron_id, wing_id, base_id, disabled_at, created_at
      from lan_users
      order by created_at asc
      `,
    );
    const lanUser = readLanUser(req);
    const rows = q.rows;
    const filtered = lanUser
      ? rows.filter((r) => canReadUser(lanUser, r))
      : rows;
    res.json({ items: filtered });
  } catch (err) {
    if (isMissingTableError(err)) {
      res.json({ items: [] });
      return;
    }
    next(err);
  }
});

router.post("/users", requireInternalWriteSecret, async (req, res, next) => {
  try {
    const lanUser = readLanUser(req);
    if (lanUser && !canManageUsers(lanUser.role)) {
      res.status(403).json({ error: "forbidden_role" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const username = String(b.username ?? "").trim().toLowerCase();
    const password = String(b.password ?? "");
    const role = String(b.role ?? "deputy").trim().toLowerCase() || "deputy";
    const displayName = String(b.display_name ?? b.displayName ?? username).trim() || username;

    const squadronId = trimOrNull(b.squadron_id ?? b.squadronId);
    const wingId = trimOrNull(b.wing_id ?? b.wingId);
    const baseId = trimOrNull(b.base_id ?? b.baseId);

    if (username.length < 3) {
      res.status(400).json({ error: "username_too_short" });
      return;
    }
    if (password.length < 8) {
      res.status(400).json({ error: "password_too_short" });
      return;
    }
    if (!ASSIGNABLE_ROLES.has(role)) {
      res.status(400).json({ error: "invalid_role" });
      return;
    }
    const exists = await pool.query(`select 1 from lan_users where lower(username)=lower($1) limit 1`, [username]);
    if (exists.rows[0]) {
      res.status(409).json({ error: "username_exists" });
      return;
    }
    const id = randomUUID();
    const ph = await hashPassword(password);
    const ins = await pool.query(
      `
      insert into lan_users (id, username, display_name, role, squadron_id, wing_id, base_id, password_hash)
      values ($1, $2, $3, $4, $5, $6, $7, $8)
      returning id, username, display_name, role, squadron_id, wing_id, base_id, disabled_at, created_at
      `,
      [id, username, displayName, role, squadronId, wingId, baseId, ph],
    );
    await appendInternalAudit(String(lanUser?.username ?? "system"), "internal.users.create", {
      user_id: id,
      username,
      role,
      squadron_id: squadronId,
      wing_id: wingId,
      base_id: baseId,
      actor_role: normalizeLanRole(lanUser?.role),
    });
    res.json({ row: ins.rows[0] });
  } catch (err) {
    next(err);
  }
});

router.patch("/users/:id", requireInternalWriteSecret, async (req, res, next) => {
  try {
    const lanUser = readLanUser(req);
    if (lanUser && !canManageUsers(lanUser.role)) {
      res.status(403).json({ error: "forbidden_role" });
      return;
    }
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id_required" });
      return;
    }
    const existing = await pool.query<{
      id: string;
      username: string;
      role: string;
      squadron_id: string | null;
      wing_id: string | null;
      base_id: string | null;
    }>(
      `select id, username, role, squadron_id, wing_id, base_id from lan_users where id = $1`,
      [id],
    );
    const current = existing.rows[0];
    if (!current) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    const password = b.password != null ? String(b.password) : null;
    const role = b.role != null ? String(b.role).trim().toLowerCase() : null;
    // Scope reassignment: each field is only applied if the body
    // explicitly carries that key (otherwise the existing value is
    // preserved). `null` / empty string clears the column.
    const hasSquadron = "squadron_id" in b || "squadronId" in b;
    const hasWing = "wing_id" in b || "wingId" in b;
    const hasBase = "base_id" in b || "baseId" in b;
    const squadronId = hasSquadron ? trimOrNull(b.squadron_id ?? b.squadronId) : undefined;
    const wingId = hasWing ? trimOrNull(b.wing_id ?? b.wingId) : undefined;
    const baseId = hasBase ? trimOrNull(b.base_id ?? b.baseId) : undefined;
    // Disable / re-enable. `disabled: true` stamps `disabled_at = now()`,
    // `disabled: false` clears it. The login route refuses to mint a
    // session for any user with a non-null disabled_at, and the LAN
    // session middleware drops in-flight sessions for such users on
    // their next request.
    const hasDisabled = "disabled" in b;
    const disabledFlag = hasDisabled ? Boolean(b.disabled) : undefined;

    if (password !== null && password.length < 8) {
      res.status(400).json({ error: "password_too_short" });
      return;
    }
    if (role !== null && !ASSIGNABLE_ROLES.has(role)) {
      res.status(400).json({ error: "invalid_role" });
      return;
    }
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;
    if (password !== null) {
      sets.push(`password_hash = $${idx++}`);
      params.push(await hashPassword(password));
    }
    if (role !== null) {
      sets.push(`role = $${idx++}`);
      params.push(role);
    }
    if (squadronId !== undefined) {
      sets.push(`squadron_id = $${idx++}`);
      params.push(squadronId);
    }
    if (wingId !== undefined) {
      sets.push(`wing_id = $${idx++}`);
      params.push(wingId);
    }
    if (baseId !== undefined) {
      sets.push(`base_id = $${idx++}`);
      params.push(baseId);
    }
    if (disabledFlag !== undefined) {
      // Block disabling the last super_admin so the host PC can never
      // get locked out.
      if (disabledFlag && normalizeLanRole(current.role) === "super_admin") {
        const remaining = await pool.query<{ n: string }>(
          `select count(*)::text as n from lan_users where role = 'super_admin' and disabled_at is null and id <> $1`,
          [id],
        );
        if (Number(remaining.rows[0]?.n ?? 0) === 0) {
          res.status(409).json({ error: "last_super_admin" });
          return;
        }
      }
      sets.push(`disabled_at = ${disabledFlag ? "now()" : "null"}`);
    }
    if (sets.length === 0) {
      res.status(400).json({ error: "nothing_to_update" });
      return;
    }
    params.push(id);
    await pool.query(
      `update lan_users set ${sets.join(", ")} where id = $${idx}`,
      params,
    );
    await appendInternalAudit(String(lanUser?.username ?? "system"), "internal.users.update", {
      user_id: id,
      target_username: current.username,
      reset_password: password !== null,
      role_change: role !== null ? role : null,
      squadron_change: squadronId !== undefined ? squadronId : null,
      wing_change: wingId !== undefined ? wingId : null,
      base_change: baseId !== undefined ? baseId : null,
      disabled_change: disabledFlag !== undefined ? disabledFlag : null,
      actor_role: normalizeLanRole(lanUser?.role),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.delete("/users/:id", requireInternalWriteSecret, async (req, res, next) => {
  try {
    const lanUser = readLanUser(req);
    if (lanUser && !canManageUsers(lanUser.role)) {
      res.status(403).json({ error: "forbidden_role" });
      return;
    }
    const id = String(req.params.id ?? "").trim();
    if (!id) {
      res.status(400).json({ error: "id_required" });
      return;
    }
    const existing = await pool.query<{
      id: string;
      username: string;
      role: string;
      squadron_id: string | null;
      wing_id: string | null;
      base_id: string | null;
    }>(
      `select id, username, role, squadron_id, wing_id, base_id from lan_users where id = $1`,
      [id],
    );
    const current = existing.rows[0];
    if (!current) {
      res.status(404).json({ error: "not_found" });
      return;
    }
    // Refuse to delete the last super_admin so the host PC can never
    // get locked out by a fat-finger DELETE.
    if (normalizeLanRole(current.role) === "super_admin") {
      const remaining = await pool.query<{ n: string }>(
        `select count(*)::text as n from lan_users where role = 'super_admin' and id <> $1`,
        [id],
      );
      if (Number(remaining.rows[0]?.n ?? 0) === 0) {
        res.status(409).json({ error: "last_super_admin" });
        return;
      }
    }
    await pool.query(`delete from lan_users where id = $1`, [id]);
    await appendInternalAudit(String(lanUser?.username ?? "system"), "internal.users.delete", {
      user_id: id,
      target_username: current.username,
      actor_role: normalizeLanRole(lanUser?.role),
    });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get("/reminders/overview", async (req, res, next) => {
  try {
    const actor = readLanUser(req);
    // Reminder prefs + notifications are pilot-scoped; surface them
    // through the same wing/base/squadron read filter we apply to
    // /pilots so a wing commander sees their wing's reminders, etc.
    const prefsFilter = buildSquadronReadFilter(
      {
        role: actor?.role ?? null,
        squadronId: actor?.squadron_id ?? null,
        wingId: actor?.wing_id ?? null,
        baseId: actor?.base_id ?? null,
      },
      "p.squadron_id",
      1,
    );
    const notifFilter = buildSquadronReadFilter(
      {
        role: actor?.role ?? null,
        squadronId: actor?.squadron_id ?? null,
        wingId: actor?.wing_id ?? null,
        baseId: actor?.base_id ?? null,
      },
      "p.squadron_id",
      1,
    );
    const prefsWhere = prefsFilter ? `where 1 = 1 ${prefsFilter.sql}` : "";
    const notifWhere = notifFilter ? `where 1 = 1 ${notifFilter.sql}` : "";
    const [prefsQ, notifQ] = await Promise.all([
      pool.query(
        `
        select pr.pilot_id, pr.thresholds, pr.push_enabled, pr.expo_push_token, pr.platform, pr.updated_at
        from pilot_reminder_prefs pr
        left join pilots p on p.id = pr.pilot_id
        ${prefsWhere}
        `,
        prefsFilter ? prefsFilter.params : [],
      ),
      pool.query(
        `
        select distinct on (n.pilot_id)
          n.pilot_id, n.currency_key, n.expiry_date, n.threshold_days, n.sent_at
        from pilot_currency_notifications n
        left join pilots p on p.id = n.pilot_id
        ${notifWhere}
        order by n.pilot_id, n.sent_at desc
        `,
        notifFilter ? notifFilter.params : [],
      ),
    ]);
    const lastByPilot = new Map<string, Record<string, unknown>>();
    for (const row of notifQ.rows as Record<string, unknown>[]) {
      lastByPilot.set(String(row.pilot_id ?? ""), row);
    }
    const byPilot = new Map<string, Record<string, unknown>>();
    for (const p of prefsQ.rows as Record<string, unknown>[]) {
      const pid = String(p.pilot_id ?? "");
      const last = lastByPilot.get(pid);
      byPilot.set(pid, {
        pilotId: pid,
        pushEnabled: Boolean(p.push_enabled),
        expoPushToken: (p.expo_push_token as string | null) ?? null,
        platform: (p.platform as string | null) ?? null,
        thresholds: (p.thresholds as Record<string, unknown> | null) ?? {},
        updatedAt: (p.updated_at as string | null) ?? null,
        lastSentAt: (last?.sent_at as string | null) ?? null,
        lastSentCurrency: (last?.currency_key as string | null) ?? null,
        lastSentThresholdDays: (last?.threshold_days as number | null) ?? null,
        lastSentExpiry: (last?.expiry_date as string | null) ?? null,
      });
    }
    for (const [pid, last] of lastByPilot) {
      if (byPilot.has(pid)) continue;
      byPilot.set(pid, {
        pilotId: pid,
        pushEnabled: false,
        expoPushToken: null,
        platform: null,
        thresholds: {},
        updatedAt: null,
        lastSentAt: (last.sent_at as string | null) ?? null,
        lastSentCurrency: (last.currency_key as string | null) ?? null,
        lastSentThresholdDays: (last.threshold_days as number | null) ?? null,
        lastSentExpiry: (last.expiry_date as string | null) ?? null,
      });
    }
    res.json({ items: Array.from(byPilot.values()) });
  } catch (err) {
    if (isMissingTableError(err)) {
      res.json({ items: [] });
      return;
    }
    next(err);
  }
});

// Test-only export so unit tests can pin the role-gate without
// reaching into Express. Production code never imports this.
export const __testing__ = { canManageUsers, canReadUser };

export default router;
