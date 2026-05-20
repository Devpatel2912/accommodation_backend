import admin from "firebase-admin";
import { readFileSync } from "fs";
import { join } from "path";

// ─── Initialize Firebase Admin SDK ──────────────────────────────────
try {
  const serviceAccountPath = join(process.cwd(), "serviceAccountKey.json");
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin initialized");
  }
} catch (error) {
  console.error("❌ Error initializing Firebase Admin:", error.message);
}

export default admin;
