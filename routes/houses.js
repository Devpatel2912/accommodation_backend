import express from "express";
import { authenticateToken, authorizeAdmin } from "../middlewares/auth.js";
import * as houseCtrl from "../controllers/houseController.js";

const router = express.Router();

router.post("/", authenticateToken, authorizeAdmin, houseCtrl.createHouse);
router.get("/", authenticateToken, authorizeAdmin, houseCtrl.getAllHouses);
router.get("/:id", authenticateToken, authorizeAdmin, houseCtrl.getHouseById);
router.put("/:id", authenticateToken, authorizeAdmin, houseCtrl.updateHouse);
router.delete("/:id", authenticateToken, authorizeAdmin, houseCtrl.deleteHouse);

export default router;
