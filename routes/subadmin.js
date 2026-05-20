import express from "express";
import { authenticateToken, authorizeSubAdmin } from "../middlewares/auth.js";
import * as subadminCtrl from "../controllers/subadminController.js";

const router = express.Router();

// GET /subadmin/requests?type=AVD  or  GET /subadmin/requests?type=ANAND
router.get("/requests", authenticateToken, authorizeSubAdmin, subadminCtrl.getSubAdminRequests);

export default router;
