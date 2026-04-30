import { Router, type Request, type Response } from "express";

import { gatherAboutThisPc } from "../lib/about";
import { normalizeLanRole, readLanUser } from "../lib/lan-authz";

const router = Router();

/**
 * `GET /about` — operator-facing "About this PC" snapshot.
 *
 * Mounted under both `/api/internal` (hub) and `/api/aggregate`
 * (aggregator) by `routes/index.ts`. Always super_admin only — the
 * payload exposes hostname, database name and version strings that
 * a non-admin operator should not see in the LAN UI.
 *
 * In `HAWK_INTERNAL_SESSION_AUTH=off` (bring-up / dev) the upstream
 * `requireInternalLanSession` middleware short-circuits without
 * setting `req.lanUser`; treat that as super_admin too — same
 * convention as `routes/system-health.ts`.
 */
router.get("/about", async (req: Request, res: Response) => {
  const sessionAuthMode = String(
    process.env["HAWK_INTERNAL_SESSION_AUTH"] ?? "",
  ).trim().toLowerCase();
  const sessionAuthOff = sessionAuthMode === "off";

  const u = readLanUser(req);
  const role = normalizeLanRole(u?.role);
  if (!sessionAuthOff && role !== "super_admin") {
    res.status(403).json({ ok: false, error: "super_admin_required" });
    return;
  }

  try {
    const report = await gatherAboutThisPc();
    res.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error?.({ err }, "about: gather failed");
    res.status(500).json({ ok: false, error: msg });
  }
});

export default router;
