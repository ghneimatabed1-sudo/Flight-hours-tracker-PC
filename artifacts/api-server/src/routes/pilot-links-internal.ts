import { createHash } from "node:crypto";
import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { requireInternalWriteSecret } from "../lib/internal-write-auth";
import { appendInternalAudit } from "../lib/internal-audit";
import {
  buildSquadronReadFilter,
  canReadSquadronData,
  normalizeLanRole,
  readLanUser,
} from "../lib/lan-authz";

const router: IRouter = Router();

const LINK_CODE_TTL_MS = 7 * 24 * 60 * 60_000;

function sha256Hex(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

function canManage(roleRaw: string | null | undefined): boolean {
  const role = normalizeLanRole(roleRaw);
  return role === "ops" || role === "admin" || role === "super_admin";
}

router.get("/pilot-links/active-devices", async (req, res, next) => {
  try {
    const actor = readLanUser(req);
    // Active devices follow the same read scope as their pilot. Source
    // squadron from pilots so legacy pilot_devices rows with NULL
    // squadron_id still authorise correctly.
    const filter = buildSquadronReadFilter(
      {
        role: actor?.role ?? null,
        squadronId: actor?.squadron_id ?? null,
        wingId: actor?.wing_id ?? null,
        baseId: actor?.base_id ?? null,
      },
      "p.squadron_id",
      1,
    );
    const where = filter
      ? `where d.revoked_at is null ${filter.sql}`
      : `where d.revoked_at is null`;
    const params = filter ? filter.params : [];
    const q = await pool.query(
      `
      select d.pilot_id, d.linked_at, d.last_seen_at
      from pilot_devices d
      left join pilots p on p.id = d.pilot_id
      ${where}
      order by d.linked_at desc
      `,
      params,
    );
    res.json({ items: q.rows });
  } catch (err) {
    next(err);
  }
});

router.get("/pilot-links/status", async (req, res, next) => {
  try {
    const pilotId = String(req.query.pilotId ?? "").trim();
    if (!pilotId) {
      res.status(400).json({ error: "missing_pilot_id" });
      return;
    }
    // Resolve the pilot's squadron + that squadron's wing/base up
    // front so wing/base commanders can see status for every pilot
    // under their command, while squadron-tier roles only see their
    // own squadron's pilots. We must include wing_id/base_id in the
    // target — `canReadSquadronData` for commander_wing/_base relies
    // on it to authorise cross-squadron reads.
    const actor = readLanUser(req);
    if (actor) {
      const pilotQ = await pool.query<{
        squadron_id: string | null;
        wing_id: string | null;
        base_id: string | null;
      }>(
        `select p.squadron_id, s.wing_id, s.base_id
         from pilots p
         left join squadrons s on s.id = p.squadron_id
         where p.id = $1
         limit 1`,
        [pilotId],
      );
      const pilot = pilotQ.rows[0];
      if (!pilot) {
        res.status(404).json({ error: "pilot_not_found" });
        return;
      }
      if (
        !canReadSquadronData(
          {
            role: actor.role,
            squadronId: actor.squadron_id ?? null,
            wingId: actor.wing_id ?? null,
            baseId: actor.base_id ?? null,
          },
          {
            squadronId: pilot.squadron_id ?? null,
            wingId: pilot.wing_id ?? null,
            baseId: pilot.base_id ?? null,
          },
        )
      ) {
        res.status(403).json({ error: "foreign_squadron_forbidden" });
        return;
      }
    }
    const [devQ, codeQ] = await Promise.all([
      pool.query(
        `
        select linked_at, last_seen_at, revoked_at
        from pilot_devices
        where pilot_id = $1
        order by linked_at desc
        limit 1
        `,
        [pilotId],
      ),
      pool.query(
        `
        select expires_at
        from pilot_link_codes
        where pilot_id = $1
          and consumed_at is null
          and expires_at > now()
        order by issued_at desc
        limit 1
        `,
        [pilotId],
      ),
    ]);
    const d = devQ.rows[0] as
      | { linked_at: string; last_seen_at: string; revoked_at: string | null }
      | undefined;
    const c = codeQ.rows[0] as { expires_at: string } | undefined;
    res.json({
      device: d
        ? { linkedAt: d.linked_at, lastSeenAt: d.last_seen_at, revokedAt: d.revoked_at }
        : null,
      pendingCode: c ? { expiresAt: c.expires_at } : null,
    });
  } catch (err) {
    next(err);
  }
});

router.post("/pilot-links/issue", requireInternalWriteSecret, async (req, res, next) => {
  try {
    const lanUser = readLanUser(req);
    if (lanUser && !canManage(lanUser.role)) {
      res.status(403).json({ error: "forbidden_role" });
      return;
    }
    const pilotId = String((req.body as Record<string, unknown>)?.pilot_id ?? "").trim();
    if (!pilotId) {
      res.status(400).json({ error: "missing_pilot_id" });
      return;
    }
    const pilotQ = await pool.query<{ squadron_id: string | null }>(
      `select squadron_id from pilots where id = $1 limit 1`,
      [pilotId],
    );
    const pilot = pilotQ.rows[0];
    if (!pilot?.squadron_id) {
      res.status(404).json({ error: "pilot_not_found" });
      return;
    }
    const code = String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
    const codeHash = sha256Hex(code);
    const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS).toISOString();

    await pool.query(
      `
      update pilot_link_codes
      set consumed_at = now()
      where pilot_id = $1
        and consumed_at is null
      `,
      [pilotId],
    );
    await pool.query(
      `
      insert into pilot_link_codes (squadron_id, pilot_id, code_hash, expires_at)
      values ($1::uuid, $2, $3, $4::timestamptz)
      `,
      [pilot.squadron_id, pilotId, codeHash, expiresAt],
    );
    await appendInternalAudit(
      String(lanUser?.username ?? "system"),
      "internal.mobile.code.issued",
      { pilot_id: pilotId, squadron_id: pilot.squadron_id, role: normalizeLanRole(lanUser?.role) },
    );
    res.json({ code, expiresAt });
  } catch (err) {
    next(err);
  }
});

router.post("/pilot-links/revoke", requireInternalWriteSecret, async (req, res, next) => {
  try {
    const lanUser = readLanUser(req);
    if (lanUser && !canManage(lanUser.role)) {
      res.status(403).json({ error: "forbidden_role" });
      return;
    }
    const pilotId = String((req.body as Record<string, unknown>)?.pilot_id ?? "").trim();
    if (!pilotId) {
      res.status(400).json({ error: "missing_pilot_id" });
      return;
    }
    const nowIso = new Date().toISOString();
    const devQ = await pool.query(
      `
      update pilot_devices
      set revoked_at = $2::timestamptz
      where pilot_id = $1
        and revoked_at is null
      returning token_hash
      `,
      [pilotId, nowIso],
    );
    await pool.query(
      `
      update pilot_link_codes
      set consumed_at = $2::timestamptz
      where pilot_id = $1
        and consumed_at is null
      `,
      [pilotId, nowIso],
    );
    await appendInternalAudit(
      String(lanUser?.username ?? "system"),
      "internal.mobile.device.revoked",
      { pilot_id: pilotId, devices: devQ.rows.length, role: normalizeLanRole(lanUser?.role) },
    );
    res.json({ revoked: devQ.rows.length });
  } catch (err) {
    next(err);
  }
});

export default router;
