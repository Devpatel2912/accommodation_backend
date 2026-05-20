import { verifyToken } from "../utils/jwt.js";

// ─── Authenticate JWT Token ─────────────────────────────────────────
export const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded;
    next();
  } catch {
    res.status(403).json({ error: "Invalid or expired token" });
  }
};

// ─── Authorize Admin Role ───────────────────────────────────────────
export const authorizeAdmin = (req, res, next) => {
  if (req.user?.role?.toUpperCase() === "ADMIN") return next();
  return res.status(403).json({ error: "Admin access only" });
};

// ─── Authorize SubAdmin Role ────────────────────────────────────────
export const authorizeSubAdmin = (req, res, next) => {
  const role = req.user?.role?.toUpperCase();
  if (role === "SUBADMIN" || role === "ADMIN") return next();
  return res.status(403).json({ error: "SubAdmin access only" });
};
