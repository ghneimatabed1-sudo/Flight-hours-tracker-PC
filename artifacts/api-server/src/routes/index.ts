import { Router, type IRouter } from "express";
import healthRouter from "./health";
import licenseRouter from "./license";

const router: IRouter = Router();

router.use(healthRouter);
router.use(licenseRouter);

export default router;
