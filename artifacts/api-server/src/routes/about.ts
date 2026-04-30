import { Router, type Request, type Response } from "express";
import { spawn, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { isAbsolute, join, resolve as pathResolve } from "node:path";

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
  if (!isSuperAdmin(req, res)) return;

  try {
    const report = await gatherAboutThisPc();
    res.json({ ok: true, report });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error?.({ err }, "about: gather failed");
    res.status(500).json({ ok: false, error: msg });
  }
});

// ── action endpoints ──────────────────────────────────────────────
//
// Task #390: surface the About-panel age dots as actionable buttons so
// a super_admin can kick off a backup or verify-backup without
// dropping to PowerShell. Both endpoints spawn the existing LAN-host
// scripts (`scripts/lan-host/backup-postgres.ps1` and
// `scripts/lan-host/verify-backup.ps1`) detached so the HTTP request
// returns immediately and the browser can poll `/about` for the age
// to drop. The scripts are the only blessed way to write the dump
// file and the `system_health_marker` row, so we never duplicate
// their logic here.
//
// Concurrency guard: refuse a second start while the previous one is
// still in flight so the operator can't accidentally fork two
// pg_dumps onto the same .dump file. This is process-local — good
// enough since both buttons live on the same hub node.

const inFlight: { backup: boolean; verify: boolean } = {
  backup: false,
  verify: false,
};

router.post("/about/run-backup", async (req: Request, res: Response) => {
  if (!isSuperAdmin(req, res)) return;
  await runScript(req, res, {
    key: "backup",
    scriptName: "backup-postgres.ps1",
    logTag: "about: run-backup",
  });
});

router.post("/about/run-verify", async (req: Request, res: Response) => {
  if (!isSuperAdmin(req, res)) return;
  await runScript(req, res, {
    key: "verify",
    scriptName: "verify-backup.ps1",
    logTag: "about: run-verify",
  });
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

function lanScriptsDir(): string {
  const raw = String(process.env["HAWK_LAN_SCRIPTS_DIR"] ?? "").trim();
  if (raw && isAbsolute(raw)) return raw;
  return pathResolve(process.cwd(), "scripts", "lan-host");
}

function findPowershell(): string | null {
  // Prefer cross-platform `pwsh` (PowerShell Core) so dev hosts on
  // Linux/macOS can also exercise these endpoints. Fall back to the
  // Windows-shipped `powershell.exe` for the production LAN host.
  const candidates =
    process.platform === "win32"
      ? ["powershell.exe", "pwsh.exe", "pwsh"]
      : ["pwsh", "powershell"];
  const probe = process.platform === "win32" ? "where" : "which";
  for (const cmd of candidates) {
    try {
      const out = execSync(`${probe} ${cmd}`, {
        stdio: ["ignore", "pipe", "ignore"],
        timeout: 2000,
      })
        .toString()
        .trim()
        .split(/\r?\n/)[0];
      if (out) return cmd;
    } catch {
      /* not on PATH — try next */
    }
  }
  return null;
}

async function runScript(
  req: Request,
  res: Response,
  opts: { key: "backup" | "verify"; scriptName: string; logTag: string },
): Promise<void> {
  if (inFlight[opts.key]) {
    res.status(409).json({ ok: false, error: "already_running" });
    return;
  }
  const dir = lanScriptsDir();
  const scriptPath = join(dir, opts.scriptName);
  if (!existsSync(scriptPath)) {
    res.status(404).json({ ok: false, error: "script_not_found", scriptPath });
    return;
  }
  const ps = findPowershell();
  if (!ps) {
    res.status(503).json({ ok: false, error: "powershell_unavailable" });
    return;
  }

  inFlight[opts.key] = true;
  try {
    const child = spawn(
      ps,
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", scriptPath],
      {
        cwd: process.cwd(),
        detached: true,
        stdio: "ignore",
        env: process.env,
      },
    );
    child.on("error", (err) => {
      inFlight[opts.key] = false;
      req.log?.error?.({ err }, `${opts.logTag}: spawn error`);
    });
    child.on("exit", (code) => {
      inFlight[opts.key] = false;
      req.log?.info?.({ code }, `${opts.logTag}: exited`);
    });
    child.unref();
    res.status(202).json({ ok: true, started: true });
  } catch (err) {
    inFlight[opts.key] = false;
    const msg = err instanceof Error ? err.message : String(err);
    req.log?.error?.({ err }, `${opts.logTag}: spawn threw`);
    res.status(500).json({ ok: false, error: msg });
  }
}

export default router;
