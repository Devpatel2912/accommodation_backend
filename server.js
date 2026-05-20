import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";

// ─── Route Imports ──────────────────────────────────────────────────
import authRoutes from "./routes/auth.js";
import requestsRoutes from "./routes/requests.js";
import adminRoutes from "./routes/admin.js";
import roomRoutes from "./routes/rooms.js";
import houseRoutes from "./routes/houses.js";
import uploadRoutes from "./routes/upload.js";
import notificationsRoutes from "./routes/notifications.js";
import subadminRoutes from "./routes/subadmin.js";

// ─── Config ─────────────────────────────────────────────────────────
dotenv.config();

const app = express();

// ─── Middleware ──────────────────────────────────────────────────────
app.use(cors());
app.use(morgan("dev"));
app.use(express.json());
app.use("/uploads", express.static("uploads"));

// ─── Routes ─────────────────────────────────────────────────────────
app.use("/auth", authRoutes);
app.use("/requests", requestsRoutes);
app.use("/admin", adminRoutes);
app.use("/rooms", roomRoutes);
app.use("/houses", houseRoutes);
app.use("/upload", uploadRoutes);
app.use("/notifications", notificationsRoutes);
app.use("/subadmin", subadminRoutes);

// ─── Start Server ───────────────────────────────────────────────────
const PORT = process.env.PORT || 5001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
}).on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`❌ Port ${PORT} is already in use!`);
  } else {
    console.error(`❌ Server error:`, err);
  }
});