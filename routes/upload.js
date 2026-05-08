import express from "express";
import multer from "multer";
import path from "path";
import { verifyToken } from "../utils/jwt.js";
import fs from "fs";

const router = express.Router();

// Ensure uploads directory exists
const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir);
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  },
});

const upload = multer({ storage: storage });

const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
};

router.post("/", authenticateToken, upload.single("file"), (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file uploaded" });
    }

    // Construct the URL. Note: process.env.PORT or the host address should be used.
    // For local dev, we'll use a relative path or the full URL if we can determine it.
    const protocol = req.protocol;
    const host = req.get("host");
    const publicUrl = `${protocol}://${host}/uploads/${req.file.filename}`;

    console.log("File uploaded successfully to local storage. URL:", publicUrl);
    res.json({ url: publicUrl });
  } catch (err) {
    console.error("UPLOAD ROUTE ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
