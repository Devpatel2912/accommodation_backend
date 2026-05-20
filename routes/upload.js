import express from "express";
import { authenticateToken } from "../middlewares/auth.js";
import { upload, uploadFile } from "../controllers/uploadController.js";

const router = express.Router();

router.post("/", authenticateToken, upload.single("file"), uploadFile);

export default router;
