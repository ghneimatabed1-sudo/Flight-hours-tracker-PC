import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { getActiveInstallProfile } from "../lib/install-profile";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({
    status: "ok",
    installProfile: getActiveInstallProfile(),
  });
  res.json(data);
});

export default router;
