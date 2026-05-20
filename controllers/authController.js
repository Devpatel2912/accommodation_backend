import bcrypt from "bcrypt";
import { generateOtp, createOtpToken, verifyToken, createAuthToken } from "../utils/jwt.js";
import { sendOtpEmail } from "../utils/email.js";
import * as UserModel from "../models/userModel.js";

// ─── REQUEST OTP ────────────────────────────────────────────────────
export const requestOtp = async (req, res) => {
  const { email } = req.body;
  try {
    const { data: user, error } = await UserModel.findUserByEmail(email);
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
};

// ─── REGISTER ───────────────────────────────────────────────────────
export const register = async (req, res) => {
  const { name, email, phone, role, pradesh, sub_admin_type } = req.body;
  const normalizedRole = String(role || "").trim().toUpperCase();

  if (!name || !email || !phone || !normalizedRole) {
    return res.status(400).json({ error: "name, email, phone, and role are required" });
  }
  if (!["USER", "ADMIN", "SUBADMIN"].includes(normalizedRole)) {
    return res.status(400).json({ error: "role must be USER, ADMIN, or SUBADMIN" });
  }
  if (normalizedRole === "SUBADMIN" && !sub_admin_type) {
    return res.status(400).json({ error: "sub_admin_type (AVD or ANAND) is required for SUBADMIN" });
  }

  try {
    const { data: existing, error: selectError } = await UserModel.findUserByEmailMaybe(email);
    if (selectError) return res.status(500).json({ error: "Failed to validate registration" });
    if (existing) return res.status(400).json({ error: "Email is already registered" });

    const userData = { name, email, phone, role: normalizedRole, pradesh };
    if (normalizedRole === "SUBADMIN" && sub_admin_type) {
      userData.sub_admin_type = String(sub_admin_type).trim().toUpperCase();
    }
    if (req.body.password) {
      userData.password = await bcrypt.hash(req.body.password, 10);
    }
    const { data, error } = await UserModel.createUser(userData);
    if (error) return res.status(400).json({ error: error.message });

    res.status(201).json({ success: true, user: data });
  } catch (err) {
    console.error("❌ Register Error:", err);
    res.status(500).json({ error: "Registration failed. Please try again later." });
  }
};

// ─── VERIFY OTP ─────────────────────────────────────────────────────
export const verifyOtp = async (req, res) => {
  const { email, otp, otpToken } = req.body;
  if (!email || !otp || !otpToken) {
    return res.status(400).json({ error: "Missing fields" });
  }

  try {
    const decoded = verifyToken(otpToken);
    if (decoded.email !== email) return res.status(400).json({ error: "Invalid email" });

    const isMatch = await bcrypt.compare(String(otp).trim(), decoded.otp);
    if (!isMatch) return res.status(400).json({ error: "Invalid OTP" });

    const { data: user, error } = await UserModel.findUserByEmail(email);
    if (error || !user) return res.status(400).json({ error: "User not found" });

    const authToken = createAuthToken(user);
    res.json({ accessToken: authToken, user });
  } catch {
    res.status(400).json({ error: "OTP expired or invalid" });
  }
};

// ─── GET PROFILE ────────────────────────────────────────────────────
export const getProfile = async (req, res) => {
  try {
    const { data: user, error } = await UserModel.findUserById(req.user.id, "id, name, phone, role, email, pradesh, sub_admin_type");
    if (error || !user) return res.status(404).json({ error: "User not found" });
    res.json({ success: true, user });
  } catch {
    res.status(500).json({ error: "Internal server error" });
  }
};
// ─── LOGIN (PASSWORD) ──────────────────────────────────────────────────
export const login = async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: "Email and password are required" });
  }

  try {
    const { data: user, error } = await UserModel.findUserByEmail(email);
    if (error || !user) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    if (!user.password) {
      return res.status(400).json({ error: "Please login with OTP or set a password" });
    }

    // Support both bcrypt hash and plaintext passwords (if entered directly in Supabase)
    let isMatch = false;
    if (user.password.startsWith('$2')) {
      isMatch = await bcrypt.compare(password, user.password);
    } else {
      isMatch = (password === user.password);
      // Optional: automatically hash the password here to migrate it to bcrypt
      if (isMatch) {
         try {
           const hashed = await bcrypt.hash(password, 10);
           await UserModel.updateUser(user.id, { password: hashed });
         } catch(e) {}
      }
    }

    if (!isMatch) {
      return res.status(400).json({ error: "Invalid email or password" });
    }

    const authToken = createAuthToken(user);
    res.json({ success: true, accessToken: authToken, user });
  } catch (err) {
    console.error("❌ Login Error:", err);
    res.status(500).json({ error: "Login failed. Please try again later." });
  }
};
