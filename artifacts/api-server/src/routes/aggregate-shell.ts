import { Router, type IRouter } from "express";

// Aggregator-only shell. Real fan-out lands in the multi-hub view
// task; the shell pins the route surface and 501 contract.
const router: IRouter = Router();

router.use((_req, res) => {
  res.status(501).json({
    error: "not_implemented_yet",
    surface: "aggregate",
    note: "Aggregator fan-out arrives in the multi-hub view task.",
  });
});

export default router;
