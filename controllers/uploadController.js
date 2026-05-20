import multer from "multer";
import path from "path";
import fs from "fs";

const uploadDir = "uploads";
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, uniqueSuffix + path.extname(file.originalname));
  }
});

export const upload = multer({ storage });

export const uploadFile = (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });
    const protocol = req.protocol;
    const host = req.get("host");
    const publicUrl = `${protocol}://${host}/uploads/${req.file.filename}`;
    console.log("File uploaded successfully. URL:", publicUrl);
    res.json({ url: publicUrl });
  } catch (err) {
    console.error("UPLOAD ROUTE ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};
