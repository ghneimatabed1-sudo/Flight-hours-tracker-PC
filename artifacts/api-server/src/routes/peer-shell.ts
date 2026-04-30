import { Router, type IRouter } from "express";

// Hub-only shell. Real handlers land in the share-token task; the
// shell exists so the route surface and 501 contract are pinned at
// the foundation layer.
const router: IRouter = Router();

router.use((_req, res) => {
  res.status(501).json({
    error: "not_implemented_yet",
    surface: "peer",
    note: "Hub peer endpoints arrive in the share-token task.",
  });
});

export default router;
