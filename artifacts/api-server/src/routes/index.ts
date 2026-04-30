import { Router, type IRouter } from "express";
import healthRouter from "./health";
import pilotOptionsRouter from "./pilot-options";
import squadronAirframesRouter from "./squadron-airframes";
import squadronsListRouter from "./squadrons-list";
import pilotsTableRouter from "./pilots-table";
import pilotsWritesRouter from "./pilots-writes";
import sortiesWritesRouter from "./sorties-writes";
import sortiesReadRouter from "./sorties-read";
import auditLogReadRouter from "./audit-log-read";
import unavailableInternalRouter from "./unavailable-internal";
import opsReadLanRouter from "./ops-read-lan";
import opsBoardInternalRouter from "./ops-board-internal";
import savedDutyWeeksInternalRouter from "./saved-duty-weeks-internal";
import importHistoryInternalRouter from "./import-history-internal";
import pilotsTransferRouter from "./pilots-transfer";
import peerTokensInternalRouter from "./peer-tokens-internal";
import lanAuthPublic from "./lan-auth-public";
import peerShellRouter from "./peer-shell";
import aggregateShellRouter from "./aggregate-shell";
import systemHealthRouter from "./system-health";
import mdnsHealthRouter from "./mdns-health";
import backupVerifyStatusRouter from "./backup-verify-status";
import aboutRouter from "./about";
import { requireInternalLanSession } from "../lib/lan-auth-middleware";
import { diskGuard } from "../middlewares/disk-guard";
import {
  isAggregatorProfile,
  type InstallProfile,
} from "../lib/install-profile";

/**
 * Build the `/api/*` router for the active install profile.
 *
 *  - hub             — /api/healthz, /api/internal/*, /api/peer/* (shell)
 *  - aggregator-*    — /api/healthz, /api/aggregate/* (shell)
 *  - viewer          — has no backend; throws (index.ts also refuses to start)
 */
export function buildRouter(profile: InstallProfile): IRouter {
  if (profile === "viewer") {
    throw new Error(
      "viewer install profile has no backend — refuse to build a router",
    );
  }

  const router: IRouter = Router();

  router.use(healthRouter);

  if (profile === "hub") {
    const internal: IRouter = Router();
    internal.use(lanAuthPublic);
    internal.use(requireInternalLanSession);
    // Refuse non-GET writes when the data disk is critically low. Reads
    // (including the system-health route below) stay reachable so the
    // operator can still see what's wrong.
    internal.use(diskGuard);
    internal.use(systemHealthRouter);
    internal.use(mdnsHealthRouter);
    internal.use(backupVerifyStatusRouter);
    internal.use(aboutRouter);
    internal.use(pilotOptionsRouter);
    internal.use(squadronAirframesRouter);
    internal.use(squadronsListRouter);
    internal.use(pilotsTableRouter);
    internal.use(pilotsWritesRouter);
    internal.use(sortiesWritesRouter);
    internal.use(sortiesReadRouter);
    internal.use(auditLogReadRouter);
    internal.use(unavailableInternalRouter);
    internal.use(opsReadLanRouter);
    internal.use(opsBoardInternalRouter);
    internal.use(savedDutyWeeksInternalRouter);
    internal.use(importHistoryInternalRouter);
    internal.use(pilotsTransferRouter);
    internal.use(peerTokensInternalRouter);
    router.use("/internal", internal);

    router.use("/peer", peerShellRouter);
  }

  if (isAggregatorProfile(profile)) {
    // Aggregate routes follow the same security model as `/api/internal/*`
    // on the hub: gated by `requireInternalLanSession` so the address-book
    // CRUD and fan-out reads cannot be hit anonymously in production.
    // In bring-up / dev (`HAWK_INTERNAL_SESSION_AUTH=off`) the middleware
    // short-circuits, matching the hybrid default everywhere else.
    const aggregate: IRouter = Router();
    aggregate.use(lanAuthPublic);
    aggregate.use(requireInternalLanSession);
    aggregate.use(diskGuard);
    aggregate.use(systemHealthRouter);
    aggregate.use(mdnsHealthRouter);
    aggregate.use(aboutRouter);
    aggregate.use(aggregateShellRouter);
    router.use("/aggregate", aggregate);
  }

  return router;
}
