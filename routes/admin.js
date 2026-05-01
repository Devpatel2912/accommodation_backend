import express from "express";
import { supabase } from "../config/supabase.js";
import { verifyToken } from "../utils/jwt.js";
import { sendRequestStatusEmail } from "../utils/email.js";

const router = express.Router();

// =========================
// AUTH MIDDLEWARE
// =========================
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];

  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  try {
    req.user = verifyToken(token);
    next();
  } catch {
    res.status(403).json({ error: "Invalid token" });
  }
};

// =========================
// ADMIN CHECK
// =========================
const authorizeAdmin = (req, res, next) => {
  if (req.user?.role?.toUpperCase() === "ADMIN") return next();
  return res.status(403).json({ error: "Admin only" });
};

// =========================
// 📧 NOTIFICATION HELPER
// =========================
const notifyAllocationUpdate = async (requestId) => {
  try {
    console.log(`📧 Preparing allocation update email for Request ID: ${requestId}`);

    // 1. Fetch full request data with all nested info
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
      console.error("❌ Failed to fetch request for notification:", fetchError?.message);
      return;
    }

    // 2. Collect all recipient emails (Requester + all Members)
    const recipientEmails = new Set();

    // Requester Email
    const { data: userData } = await supabase
      .from("users")
      .select("id, name, phone, role, email, pradesh")
      .eq("id", fullRequest.user_id)
      .single();
    if (userData?.email) recipientEmails.add(userData.email);

    // Member Emails
    if (fullRequest.request_members) {
      fullRequest.request_members.forEach(m => {
        if (m.email) recipientEmails.add(m.email);
      });
    }

    if (recipientEmails.size === 0) {
      console.log("ℹ️ No recipient emails found, skipping notification.");
      return;
    }

    // 3. Format Allocation Details
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
            const location = item.rooms
              ? `Room ${item.rooms.room_number}`
              : (item.houses ? `${item.houses.owner_name} (${item.houses.address})` : "Assigned");
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

    // 4. Send Emails
    const isApprovedStatus = fullRequest.status === "ACCEPTED" || fullRequest.status.startsWith("APPROVED");

    for (const email of recipientEmails) {
      await sendRequestStatusEmail(
        email,
        fullRequest.status,
        fullRequest.notes,
        isApprovedStatus ? allocationDetails : null
      );
    }
    console.log(`✅ Allocation update emails sent to ${recipientEmails.size} recipients.`);
  } catch (err) {
    console.error("❌ notifyAllocationUpdate ERROR:", err.message);
  }
};



// =========================
// REQUESTS CRUD
// =========================

