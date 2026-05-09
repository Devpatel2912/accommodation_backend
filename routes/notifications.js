import express from "express";
import admin from "firebase-admin";
import { readFileSync } from "fs";
import { join } from "path";

const router = express.Router();

// Initialize Firebase Admin
// We assume serviceAccountKey.json will be placed in the config folder or root
try {
  const serviceAccountPath = join(process.cwd(), "serviceAccountKey.json");
  const serviceAccount = JSON.parse(readFileSync(serviceAccountPath, "utf8"));

  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log("✅ Firebase Admin initialized in main backend");
  }
} catch (error) {
  console.error("❌ Error initializing Firebase Admin:", error.message);
}

/**
 * Send notification to a specific topic
 * POST /notifications/send-to-topic
 */
router.post("/send-to-topic", async (req, res) => {
  const { topic, title, body, data } = req.body;

  if (!topic || !title || !body) {
    return res.status(400).send({ error: "Missing required fields: topic, title, body" });
  }

  const message = {
    notification: { title, body },
    data: data || {},
    topic: topic,
    android: {
      priority: "high",
      ttl: 86400 * 1000,
      notification: {
        channel_id: "high_importance_channel",
        priority: "max",
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        visibility: "public",
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    res.status(200).send({ success: true, messageId: response });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).send({ error: error.message });
  }
});

export default router;
