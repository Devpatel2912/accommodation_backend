import admin from "../config/firebase.js";

export const sendToTopic = async (req, res) => {
  const { topic, title, body, data } = req.body;
  if (!topic || !title || !body) {
    return res.status(400).send({ error: "Missing required fields: topic, title, body" });
  }

  const message = {
    notification: { title, body },
    data: data || {},
    topic,
    android: {
      priority: "high",
      ttl: 86400 * 1000,
      notification: {
        channel_id: "high_importance_channel",
        priority: "max",
        click_action: "FLUTTER_NOTIFICATION_CLICK",
        visibility: "public"
      }
    }
  };

  try {
    const response = await admin.messaging().send(message);
    console.log("Successfully sent message to FCM:", response);
    res.status(200).send({ success: true, messageId: response });
  } catch (error) {
    console.error("Error sending message to FCM:", error);
    res.status(500).send({ error: error.message });
  }
};