// GET ALL UNIQUE MEMBERS (ADMIN VIEW)
router.get("/members", authenticateToken, authorizeAdmin, async (req, res) => {
  console.log("🔍 ADMIN GET MEMBERS HIT");
  try {
    const { data: members, error } = await supabase
      .from("request_members")
      .select("*")
      .order("name", { ascending: true });

    if (error) throw error;

    // Deduplicate members by name + contact + email
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

// UPDATE MEMBER (Saves across all records with same identity to keep consistency)
router.put("/members/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { name, contact, email, pradesh } = req.body;

  try {
    // 1. Get the current member to find their "identity"
    const { data: currentMember, error: fetchError } = await supabase
      .from("request_members")
      .select("*")
      .eq("id", id)
      .single();

    if (fetchError || !currentMember) {
      return res.status(404).json({ error: "Member not found" });
    }

    // 2. Update ALL records that match this member's old identity
    const { error: updateError } = await supabase
      .from("request_members")
      .update({ name, contact, email, pradesh })
      .eq("name", currentMember.name)
      .eq("contact", currentMember.contact)
      .eq("email", currentMember.email);

    if (updateError) throw updateError;

    res.json({ success: true, message: "Member updated across all requests" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE MEMBER (Removes this specific record)
router.delete("/members/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from("request_members")
      .delete()
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true, message: "Member record deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET ALL REQUESTS WITH NESTED DATA
router.get("/requests", authenticateToken, authorizeAdmin, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("requests")
      .select(`
        *,
        request_members (*),
        allocations (
          *,
          allocation_items (
            *,
            member_allocations (*),
            rooms (*),
            houses (*)
          )
        )
      `)
      .order("created_at", { ascending: false });

    if (error) return res.status(400).json({ error: error.message });

    // Calculate unallocated members for each request
    const processedData = data.map(reqItem => {
      const allMembers = reqItem.request_members || [];
      const allocatedMemberIds = new Set();

      if (reqItem.allocations) {
        const allocList = Array.isArray(reqItem.allocations) ? reqItem.allocations : [reqItem.allocations];
        allocList.forEach(alloc => {
          if (alloc.allocation_items) {
            const itemList = Array.isArray(alloc.allocation_items) ? alloc.allocation_items : [alloc.allocation_items];
            itemList.forEach(item => {
              if (item.member_allocations) {
                const maList = Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations];
                maList.forEach(ma => {
                  allocatedMemberIds.add(ma.request_member_id);
                });
              }
            });
          }
        });
      }

      const pending_members = allMembers.filter(m => !allocatedMemberIds.has(m.id));
      return { ...reqItem, pending_members };
    });

    res.json({ success: true, requests: processedData });
  } catch (err) {
    console.error("GET /admin/requests ERROR:", err);
    res.status(500).json({ error: "Internal server error", details: err.message });
  }
});

// GET SINGLE REQUEST WITH NESTED DATA
router.get("/requests/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { data: reqItem, error } = await supabase
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
      .eq("id", id)
      .single();

    if (error || !reqItem) return res.status(404).json({ error: "Request not found" });

    // Calculate unallocated members
    const allMembers = reqItem.request_members || [];
    const allocatedMemberIds = new Set();

    if (reqItem.allocations) {
      const allocList = Array.isArray(reqItem.allocations) ? reqItem.allocations : [reqItem.allocations];
      allocList.forEach(alloc => {
        if (alloc.allocation_items) {
          const itemList = Array.isArray(alloc.allocation_items) ? alloc.allocation_items : [alloc.allocation_items];
          itemList.forEach(item => {
            if (item.member_allocations) {
              const maList = Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations];
              maList.forEach(ma => {
                allocatedMemberIds.add(ma.request_member_id);
              });
            }
          });
        }
      });
    }

    const pending_members = allMembers.filter(m => !allocatedMemberIds.has(m.id));

    res.json({ success: true, request: { ...reqItem, pending_members } });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// UPDATE REQUEST STATUS/DETAILS
router.put("/requests/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, notes, ...otherUpdates } = req.body;

  try {
    const { data, error } = await supabase
      .from("requests")
      .update({
        status,
        notes: notes || undefined,
        ...otherUpdates
      })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    // 📧 SEND EMAIL IF CANCELLED (REJECTED) BY ADMIN
    if (status === 'CANCELLED') {
      try {
        console.log(`📧 Admin cancelled request ${id}, sending notification...`);
        const { data: user } = await supabase
          .from("users")
          .select("email")
          .eq("id", data.user_id)
          .single();

        if (user?.email) {
          await sendRequestStatusEmail(user.email, 'REJECTED', notes || 'Your request has been cancelled by the administrator.');
          console.log(`✅ Rejection email sent to: ${user.email}`);
        }
      } catch (emailErr) {
        console.error("❌ Failed to send rejection email:", emailErr);
      }
    }

    res.json({ success: true, message: "Request updated successfully", request: data });
  } catch (err) {
    console.error("UPDATE /admin/requests/:id ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// DELETE REQUEST
router.delete("/requests/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  await supabase.from("request_members").delete().eq("request_id", id);

  const { error } = await supabase
    .from("requests")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "Request deleted" });
});



// =========================
// ALLOCATIONS CRUD
// =========================

// CREATE ALLOCATION (WITH OPTIONAL ITEMS)
router.post("/allocations", authenticateToken, authorizeAdmin, async (req, res) => {
  const { request_id, items } = req.body;

  try {
    const { data: allocation, error: allocError } = await supabase
      .from("allocations")
      .insert([{ request_id }])
      .select()
      .single();

    if (allocError) return res.status(400).json({ error: allocError.message });

    if (Array.isArray(items) && items.length > 0) {
      const itemsData = items.map(item => ({
        allocation_id: allocation.id,
        room_id: item.room_id || null,
        house_id: item.room_id ? null : (item.house_id || null),
        allocation_type: item.room_id ? "ROOM" : "HOUSE",
        assigned_capacity: item.assigned_capacity
      }));

      const { error: itemsError } = await supabase
        .from("allocation_items")
        .insert(itemsData);

      if (itemsError) {
        return res.status(400).json({ error: "Allocation created but items failed: " + itemsError.message });
      }
    }

    res.json({ success: true, allocation });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET ALL ALLOCATIONS WITH ITEMS
router.get("/allocations", authenticateToken, authorizeAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("allocations")
    .select("*, allocation_items(*)");

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, allocations: data });
});

// GET SINGLE ALLOCATION WITH ITEMS
router.get("/allocations/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("allocations")
    .select(`
      *,
      allocation_items (
        id,
        room_id,
        assigned_capacity,
        rooms (room_number, capacity)
      )
    `)
    .eq("id", id)
    .single();

  if (error) return res.status(404).json({ error: "Not found" });

  res.json({ success: true, allocation: data });
});

// UPDATE ALLOCATION (WITH OPTIONAL ITEMS SYNC)
router.put("/allocations/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { items, ...allocationUpdates } = req.body;

  try {
    if (Object.keys(allocationUpdates).length > 0) {
      const { error: updateError } = await supabase
        .from("allocations")
        .update(allocationUpdates)
        .eq("id", id);

      if (updateError) return res.status(400).json({ error: updateError.message });
    }

    if (Array.isArray(items)) {
      // Full sync: Delete and re-insert
      await supabase.from("allocation_items").delete().eq("allocation_id", id);

      if (items.length > 0) {
        const itemsData = items.map(item => ({
          allocation_id: id,
          room_id: item.room_id || null,
          house_id: item.room_id ? null : (item.house_id || null),
          allocation_type: item.room_id ? "ROOM" : "HOUSE",
          assigned_capacity: item.assigned_capacity
        }));

        const { error: itemsError } = await supabase
          .from("allocation_items")
          .insert(itemsData);

        if (itemsError) return res.status(400).json({ error: itemsError.message });
      }
    }

    res.json({ success: true, message: "Allocation updated successfully" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE ALLOCATION
router.delete("/allocations/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  await supabase
    .from("allocation_items")
    .delete()
    .eq("allocation_id", id);

  const { error } = await supabase
    .from("allocations")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "Allocation deleted" });
});



// =========================
// ALLOCATION ITEMS CRUD
// =========================

// CREATE ITEM (WITH OPTIONAL MEMBER LINKS)
router.post("/allocation-items", authenticateToken, authorizeAdmin, async (req, res) => {
  const { allocation_id, room_id, house_id, assigned_capacity, member_ids } = req.body;

  try {
    const { data: item, error: itemError } = await supabase
      .from("allocation_items")
      .insert([{
        allocation_id,
        room_id: room_id || null,
        house_id: room_id ? null : (house_id || null),
        allocation_type: room_id ? "ROOM" : "HOUSE",
        assigned_capacity
      }])
      .select()
      .single();

    if (itemError) return res.status(400).json({ error: itemError.message });

    if (Array.isArray(member_ids) && member_ids.length > 0) {
      const maData = member_ids.map(mId => ({
        request_member_id: mId,
        allocation_item_id: item.id
      }));

      await supabase.from("member_allocations").insert(maData);
    }

    res.json({ success: true, item });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET ALL ITEMS
router.get("/allocation-items", authenticateToken, authorizeAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("allocation_items")
    .select("*");

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, items: data });
});

// UPDATE ITEM (WITH OPTIONAL MEMBER SYNC)
router.put("/allocation-items/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { member_ids, ...itemUpdates } = req.body;

  try {
    // Handle mutual exclusivity and type switching if room_id or house_id is provided
    if (itemUpdates.room_id) {
      itemUpdates.house_id = null;
      itemUpdates.allocation_type = "ROOM";
    } else if (itemUpdates.house_id) {
      itemUpdates.room_id = null;
      itemUpdates.allocation_type = "HOUSE";
    }

    if (Object.keys(itemUpdates).length > 0) {
      const { error: updateError } = await supabase
        .from("allocation_items")
        .update(itemUpdates)
        .eq("id", id);

      if (updateError) return res.status(400).json({ error: updateError.message });
    }

    if (Array.isArray(member_ids)) {
      await supabase.from("member_allocations").delete().eq("allocation_item_id", id);

      if (member_ids.length > 0) {
        const maData = member_ids.map(mId => ({
          request_member_id: mId,
          allocation_item_id: id
        }));

        await supabase.from("member_allocations").insert(maData);
      }
    }

    res.json({ success: true, message: "Allocation item updated" });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE ITEM
router.delete("/allocation-items/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("allocation_items")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "Item deleted" });
});

// =========================
// USERS CRUD (ADMIN)
// =========================

// CREATE USER / ADMIN
router.post("/users", authenticateToken, authorizeAdmin, async (req, res) => {
  const { name, email, phone, role, pradesh, password_hash } = req.body;

  const { data, error } = await supabase
    .from("users")
    .insert([{ name, email, phone, role, pradesh, password_hash }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, user: data });
});


// GET ALL USERS
router.get("/users", authenticateToken, authorizeAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .order("id", { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, users: data });
});


// GET SINGLE USER
router.get("/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "User not found" });
  }

  res.json({ success: true, user: data });
});

// GET MEMBERS ADDED BY A SPECIFIC USER
router.get("/users/:id/members", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    // 1. Get all requests by this user
    const { data: requests, error: reqError } = await supabase
      .from("requests")
      .select("id")
      .eq("user_id", id);

    if (reqError) throw reqError;

    if (!requests || requests.length === 0) {
      return res.json({ success: true, members: [] });
    }

    const requestIds = requests.map(r => r.id);

    // 2. Get all members for these requests
    const { data: members, error: memError } = await supabase
      .from("request_members")
      .select("*")
      .in("request_id", requestIds)
      .order("name", { ascending: true });

    if (memError) throw memError;

    // Deduplicate
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


// UPDATE USER / ADMIN
router.put("/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("users")
    .update(req.body)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, user: data });
});


// DELETE USER / ADMIN
router.delete("/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("users")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "User deleted" });
});

