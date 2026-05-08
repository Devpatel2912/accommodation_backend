import { supabase } from "../config/supabase.js";

/**
 * Sends a real-time notification using Supabase Broadcast (PubSub).
 * This is used for immediate UI updates when a request is created, approved, or cancelled.
 * 
 * @param {string} channelName - The channel to broadcast to (e.g., 'admin-notifications' or 'user-notifications')
 * @param {string} event - The event name (e.g., 'new_request', 'request_approved')
 * @param {object} payload - The data to send
 */
export const sendPubSubNotification = async (channelName, event, payload) => {
  return new Promise((resolve, reject) => {
    try {
      console.log(`📡 Attempting PubSub Broadcast: [${channelName}] ${event}`);
      
      const channel = supabase.channel(channelName);
      
      channel.subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          console.log(`✅ Subscribed to channel [${channelName}], sending message...`);
          
          const result = await channel.send({
            type: 'broadcast',
            event: event,
            payload: {
              ...payload,
              timestamp: new Date().toISOString()
            }
          });

          console.log(`📤 Message sent status: ${result}`);
          
          // Small delay before removing to ensure it's out
          setTimeout(() => {
            supabase.removeChannel(channel);
            resolve(result);
          }, 100);
        }
        
        if (status === 'CHANNEL_ERROR') {
          console.error(`❌ Channel error on [${channelName}]`);
          reject(new Error(`Channel error on ${channelName}`));
        }
      });

    } catch (err) {
      console.error("❌ PubSub Notification Error:", err.message);
      reject(err);
    }
  });
};
