import { supabase } from "../config/supabase.js";
import { sendRequestStatusEmail } from "../utils/email.js";
import dotenv from "dotenv";
dotenv.config();

async function triggerNotification() {
  const requestId = 4;
  console.log(`🚀 Triggering notification for Request ID: ${requestId}...`);

  // 1. Fetch Request with all details (similar to admin.js logic)
  const { data: fullRequest, error: fetchError } = await supabase
    .from("requests")
    .select(`
      *,
      request_members (*),
      allocations (
        *,
        allocation_items (
          *,
          rooms (*),
          houses (*),
          member_allocations (*)
        )
      )
    `)
    .eq("id", requestId)
    .single();

  if (fetchError || !fullRequest) {
    console.error("❌ Error fetching request details:", fetchError?.message || "Not found");
    return;
  }

  // 2. Fetch User Email
  const { data: userData } = await supabase
    .from("users")
    .select("email")
    .eq("id", fullRequest.user_id)
    .single();

  if (!userData?.email) {
    console.error("❌ User email not found");
    return;
  }

  // 3. Format Allocation Details for Email
  const allocationDetails = {
    check_in: fullRequest.check_in,
    check_out: fullRequest.check_out,
    allocations: []
  };

  if (fullRequest.allocations) {
    const allocationsArray = Array.isArray(fullRequest.allocations) ? fullRequest.allocations : [fullRequest.allocations];
    allocationsArray.forEach(alloc => {
      if (alloc.allocation_items) {
        const itemsArray = Array.isArray(alloc.allocation_items) ? alloc.allocation_items : [alloc.allocation_items];
        itemsArray.forEach(item => {
          const location = item.rooms ? `Room ${item.rooms.room_number}` : (item.houses ? `House ${item.houses.name}` : "Assigned");
          if (item.member_allocations) {
            const maArray = Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations];
            maArray.forEach(ma => {
              const member = fullRequest.request_members.find(m => m.id === ma.request_member_id);
              if (member) {
                allocationDetails.allocations.push({
                  member_name: member.name,
                  location: location
                });
              }
            });
          }
        });
      }
    });
  }

  // 4. Send Email
  try {
    await sendRequestStatusEmail(
      userData.email,
      fullRequest.status,
      fullRequest.notes || "System Triggered Notification",
      fullRequest.status === "ACCEPTED" ? allocationDetails : null
    );
    console.log(`✅ Success! Notification sent to: ${userData.email}`);
  } catch (error) {
    console.error("❌ Email sending failed:", error.message);
  }
}

triggerNotification();