// =========================
// ROOMS SEARCH (ADMIN)
// =========================

// GET AVAILABLE ROOMS FOR DATE RANGE
router.get("/rooms/available", authenticateToken, authorizeAdmin, async (req, res) => {
  const { check_in, check_out } = req.query;

  if (!check_in || !check_out) {
    return res.status(400).json({ error: "Please provide check_in and check_out dates." });
  }

  try {
    const { data: allRooms, error: roomsError } = await supabase
      .from("rooms")
      .select("*")
      .eq("is_active", true);

    if (roomsError) throw roomsError;

    const { data: bookings, error: bookingsError } = await supabase
      .from("room_bookings")
      .select("room_id")
      .lte("check_in", check_out)
      .gte("check_out", check_in);

    if (bookingsError) throw bookingsError;

    const occupiedRoomIds = new Set(bookings.map(b => b.room_id));
    const availableRooms = allRooms.filter(room => !occupiedRoomIds.has(room.id));

    res.json({ success: true, rooms: availableRooms });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET AVAILABLE HOUSES FOR DATE RANGE
router.get("/houses/available", authenticateToken, authorizeAdmin, async (req, res) => {
  const { check_in, check_out } = req.query;

  if (!check_in || !check_out) {
    return res.status(400).json({ error: "Please provide check_in and check_out dates." });
  }

  try {
    // 1. Get all active houses
    const { data: allHouses, error: housesError } = await supabase
      .from("houses")
      .select("*")
      .eq("is_active", true);

    if (housesError) throw housesError;

    // 2. Get all overlapping house bookings
    const { data: bookings, error: bookingsError } = await supabase
      .from("house_bookings")
      .select("house_id")
      .lte("check_in", check_out)
      .gte("check_out", check_in);

    if (bookingsError) throw bookingsError;

    // 3. Filter out booked houses
    const occupiedHouseIds = new Set(bookings.map(b => b.house_id));
    const availableHouses = allHouses.filter(house => !occupiedHouseIds.has(house.id));

    res.json({ success: true, houses: availableHouses });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// MEMBERS CRUD (ADMIN)
// =========================

router.put("/requests/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { members, ...requestUpdates } = req.body;

  try {
    // 1. UPDATE REQUEST
    const { data: request, error } = await supabase
      .from("requests")
      .update(requestUpdates)
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });


    // 2. IF MEMBERS PROVIDED → REPLACE ALL
    if (Array.isArray(members)) {
      // delete old members
      await supabase
        .from("request_members")
        .delete()
        .eq("request_id", id);

      // insert new members
      const membersData = members.map((m) => ({
        request_id: id,
        name: m.name,
        contact: m.contact || null,
        pradesh: m.pradesh || null,
        email: m.email || null
      }));

      await supabase
        .from("request_members")
        .insert(membersData);
    }

    // 3. FETCH FULL DATA TO RETURN
    const { data: fullRequest } = await supabase
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
      .eq("id", id)
      .single();

    // ✅ SEND EMAIL IF STATUS CHANGED
    if (requestUpdates.status) {
      await notifyAllocationUpdate(id);
    } else {
      console.log("ℹ️ No status update in request body, skipping email logic.");
    }

    res.json({
      success: true,
      message: "Request + members updated",
      request: fullRequest
    });

  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// =========================
// ROOM BOOKINGS CRUD (ADMIN)
// =========================

// CREATE BOOKING
router.post("/room-bookings", authenticateToken, authorizeAdmin, async (req, res) => {
  const { room_id, request_id, check_in, check_out, status } = req.body;

  const { data, error } = await supabase
    .from("room_bookings")
    .insert([{
      room_id,
      request_id,
      check_in,
      check_out
    }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, booking: data });
});


// GET ALL BOOKINGS (WITH NESTED DATA)
router.get("/room-bookings", authenticateToken, authorizeAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("*, rooms(*), requests(*)")
    .order("id", { ascending: true });

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, bookings: data });
});


// GET SINGLE BOOKING
router.get("/room-bookings/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("room_bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Booking not found" });
  }

  res.json({ success: true, booking: data });
});


// UPDATE BOOKING
router.put("/room-bookings/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("room_bookings")
    .update(req.body)
    .eq("id", id)
    .select();

  if (error) return res.status(400).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: "Booking not found" });

  res.json({ success: true, booking: data[0] });
});


