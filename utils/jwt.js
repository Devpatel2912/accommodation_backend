import jwt from "jsonwebtoken";

// 🔢 OTP generator (optional, can stay here or separate)
export const generateOtp = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// 🔐 OTP token (10 min)
export const createOtpToken = (email, hashedOtp) => {
  return jwt.sign(
    { email, otp: hashedOtp },
    process.env.JWT_SECRET,
    { expiresIn: "10m" }
  );
};

// 🔍 verify token
export const verifyToken = (token) => {
  return jwt.verify(token, process.env.JWT_SECRET);
};

// 🔑 LOGIN token (main auth)
export const createAuthToken = (user) => {
  const payload = {
    id: user.id,
    email: user.email,
    role: user.role,
  };
  if (user.sub_admin_type) {
    payload.sub_admin_type = user.sub_admin_type;
  }
  return jwt.sign(
    payload,
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );
};