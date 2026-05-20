import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import * as authCtrl from "../controllers/authController.js";

const router = express.Router();

router.post("/request-otp", authCtrl.requestOtp);
router.post("/register", authCtrl.register);
router.post("/verify-otp", authCtrl.verifyOtp);
router.post("/login", authCtrl.login);
router.get("/profile", authenticateToken, authCtrl.getProfile);

export default router;