// DELETE BOOKING
router.delete("/room-bookings/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("room_bookings")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "Booking deleted" });
});

// RELEASE ROOM (EARLY CHECKOUT)
router.post("/room-bookings/:id/release", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  try {
    const { data, error } = await supabase
      .from("room_bookings")
      .update({ check_out: today })
      .eq("id", id)
      .select();

    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: "Booking not found" });

    res.json({ success: true, message: "Room released successfully", booking: data[0] });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// RELEASE ROOM BY ROOM ID (Find active booking and release)
router.post("/rooms/:room_id/release", authenticateToken, authorizeAdmin, async (req, res) => {
  const { room_id } = req.params;
  const today = new Date().toISOString().split("T")[0];

  try {
    // 1. Look for a booking active TODAY
    let { data: booking, error: findError } = await supabase
      .from("room_bookings")
      .select("id")
      .eq("room_id", room_id)
      .lte("check_in", today)
      .gte("check_out", today)
      .single();

    // 2. If no one is there today, find the NEXT upcoming booking
    if (findError || !booking) {
      const { data: futureBooking, error: futureError } = await supabase
        .from("room_bookings")
        .select("id")
        .eq("room_id", room_id)
        .gt("check_in", today)
        .order("check_in", { ascending: true })
        .limit(1)
        .single();

      if (futureError || !futureBooking) {
        return res.status(404).json({ error: "No active or upcoming bookings found for this room." });
      }
      booking = futureBooking;
    }

    // 3. Handle based on whether it has started
    const { data: fullBooking, error: fetchError } = await supabase
      .from("room_bookings")
      .select("*")
      .eq("id", booking.id)
      .single();

    if (fetchError) throw fetchError;

    if (fullBooking.check_in > today) {
      // FUTURE BOOKING: Delete it (Cancellation)
      await supabase.from("room_bookings").delete().eq("id", booking.id);
      return res.json({ success: true, message: `Future booking for room ${room_id} cancelled.` });
    } else {
      // ACTIVE BOOKING: Update check_out to today (Early Release)
      const { data, error } = await supabase
        .from("room_bookings")
        .update({ check_out: today })
        .eq("id", booking.id)
        .select()
        .single();

      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true, message: `Room ${room_id} released successfully`, booking: data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// =========================
// MEMBER ALLOCATIONS CRUD (ADMIN)
// =========================

// CREATE MEMBER ALLOCATION
router.post("/member-allocations", authenticateToken, authorizeAdmin, async (req, res) => {
  const { request_member_id, allocation_item_id } = req.body;

  const { data, error } = await supabase
    .from("member_allocations")
    .insert([{ request_member_id, allocation_item_id }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, allocation: data });
});


// GET ALL MEMBER ALLOCATIONS
router.get("/member-allocations", authenticateToken, authorizeAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("member_allocations")
    .select("*");

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, allocations: data });
});


// GET SINGLE MEMBER ALLOCATION
router.get("/member-allocations/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("member_allocations")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Not found" });
  }

  res.json({ success: true, allocation: data });
});


