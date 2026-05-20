import express from "express";
import * as notificationCtrl from "../controllers/notificationController.js";

const router = express.Router();

router.post("/send-to-topic", notificationCtrl.sendToTopic);

export default router;
