import { Router, type Request, type Response } from "express";

import { readMdnsHealth } from "../lib/mdns-health";
import { normalizeLanRole, readLanUser } from "../lib/lan-authz";

const router = Router();

/**
 * `GET /system/mdns-health` — operator-facing badge for the LAN broadcast.
 *
 * Mounted under both `/api/internal` (hub) and `/api/aggregate`
 * (aggregator) by `routes/index.ts`. Always super_admin only — same
 * convention as the sibling `system-health` route.
 *
 * Replaces the "RDP into the host and run check-mdns-health.ps1" loop
 * (Task #398). Distinct from the scheduled-task-failure surface: the
 * supervisor task itself stays Running even when dns-sd.exe is between
 * restarts, so a generic scheduled-task view does not catch a dead
 * broadcast.
 *
 * Responses:
 *   200 { ok: true, report }  — heartbeat file present & readable.
 *   404 { ok: false, error: "mdns_disabled" } — file does not exist
 *        (mDNS never enabled with -EnableMdns / supervisor task not
 *        registered).
 *   500 on unexpected agent failures.
 */
router.get("/system/mdns-health", async (req: Request, res: Response) => {
  if (!isSuperAdmin(req, res)) return;
  try {
    const report = await readMdnsHealth();
    if (!report) {
      res
        .status(404)
        .json({ ok: false, error: "mdns_disabled" });
      return;
    }
    res.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error?.({ err }, "mdns-health: gather failed");
    res.status(500).json({ ok: false, error: msg });
  }
});

function isSuperAdmin(req: Request, res: Response): boolean {
  const sessionAuthMode = String(
    process.env["HAWK_INTERNAL_SESSION_AUTH"] ?? "",
  )
    .trim()
    .toLowerCase();
  const sessionAuthOff = sessionAuthMode === "off";

  const u = readLanUser(req);
  const role = normalizeLanRole(u?.role);
  if (!sessionAuthOff && role !== "super_admin") {
    res.status(403).json({ ok: false, error: "super_admin_required" });
    return false;
  }
  return true;
}

export default router;