// UPDATE MEMBER ALLOCATION
router.put("/member-allocations/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("member_allocations")
    .update(req.body)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, allocation: data });
});


// DELETE MEMBER ALLOCATION
router.delete("/member-allocations/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("member_allocations")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "Deleted successfully" });
});

// =========================
// HOUSE BOOKINGS CRUD (ADMIN)
// =========================

// CREATE HOUSE BOOKING
router.post("/house-bookings", authenticateToken, authorizeAdmin, async (req, res) => {
  const { house_id, request_id, check_in, check_out } = req.body;

  const { data, error } = await supabase
    .from("house_bookings")
    .insert([{ house_id, request_id, check_in, check_out }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Automatically update request status to ACCEPTED
  await supabase
    .from("requests")
    .update({ status: 'ACCEPTED' })
    .eq("id", request_id);

  // ✅ Notify user of the new house allocation
  await notifyAllocationUpdate(request_id);

  res.json({ success: true, booking: data });
});


// GET ALL HOUSE BOOKINGS (WITH NESTED DATA)
router.get("/house-bookings", authenticateToken, authorizeAdmin, async (req, res) => {
  const { data, error } = await supabase
    .from("house_bookings")
    .select("*, houses(*), requests(*)");

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, bookings: data });
});


// GET SINGLE HOUSE BOOKING
router.get("/house-bookings/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("house_bookings")
    .select("*")
    .eq("id", id)
    .single();

  if (error || !data) {
    return res.status(404).json({ error: "Booking not found" });
  }

  res.json({ success: true, booking: data });
});


// UPDATE HOUSE BOOKING
router.put("/house-bookings/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { data, error } = await supabase
    .from("house_bookings")
    .update(req.body)
    .eq("id", id)
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, booking: data });
});


// DELETE HOUSE BOOKING
router.delete("/house-bookings/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  const { error } = await supabase
    .from("house_bookings")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  res.json({ success: true, message: "House booking deleted" });
});

// RELEASE HOUSE (EARLY CHECKOUT)
router.post("/house-bookings/:id/release", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  try {
    const { data, error } = await supabase
      .from("house_bookings")
      .update({ check_out: today })
      .eq("id", id)
      .select()
      .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, message: "House released successfully", booking: data });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// RELEASE HOUSE BY HOUSE ID (Find active booking and release)
