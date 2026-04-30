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
import remindersInternalRouter from "./reminders-internal";
import xpcRegistryRouter from "./xpc-registry";
import xpcMessagesRouter from "./xpc-messages";
import xpcPendingRouter from "./xpc-pending";
import xpcScheduleSharesRouter from "./xpc-schedule-shares";
import xpcSnapshotsRouter from "./xpc-snapshots";
import xpcPairsRouter from "./xpc-pairs";
import unavailableInternalRouter from "./unavailable-internal";
import opsReadLanRouter from "./ops-read-lan";
import opsBoardInternalRouter from "./ops-board-internal";
import savedDutyWeeksInternalRouter from "./saved-duty-weeks-internal";
import pilotLinksInternalRouter from "./pilot-links-internal";
import lanUsersRemindersRouter from "./lan-users-reminders";
import importHistoryInternalRouter from "./import-history-internal";
import pilotsTransferRouter from "./pilots-transfer";
import peerTokensInternalRouter from "./peer-tokens-internal";
import lanAuthPublic from "./lan-auth-public";
import peerShellRouter from "./peer-shell";
import aggregateShellRouter from "./aggregate-shell";
import { requireInternalLanSession } from "../lib/lan-auth-middleware";
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
    internal.use(pilotOptionsRouter);
    internal.use(squadronAirframesRouter);
    internal.use(squadronsListRouter);
    internal.use(pilotsTableRouter);
    internal.use(pilotsWritesRouter);
    internal.use(sortiesWritesRouter);
    internal.use(sortiesReadRouter);
    internal.use(auditLogReadRouter);
    internal.use(remindersInternalRouter);
    internal.use(xpcRegistryRouter);
    internal.use(xpcMessagesRouter);
    internal.use(xpcPendingRouter);
    internal.use(xpcScheduleSharesRouter);
    internal.use(xpcSnapshotsRouter);
    internal.use(xpcPairsRouter);
    internal.use(unavailableInternalRouter);
    internal.use(opsReadLanRouter);
    internal.use(opsBoardInternalRouter);
    internal.use(savedDutyWeeksInternalRouter);
    internal.use(pilotLinksInternalRouter);
    internal.use(lanUsersRemindersRouter);
    internal.use(importHistoryInternalRouter);
    internal.use(pilotsTransferRouter);
    internal.use(peerTokensInternalRouter);
    router.use("/internal", internal);

    router.use("/peer", peerShellRouter);
  }

  if (isAggregatorProfile(profile)) {
    router.use("/aggregate", aggregateShellRouter);
  }

  return router;
}
