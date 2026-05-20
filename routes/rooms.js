import express from "express";
import { authenticateToken, authorizeAdmin } from "../middlewares/auth.js";
import * as roomCtrl from "../controllers/roomController.js";

const router = express.Router();

router.post("/", authenticateToken, authorizeAdmin, roomCtrl.createRoom);
router.get("/admin/all", authenticateToken, authorizeAdmin, roomCtrl.getAllRoomsAdmin);
router.get("/", roomCtrl.getAvailableRooms);
router.get("/:id", authenticateToken, authorizeAdmin, roomCtrl.getRoomById);
router.put("/:id", authenticateToken, authorizeAdmin, roomCtrl.updateRoom);
router.delete("/:id", authenticateToken, authorizeAdmin, roomCtrl.deleteRoom);

export default router;