router.post("/houses/:house_id/release", authenticateToken, authorizeAdmin, async (req, res) => {
  const { house_id } = req.params;
  const today = new Date().toISOString().split("T")[0];

  try {
    // 1. Look for booking active TODAY
    let { data: booking, error: findError } = await supabase
      .from("house_bookings")
      .select("id")
      .eq("house_id", house_id)
      .lte("check_in", today)
      .gte("check_out", today)
      .single();

    // 2. If none today, find the NEXT upcoming booking
    if (findError || !booking) {
      const { data: futureBooking, error: futureError } = await supabase
        .from("house_bookings")
        .select("id")
        .eq("house_id", house_id)
        .gt("check_in", today)
        .order("check_in", { ascending: true })
        .limit(1)
        .single();

      if (futureError || !futureBooking) {
        return res.status(404).json({ error: "No active or upcoming bookings found for this house." });
      }
      booking = futureBooking;
    }

    // 3. Handle based on whether it has started
    const { data: fullBooking, error: fetchError } = await supabase
      .from("house_bookings")
      .select("*")
      .eq("id", booking.id)
      .single();

    if (fetchError) throw fetchError;

    if (fullBooking.check_in > today) {
      // FUTURE BOOKING: Delete it (Cancellation)
      await supabase.from("house_bookings").delete().eq("id", booking.id);
      return res.json({ success: true, message: `Future booking for house ${house_id} cancelled.` });
    } else {
      // ACTIVE BOOKING: Update check_out to today (Early Release)
      const { data, error } = await supabase
        .from("house_bookings")
        .update({ check_out: today })
        .eq("id", booking.id)
        .select()
        .single();

      if (error) return res.status(400).json({ error: error.message });
      return res.json({ success: true, message: `House ${house_id} released successfully`, booking: data });
    }
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


// =========================
// EASY ALLOCATION (Simplified for Admin)
// =========================
router.post("/requests/:id/allocate-member", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id: request_id } = req.params;
  const { request_member_id, room_id, house_id, assigned_capacity = 1 } = req.body;

  console.log(`[ALLOCATE] Request: ${request_id}, Member: ${request_member_id}, Room: ${room_id}, House: ${house_id}`);

  try {
    // 1. Get request dates
    const { data: request, error: reqError } = await supabase
      .from("requests")
      .select("check_in, check_out")
      .eq("id", request_id)
      .single();

    if (reqError || !request) {
      console.error("[ALLOCATE] Request not found:", request_id);
      return res.status(404).json({ error: "Request not found" });
    }

    // 1.1 Capacity Check (If Room is selected)
    if (room_id) {
      const { data: room } = await supabase.from("rooms").select("capacity").eq("id", room_id).single();
      if (room) {
        // Find overlapping bookings
        const { data: activeBookings } = await supabase
          .from("room_bookings")
          .select("room_id, request_id")
          .lte("check_in", request.check_out)
          .gte("check_out", request.check_in);

        if (activeBookings && activeBookings.length > 0) {
          const roomIds = [...new Set(activeBookings.map(b => b.room_id))];
          const requestIds = [...new Set(activeBookings.map(b => b.request_id))];

          const { data: memberAllocations } = await supabase
            .from("member_allocations")
            .select("id, request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))")
            .in("allocation_items.room_id", roomIds)
            .in("allocation_items.allocations.request_id", requestIds);

          // Count unique members currently in THIS room for THESE dates
          const currentMembers = new Set();
          memberAllocations?.forEach(ma => {
            const rId = ma.allocation_items.room_id;
            const reqId = ma.allocation_items.allocations.request_id;

            const isValid = activeBookings.some(b => b.room_id === rId && b.request_id === reqId);
            if (isValid && rId === parseInt(room_id)) {
              currentMembers.add(ma.request_member_id);
            }
          });

          // If this member is NOT already in the room, check if adding them exceeds capacity
          if (!currentMembers.has(parseInt(request_member_id))) {
            if (currentMembers.size >= room.capacity) {
              return res.status(400).json({ error: `Room capacity exceeded. Only ${room.capacity} members allowed.` });
            }
          }
        }
      }
    }

    // 2. Find or Create Allocation for this request
    let { data: allocation, error: allocError } = await supabase
      .from("allocations")
      .select("id")
      .eq("request_id", request_id)
      .maybeSingle();

    if (!allocation) {
      console.log("[ALLOCATE] Creating new allocation entry for request:", request_id);
      const { data: newAlloc, error: createError } = await supabase
        .from("allocations")
        .insert([{ request_id }])
        .select()
        .single();
      if (createError) throw createError;
      allocation = newAlloc;
    }

    // 3. Find or Create Allocation Item
    let item;
    const filterCol = room_id ? "room_id" : "house_id";
    const filterVal = room_id || house_id;

    const { data: existingItems, error: itemsError } = await supabase
      .from("allocation_items")
      .select("id")
      .eq("allocation_id", allocation.id)
      .eq(filterCol, filterVal);

    if (existingItems && existingItems.length > 0) {
      item = existingItems[0];
      // Update capacity if more members are added
      await supabase
        .from("allocation_items")
        .update({ assigned_capacity })
        .eq("id", item.id);
    } else {
      console.log(`[ALLOCATE] Creating new allocation item for ${filterCol}: ${filterVal}`);
      const { data: newItem, error: createItemError } = await supabase
        .from("allocation_items")
        .insert([{
          allocation_id: allocation.id,
          room_id: room_id || null,
          house_id: house_id || null,
          allocation_type: room_id ? "ROOM" : "HOUSE",
          assigned_capacity: assigned_capacity
        }])
        .select()
        .single();
      if (createItemError) throw createItemError;
      item = newItem;
    }

    // 4. Create/Update Member Allocation
    const { data: existingMA, error: maFetchError } = await supabase
      .from("member_allocations")
      .select("id, allocation_item_id, allocation_items(room_id, house_id)")
      .eq("request_member_id", request_member_id)
      .maybeSingle();

    let finalMA;
    if (existingMA) {
      console.log(`[ALLOCATE] Member ${request_member_id} already has allocation ${existingMA.id}. Updating to item ${item.id}`);

      const oldRoomId = existingMA.allocation_items?.room_id;
      const oldHouseId = existingMA.allocation_items?.house_id;

      const { data: updatedMA, error: updateMAError } = await supabase
        .from("member_allocations")
        .update({ allocation_item_id: item.id })
        .eq("id", existingMA.id)
        .select()
        .single();

      if (updateMAError) throw updateMAError;
      finalMA = updatedMA;

      // CLEANUP OLD BOOKING: If the member was moved, check if the old room/house is now empty for this request
      if (oldRoomId || oldHouseId) {
        // Check if any OTHER members from this same request are still in that old room/house
        let cleanupQuery = supabase
          .from("member_allocations")
          .select("id, allocation_items!inner(room_id, house_id, allocations!inner(request_id))")
          .eq("allocation_items.allocations.request_id", request_id);

        if (oldRoomId) {
          cleanupQuery = cleanupQuery.eq("allocation_items.room_id", oldRoomId);
        } else {
          cleanupQuery = cleanupQuery.eq("allocation_items.house_id", oldHouseId);
        }

        const { data: remainingMembers } = await cleanupQuery;

        if (!remainingMembers || remainingMembers.length === 0) {
          console.log(`[CLEANUP] No members left in ${oldRoomId ? 'room ' + oldRoomId : 'house ' + oldHouseId}. Removing old booking.`);
          if (oldRoomId) {
            await supabase.from("room_bookings").delete().eq("room_id", oldRoomId).eq("request_id", request_id);
          } else if (oldHouseId) {
            await supabase.from("house_bookings").delete().eq("house_id", oldHouseId).eq("request_id", request_id);
          }
        }
      }
    } else {
      console.log(`[ALLOCATE] Creating new member allocation for ${request_member_id} -> ${item.id}`);
      const { data: newMA, error: finalError } = await supabase
        .from("member_allocations")
        .insert([{
          request_member_id,
          allocation_item_id: item.id
        }])
        .select()
        .single();

      if (finalError) throw finalError;
      finalMA = newMA;
    }

    // 5. Create/Update Booking so room/house shows as occupied
    if (room_id) {
      // Check if booking exists to decide between insert or update
      const { data: existingBooking } = await supabase
        .from("room_bookings")
        .select("id")
        .eq("room_id", room_id)
        .eq("request_id", request_id)
        .maybeSingle();

      if (existingBooking) {
        await supabase
          .from("room_bookings")
          .update({
            check_in: request.check_in,
            check_out: request.check_out
          })
          .eq("id", existingBooking.id);
      } else {
        await supabase
          .from("room_bookings")
          .insert([{
            room_id,
            request_id,
            check_in: request.check_in,
            check_out: request.check_out
          }]);
      }
    } else if (house_id) {
      const { data: existingHouseBooking } = await supabase
        .from("house_bookings")
        .select("id")
        .eq("house_id", house_id)
        .eq("request_id", request_id)
        .maybeSingle();

      if (existingHouseBooking) {
        await supabase
          .from("house_bookings")
          .update({
            check_in: request.check_in,
            check_out: request.check_out
          })
          .eq("id", existingHouseBooking.id);
      } else {
        await supabase
          .from("house_bookings")
          .insert([{
            house_id,
            request_id,
            check_in: request.check_in,
            check_out: request.check_out
          }]);
      }
    }

    // 6. Automatically update request status to APPROVED if it's not already
    // This ensures the request moves out of the 'New' tab immediately upon allocation
    const { data: currentRequest } = await supabase
      .from("requests")
      .select("status")
      .eq("id", request_id)
      .single();

    // 6. Automatically update request status to ACCEPTED only if ALL members are allocated
    const { data: allMembers } = await supabase
      .from("request_members")
      .select("id")
      .eq("request_id", request_id);

    const memberIds = allMembers.map(m => m.id);

    const { data: allocations } = await supabase
      .from("member_allocations")
      .select("request_member_id")
      .in("request_member_id", memberIds);

    const allocatedCount = new Set(allocations.map(a => a.request_member_id)).size;

    if (allocatedCount === (allMembers?.length || 0)) {
      if (!currentRequest?.status || currentRequest.status.toUpperCase() === 'PENDING') {
        console.log(`[ALLOCATE] All ${allocatedCount} members allocated. Updating request ${request_id} status to ACCEPTED`);
        await supabase
          .from("requests")
          .update({ status: 'ACCEPTED' })
          .eq("id", request_id);
      }

      // ✅ Notify user of the new/updated allocation
      await notifyAllocationUpdate(request_id);
    } else {
      console.log(`[ALLOCATE] Only ${allocatedCount}/${allMembers?.length || 0} members allocated. Keeping status as ${currentRequest?.status || 'PENDING'}`);
    }

    res.json({ success: true, message: "Member allocated successfully", allocation: finalMA });
  } catch (err) {
    console.error("[ALLOCATE] ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// =========================
// HELPER: Check if room is available
async function isRoomAvailable(room_id, check_in, check_out, exclude_request_id = null) {
  let query = supabase
    .from("room_bookings")
    .select("*")
    .eq("room_id", room_id)
    .lte("check_in", check_out)
    .gte("check_out", check_in);

  if (exclude_request_id) {
    query = query.neq("request_id", exclude_request_id);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data.length === 0;
}

// COMPREHENSIVE ACCEPT REQUEST
router.post("/requests/:id/accept-complete", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const {
    notes,
    room_assignments,
    house_assignments
  } = req.body;

  try {
    // 0. Validate Availability First
    if (Array.isArray(room_assignments)) {
      for (const ra of room_assignments) {
        const available = await isRoomAvailable(ra.room_id, ra.check_in, ra.check_out, id);
        if (!available) {
          throw new Error(`Room ID ${ra.room_id} is already occupied during these dates.`);
        }
      }
    }

    // 0.1 Check if request exists
    const { data: existingReq, error: findError } = await supabase
      .from("requests")
      .select("id")
      .eq("id", id)
      .single();

    if (findError || !existingReq) {
      return res.status(404).json({ error: `Request with ID ${id} not found.` });
    }

    // 1. Update Request Status
    const { error: reqError } = await supabase
      .from("requests")
      .update({ status: "ACCEPTED", notes: notes || null })
      .eq("id", id);

    if (reqError) throw new Error("Failed to update request: " + reqError.message);

    // 2. Handle Allocation Entry (Upsert-like)
    // First check if an allocation already exists for this request
    const { data: allocSearch } = await supabase
      .from("allocations")
      .select("id")
      .eq("request_id", id);

    let allocation;
    if (allocSearch && allocSearch.length > 0) {
      allocation = allocSearch[0];
      // If re-accepting, clear old items and bookings associated with this request
      await supabase.from("allocation_items").delete().eq("allocation_id", allocation.id);
      await supabase.from("room_bookings").delete().eq("request_id", id);
      await supabase.from("house_bookings").delete().eq("request_id", id);
    } else {
      const { data: newAlloc, error: allocError } = await supabase
        .from("allocations")
        .insert([{ request_id: id }])
        .select()
        .single();

      if (allocError) throw new Error("Failed to create allocation: " + allocError.message);
      allocation = newAlloc;
    }

    // 3. Process Room Assignments
    if (Array.isArray(room_assignments)) {
      for (const ra of room_assignments) {
        // 3a. Create Allocation Item
        const { data: item, error: itemError } = await supabase
          .from("allocation_items")
          .insert([{
            allocation_id: allocation.id,
            room_id: ra.room_id,
            house_id: null,
            allocation_type: "ROOM",
            assigned_capacity: ra.assigned_capacity
          }])
          .select()
          .single();

        if (itemError) throw new Error("Failed to create allocation item: " + itemError.message);

        // 3b. Create Room Booking
        const { error: rbError } = await supabase
          .from("room_bookings")
          .insert([{
            room_id: ra.room_id,
            request_id: id,
            check_in: ra.check_in,
            check_out: ra.check_out
          }]);

        if (rbError) throw new Error("Failed to create room booking: " + rbError.message);

        // 3c. Link Members
        if (Array.isArray(ra.member_ids)) {
          const maData = ra.member_ids.map(mId => ({
            request_member_id: mId,
            allocation_item_id: item.id
          }));

          const { error: maError } = await supabase
            .from("member_allocations")
            .insert(maData);

          if (maError) throw new Error("Failed to link members: " + maError.message);
        }
      }
    }

    if (Array.isArray(house_assignments)) {
      for (const ha of house_assignments) {
        // 4a. Create Allocation Item for House
        await supabase
          .from("allocation_items")
          .insert([{
            allocation_id: allocation.id,
            room_id: null,
            house_id: ha.house_id,
            allocation_type: "HOUSE",
            assigned_capacity: 0 // Houses might not use capacity in the same way
          }]);

        // 4b. Create House Booking
        const { error: hbError } = await supabase
          .from("house_bookings")
          .insert([{
            house_id: ha.house_id,
            request_id: id,
            check_in: ha.check_in,
            check_out: ha.check_out
          }]);

        if (hbError) throw new Error("Failed to create house booking: " + hbError.message);
      }
    }

    res.json({
      success: true,
      message: "Request accepted and fully allocated",
      allocation_id: allocation.id
    });

  } catch (err) {
    console.error("Accept-complete error:", err.message);
    res.status(400).json({ error: err.message });
  }
});


export default router;