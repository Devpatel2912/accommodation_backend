import express from "express";
import { supabase } from "../config/supabase.js";
import { verifyToken } from "../utils/jwt.js";
import { sendMemberBookingEmail, sendRequestConfirmationEmail } from "../utils/email.js";
import multer from "multer";
import * as xlsx from "xlsx";

const router = express.Router();
console.log("✅ Requests Routes Loaded");

// PING ROUTE FOR TESTING
router.get("/ping", (req, res) => res.json({ message: "Requests route is working" }));

// Middleware to authenticate requests using JWT
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  try {
    const decoded = verifyToken(token);
    req.user = decoded; // { id, email, role } from createAuthToken
    next();
  } catch (error) {
    res.status(403).json({ error: "Invalid or expired token" });
  }
};



// GET PREVIOUSLY ADDED MEMBERS (FOR SUGGESTIONS)
router.get("/members/suggestions", authenticateToken, async (req, res) => {
  const user_id = req.user.id;

  try {
    // 1. Get all request IDs for this user
    const { data: requests, error: reqError } = await supabase
      .from("requests")
      .select("id")
      .eq("user_id", user_id);

    if (reqError) throw reqError;

    if (!requests || requests.length === 0) {
      return res.json({ success: true, members: [] });
    }

    const requestIds = requests.map(r => r.id);

    // 2. Get all members for these requests
    const { data: members, error: memError } = await supabase
      .from("request_members")
      .select("*")
      .in("request_id", requestIds);

    if (memError) throw memError;

    // 3. Deduplicate members by name + contact + email
    const uniqueMembers = [];
    const seen = new Set();
    members.forEach(m => {
      const key = `${m.name}-${m.contact}-${m.email}`.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        uniqueMembers.push(m);
      }
    });

    res.json({ success: true, members: uniqueMembers });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =========================
// CREATE NEW REQUEST
// =========================
router.post("/", authenticateToken, async (req, res) => {
  const { check_in, check_out, total_people, notes, status, members } = req.body;
  const user_id = req.user.id; // Extracted securely from token

  // Basic validation
  if (!check_in || !check_out || !total_people || !members || !Array.isArray(members)) {
    return res.status(400).json({ error: "Missing required fields or invalid members array" });
  }

  try {
    // 1. Fetch requester's pradesh for automation
    const { data: userProfile } = await supabase
      .from("users")
      .select("pradesh")
      .eq("id", user_id)
      .single();

    const userPradesh = userProfile?.pradesh || null;

    // 2. Insert into 'requests' table
    const { data: requestData, error: requestError } = await supabase
      .from("requests")
      .insert([
        {
          user_id,
          check_in,
          check_out,
          total_people,
          notes: notes || null,
          status: status || undefined
        }
      ])
      .select()
      .single();

    if (requestError) {
      return res.status(400).json({ error: requestError.message });
    }

    const requestId = requestData.id;

    // 3. Format and insert into 'request_members' table
    const membersData = members.map((member) => ({
      request_id: requestId,
      name: member.name,
      contact: member.contact || null,
      pradesh: member.pradesh || userPradesh, // Use member's pradesh or fallback to requester's pradesh
      email: member.email || null,
    }));

    const { error: membersError } = await supabase
      .from("request_members")
      .insert(membersData);

    if (membersError) {
      return res.status(400).json({
        error: "Request created but failed to add members: " + membersError.message,
        requestId
      });
    }

    // 3. Send Confirmation Email to User
    try {
      const { data: userData } = await supabase
        .from("users")
        .select("email")
        .eq("id", user_id)
        .single();

      if (userData?.email) {
        await sendRequestConfirmationEmail(userData.email, requestData);
      }
    } catch (emailErr) {
      console.error("Failed to send confirmation email:", emailErr);
    }

    // Success response
    res.status(201).json({
      success: true,
      message: "Request and members successfully created. Confirmation email sent.",
      request: requestData
    });

  } catch (error) {
    console.error("Error creating request:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
// GET MY REQUESTS + ALLOCATION
// =========================
router.get("/my", authenticateToken, async (req, res) => {
  const user_id = req.user.id;

  try {
    // 1. GET ALL USER REQUESTS WITH MEMBERS
    const { data: requests, error } = await supabase
      .from("requests")
      .select("*, request_members(*)")
      .eq("user_id", user_id)
      .order("created_at", { ascending: false });

    if (error) {
      return res.status(400).json({ error: error.message });
    }

    const result = [];

    // 2. LOOP EACH REQUEST
    for (let reqItem of requests) {
      let allocationData = null;

      // ✅ IF APPROVED or ACCEPTED
      const isProcessed = reqItem.status === "ACCEPTED" || reqItem.status === "APPROVED";
      if (isProcessed) {

        // 2.1 GET ALLOCATION
        const { data: allocation } = await supabase
          .from("allocations")
          .select("*")
          .eq("request_id", reqItem.id)
          .maybeSingle(); // safer than .single()

        if (allocation) {

          // 2.2 GET ALLOCATION ITEMS
          const { data: items } = await supabase
            .from("allocation_items")
            .select(`
              id,
              room_id,
              house_id,
              assigned_capacity,
              rooms (
                room_number,
                capacity
              ),
              houses (
                owner_name
              ),
              member_allocations (
                id,
                request_member_id,
                request_members (*)
              )
            `)
            .eq("allocation_id", allocation.id);

          allocationData = {
            ...allocation,
            items: items || []
          };
        }
      }

      result.push({
        ...reqItem,
        allocation: allocationData
      });
    }

    res.json({
      success: true,
      requests: result
    });

  } catch (error) {
    console.error("Fetch requests error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});



// =========================
// UPLOAD MEMBERS VIA EXCEL/CSV
// =========================
const upload = multer({ storage: multer.memoryStorage() });

router.post("/:id/upload-members", authenticateToken, upload.single("file"), async (req, res) => {
  const { id: requestId } = req.params;

  if (!req.file) {
    return res.status(400).json({ error: "Please upload an Excel or CSV file" });
  }

  try {
    // 1. Read the file from buffer
    const workbook = xlsx.read(req.file.buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = xlsx.utils.sheet_to_json(sheet);

    if (rows.length === 0) {
      return res.status(400).json({ error: "The uploaded file is empty" });
    }

    // 2. Format data for Supabase
    // Expected columns: name, contact, pradesh, email (Case-insensitive)
    const membersData = rows.map((row) => {
      // Find keys regardless of case
      const findVal = (key) => {
        const foundKey = Object.keys(row).find(k => k.toLowerCase() === key.toLowerCase());
        return foundKey ? row[foundKey] : null;
      };

      return {
        request_id: requestId,
        name: findVal("name"),
        contact: findVal("contact")?.toString() || null,
        pradesh: findVal("pradesh") || null,
        email: findVal("email") || null
      };
    }).filter(m => m.name); // Only keep rows that have a name

    if (membersData.length === 0) {
      return res.status(400).json({ error: "No valid member data found (Name is required)" });
    }

    // 3. Insert into Supabase
    const { error: membersError } = await supabase
      .from("request_members")
      .insert(membersData);

    if (membersError) {
      return res.status(400).json({ error: "Failed to upload members: " + membersError.message });
    }

    res.json({
      success: true,
      message: `Successfully uploaded ${membersData.length} members`,
      count: membersData.length
    });

  } catch (error) {
    console.error("Excel Upload Error:", error);
    res.status(500).json({ error: "Failed to process the Excel file" });
  }
});


// =========================
// FORWARD BOOKING DETAILS TO MEMBERS
// =========================
router.post("/:id/forward-to-members", authenticateToken, async (req, res) => {
  const { id: requestId } = req.params;
  const { member_ids } = req.body; // Array of member IDs to email

  if (!Array.isArray(member_ids) || member_ids.length === 0) {
    return res.status(400).json({ error: "Please select at least one member to forward to" });
  }

  try {
    // 1. Get Request + Allocation Details + Requester Info + ALL Members
    const { data: request, error: reqError } = await supabase
      .from("requests")
      .select(`
        *,
        users (name, email, phone),
        request_members (*),
        allocations (
          *,
          allocation_items (
            *,
            rooms (room_number),
            houses (owner_name),
            member_allocations (*)
          )
        )
      `)
      .eq("id", requestId)
      .single();

    if (reqError) {
      console.error("Supabase Query Error in forward-to-members:", reqError.message);
      return res.status(500).json({ error: "Database error: " + reqError.message });
    }

    if (!request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Role-based check: Only owner or admin can forward
    if (req.user.role !== "ADMIN" && request.user_id !== req.user.id) {
      return res.status(403).json({ error: "You do not have permission to forward this request" });
    }

    if (request.status !== "ACCEPTED") {
      return res.status(400).json({ error: "Booking is not yet approved" });
    }

    // 2. Get the specific members we want to email (the recipients)
    const recipients = request.request_members.filter(m => member_ids.includes(m.id));

    if (recipients.length === 0) return res.status(400).json({ error: "No valid members found to email" });

    // 3. Send Email to each selected recipient
    let sentCount = 0;
    const requester = request.users || {};
    const allMembers = request.request_members || [];

    for (const member of recipients) {
      if (!member.email) continue;

      // Find which room/house this member is in
      let location = "Not assigned yet";

      if (request.allocations) {
        const allocationsArray = Array.isArray(request.allocations) ? request.allocations : [request.allocations];

        for (const alloc of allocationsArray) {
          if (!alloc.allocation_items) continue;

          for (const item of alloc.allocation_items) {
            if (!item.member_allocations) continue;

            const isAssigned = item.member_allocations.some(ma => ma.request_member_id === member.id);
            if (isAssigned) {
              location = item.rooms ? `Room ${item.rooms.room_number}` : (item.houses ? `House ${item.houses.owner_name}` : "Assigned");
              break;
            }
          }
          if (location !== "Not assigned yet") break;
        }
      }

      await sendMemberBookingEmail(member.email, member.name, {
        location,
        check_in: request.check_in,
        check_out: request.check_out,
        requesterName: requester.name || "N/A",
        requesterEmail: requester.email || "N/A",
        requesterPhone: requester.phone || "N/A",
        allMembers: allMembers // Pass all members to be shown in the email
      });
      sentCount++;
    }

    res.json({ success: true, message: `Details forwarded to ${sentCount} members` });

  } catch (error) {
    console.error("Forwarding Error:", error);
    res.status(500).json({ error: "Failed to forward details: " + error.message });
  }
});


// =========================
// DELETE / CANCEL REQUEST
// =========================
router.delete("/:id", authenticateToken, async (req, res) => {
  const { id: requestId } = req.params;
  const user_id = req.user.id;

  try {
    // 1. Check if the request exists and belongs to the user
    const { data: request, error: fetchError } = await supabase
      .from("requests")
      .select("*")
      .eq("id", requestId)
      .single();

    if (fetchError || !request) {
      return res.status(404).json({ error: "Request not found" });
    }

    // Role-based check: Only owner or admin can delete
    if (req.user.role !== "ADMIN" && request.user_id !== user_id) {
      return res.status(403).json({ error: "You do not have permission to delete this request" });
    }

    // 2. Delete the request (Cascading delete should handle members if configured, but let's be explicit if needed)
    // In many Supabase setups, you'd have ON DELETE CASCADE. 
    // If not, we should delete members first.
    
    // Explicitly delete members first to avoid foreign key violations
    await supabase
      .from("request_members")
      .delete()
      .eq("request_id", requestId);

    // Also delete any allocations if they exist (though usually requests in PENDING status are the ones being cancelled)
    // But for completeness:
    await supabase
      .from("allocations")
      .delete()
      .eq("request_id", requestId);

    const { error: deleteError } = await supabase
      .from("requests")
      .delete()
      .eq("id", requestId);

    if (deleteError) {
      return res.status(400).json({ error: "Failed to delete request: " + deleteError.message });
    }

    res.json({
      success: true,
      message: "Request deleted successfully"
    });

  } catch (error) {
    console.error("Delete Request Error:", error);
    res.status(500).json({ error: "Internal server error" });
  }
});


export default router;
