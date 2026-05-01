import express from "express";
import dotenv from "dotenv";
import cors from "cors";
import morgan from "morgan";
import authRoutes from "./routes/auth.js";
import requestsRoutes from "./routes/requests.js";
import adminRoutes from "./routes/admin.js";
import roomRoutes from "./routes/rooms.js";
import houseRoutes from "./routes/houses.js";

dotenv.config();

const app = express();

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.use("/auth", authRoutes);
app.use("/requests", requestsRoutes);
app.use("/admin", adminRoutes);
app.use("/rooms", roomRoutes);
app.use("/houses", houseRoutes);
const server = app.listen(process.env.PORT, () => {
  console.log(`🚀 Server is definitely running on port ${process.env.PORT}`);
}).on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`❌ Error: Port ${process.env.PORT} is already in use by another program!`);
  } else {
    console.error(`❌ Server error:`, err);
  }
});