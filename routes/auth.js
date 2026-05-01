import express from "express";
import bcrypt from "bcrypt";
import { supabase } from "../config/supabase.js";
import { generateOtp } from "../utils/otp.js";
import { createOtpToken, verifyToken, createAuthToken } from "../utils/jwt.js";
import { sendOtpEmail } from "../utils/email.js";

const router = express.Router();


// =========================
// 1. REQUEST OTP
// =========================
router.post("/request-otp", async (req, res) => {
  const { email } = req.body;

  try {
    // Check if user exists in the database
    const { data: user, error } = await supabase
      .from("users")
      .select("id")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(400).json({ error: "Email not registered. Please sign up first." });
    }

    const otp = generateOtp();
    const hashedOtp = await bcrypt.hash(otp, 10);

    const token = createOtpToken(email, hashedOtp);

    await sendOtpEmail(email, otp);

    res.json({ success: true, message: "OTP sent successfully", otpToken: token });
  } catch (err) {
    console.error("❌ OTP Error:", err);
    res.status(500).json({ error: "Failed to send OTP. Please try again later." });
  }
});


// =========================
// 2. VERIFY OTP
// =========================
router.post("/verify-otp", async (req, res) => {
  const { email, otp, otpToken } = req.body;

  if (!email || !otp || !otpToken) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const decoded = verifyToken(otpToken);

    if (decoded.email !== email) {
      return res.status(400).json({ error: "Invalid email" });
    }

    const cleanOtp = String(otp).trim();
    const isMatch = await bcrypt.compare(cleanOtp, decoded.otp);

    if (!isMatch) {
      return res.status(400).json({ error: "Invalid OTP" });
    }

    const { data: user, error } = await supabase
      .from("users")
      .select("*")
      .eq("email", email)
      .single();

    if (error || !user) {
      return res.status(400).json({ error: "User not found" });
    }

    const authToken = createAuthToken(user);

    res.json({ accessToken: authToken, user });

  } catch (err) {
    res.status(400).json({ error: "OTP expired or invalid" });
  }
});


// =========================
// 3. PASSWORD LOGIN
// =========================
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const { data: user, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email)
    .single();

  if (error || !user) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const match = await bcrypt.compare(password, user.password_hash);

  if (!match) {
    return res.status(400).json({ error: "Invalid credentials" });
  }

  const token = createAuthToken(user);

  res.json({ accessToken: token, user });
});

// =========================
// 4. GET PROFILE
// =========================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access denied" });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch (err) {
    res.status(403).json({ error: "Invalid token" });
  }
};

router.get("/profile", authenticateToken, async (req, res) => {
  try {
    const { data: user, error } = await supabase
      .from("users")
      .select("id, name, phone, role, email, pradesh")
      .eq("id", req.user.id)
      .single();

    if (error || !user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ success: true, user });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;