import express from "express";
import { supabase } from "../config/supabase.js";
import { verifyToken } from "../utils/jwt.js";
import { sendRequestStatusEmail } from "../utils/email.js";
import { sendPubSubNotification } from "../utils/pubsub.js";

const router = express.Router();

const getTodayDateString = () => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};

const canModifyAllocationForCheckIn = (checkIn) => {
  if (!checkIn) return false;
  return checkIn.toString().split("T")[0] > getTodayDateString();
};

const shouldPromoteRequestOnAllocation = (status) => {
  const normalized = (status || "").toString().trim().toUpperCase();
  return !normalized || normalized === "PENDING" || normalized === "CANCELLED";
};

const isAcceptedOrApprovedStatus = (status) => {
  const normalized = (status || "").toString().trim().toUpperCase();
  return normalized === "ACCEPTED" || normalized.startsWith("APPROVED");
};

const mapHouseBookingDates = ({ check_in, check_out, check_in_date, check_out_date }) => ({
  check_in: check_in || check_in_date,
  check_out: check_out || check_out_date
});

const cleanupEmptyAllocationLocations = async (requestId, allocationId) => {
  const { data: items, error } = await supabase
    .from("allocation_items")
    .select("id, room_id, house_id, member_allocations(id)")
    .eq("allocation_id", allocationId);

  if (error) throw error;

  for (const item of items || []) {
    const memberAllocations = item.member_allocations || [];
    if (memberAllocations.length > 0) continue;

    if (item.room_id) {
      await supabase
        .from("room_bookings")
        .delete()
        .eq("room_id", item.room_id)
        .eq("request_id", requestId);
    }

    if (item.house_id) {
      await supabase
        .from("house_bookings")
        .delete()
        .eq("house_id", item.house_id)
        .eq("request_id", requestId);
    }

    await supabase.from("allocation_items").delete().eq("id", item.id);
  }
};

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
        house_bookings (
          *,
          houses (*)
        ),
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
                    location: location,
                    latitude: item.rooms ? item.rooms.latitude : (item.houses ? item.houses.latitude : null),
                    longitude: item.rooms ? item.rooms.longitude : (item.houses ? item.houses.longitude : null)
                  });
                }
              });
            }
          });
        }
      });
    }

        // 3b. Add Direct House Bookings
    if (fullRequest.house_bookings && fullRequest.house_bookings.length > 0) {
      fullRequest.house_bookings.forEach(hb => {
        const house = hb.houses;
        if (house) {
          const houseLocation = `House: ${house.owner_name} (${house.address || ''}) - Contact: ${house.contact_number || ''}`;
          
          fullRequest.request_members.forEach(m => {
            const alreadyAssigned = allocationDetails.allocations.some(a => a.member_name === m.name);
            if (!alreadyAssigned) {
              allocationDetails.allocations.push({
                member_name: m.name,
                location: houseLocation,
                latitude: house.latitude,
                longitude: house.longitude,
              });
            }
          });
        }
      });
    }

    // 4. Send Emails
    const isApprovedStatus = fullRequest.status === "ACCEPTED" || fullRequest.status.startsWith("APPROVED");
    const emailNotes = isApprovedStatus ? null : fullRequest.notes;

    for (const email of recipientEmails) {
      await sendRequestStatusEmail(
        email,
        fullRequest.status,
        emailNotes,
        isApprovedStatus ? allocationDetails : null
      );
    }
    console.log(`✅ Allocation update emails sent to ${recipientEmails.size} recipients.`);

    // --- PUBSUB NOTIFICATION FOR THE USER ---
    try {
      const status = fullRequest.status || 'Updated';
      const requestName = fullRequest.request_name || 'Accommodation Request';
      
      await sendPubSubNotification(`user-notifications-${fullRequest.user_id}`, 'status_update', {
        requestId: fullRequest.id,
        status: status,
        requestName: requestName,
        request_name: requestName, // Fallback for snake_case
        notes: isApprovedStatus ? '' : (fullRequest.notes || '')
      });
    } catch (pubSubErr) {
      console.error("Failed to send PubSub notification to user:", pubSubErr);
    }
  } catch (err) {
    console.error("❌ notifyAllocationUpdate ERROR:", err.message);
  }
};



// =========================
// REQUESTS CRUD
// =========================

// GET UNIQUE PRADESH LIST FROM DATABASE
router.get("/pradesh", authenticateToken, async (req, res) => {
  try {
    // 1. Try fetching from a dedicated 'pradesh' table if it exists
    const { data: tableData, error: tableError } = await supabase
      .from("pradesh")
      .select("name");

    if (!tableError && tableData && tableData.length > 0) {
      return res.json({ success: true, pradesh: tableData.map(p => p.name).sort() });
    }

    // 2. Fallback: Get unique pradesh from users and request_members
    const { data: userData } = await supabase.from("users").select("pradesh");
    const { data: memberData } = await supabase.from("request_members").select("pradesh");

    const set = new Set();
    if (userData) userData.forEach(u => u.pradesh && set.add(u.pradesh));
    if (memberData) memberData.forEach(m => m.pradesh && set.add(m.pradesh));

    const sortedList = Array.from(set).sort();
    res.json({ success: true, pradesh: sortedList });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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

    res.json({ success: true, members: uniqueMembers.filter(m => m.pradesh !== 'DELETED') });
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

// DELETE MEMBER (SOFT DELETE)
router.delete("/members/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { error } = await supabase
      .from("request_members")
      .update({ pradesh: 'DELETED' })
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true, message: "Member record soft-deleted" });
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
        house_bookings (
          *,
          houses (*)
        ),
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

    const userIds = [...new Set((data || []).map(reqItem => reqItem.user_id).filter(Boolean))];
    let pradeshByUserId = new Map();
    if (userIds.length > 0) {
      const { data: users, error: usersError } = await supabase
        .from("users")
        .select("id, pradesh")
        .in("id", userIds);

      if (usersError) return res.status(400).json({ error: usersError.message });
      pradeshByUserId = new Map((users || []).map(user => [user.id, user.pradesh || ""]));
    }

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
      return { ...reqItem, requester_pradesh: pradeshByUserId.get(reqItem.user_id) || "", pending_members };
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
        house_bookings (
          *,
          houses (*)
        ),
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
    const { data: requestOwner } = await supabase
      .from("users")
      .select("pradesh")
      .eq("id", reqItem.user_id)
      .single();

    res.json({ success: true, request: { ...reqItem, requester_pradesh: requestOwner?.pradesh || "", pending_members } });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
});

// UPDATE REQUEST STATUS/DETAILS
router.put("/requests/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;
  const { status, notes, members, ...otherUpdates } = req.body;

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
    if (Array.isArray(members)) {
      const { data: requestOwner, error: ownerError } = await supabase
        .from("users")
        .select("pradesh")
        .eq("id", data.user_id)
        .single();

      if (ownerError) {
        return res.status(400).json({ error: ownerError.message });
      }

      const requesterPradesh = requestOwner?.pradesh || null;

      const hasMemberId = (member) => {
        const rawId = member?.id;
        if (rawId === null || rawId === undefined || rawId === "") return false;
        return Number.isInteger(Number(rawId)) && Number(rawId) > 0;
      };

      const validMembers = members.filter(m => m && m.name);
      const existingMemberIds = validMembers
        .filter(hasMemberId)
        .map(m => Number(m.id))
        .filter(memberId => Number.isInteger(memberId) && memberId > 0);

      let deleteQuery = supabase
        .from("request_members")
        .delete()
        .eq("request_id", id);

      if (existingMemberIds.length > 0) {
        deleteQuery = deleteQuery.not("id", "in", `(${existingMemberIds.join(",")})`);
      }

      const { error: deleteMembersError } = await deleteQuery;
      if (deleteMembersError) {
        return res.status(400).json({ error: deleteMembersError.message });
      }

      const newMembers = validMembers
        .filter(m => !hasMemberId(m))
        .map(m => ({
          request_id: Number(id),
          name: m.name,
          contact: m.contact || null,
          pradesh: requesterPradesh,
          email: m.email || null
        }));

      for (const member of validMembers.filter(hasMemberId)) {
        const { error: updateMemberError } = await supabase
          .from("request_members")
          .update({
            name: member.name,
            contact: member.contact || null,
            pradesh: requesterPradesh,
            email: member.email || null
          })
          .eq("id", Number(member.id))
          .eq("request_id", id);

        if (updateMemberError) {
          return res.status(400).json({ error: updateMemberError.message });
        }
      }

      if (newMembers.length > 0) {
        const { error: insertMembersError } = await supabase
          .from("request_members")
          .insert(newMembers);

        if (insertMembersError) {
          return res.status(400).json({ error: insertMembersError.message });
        }
      }
    }

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

    const { data: fullRequest } = await supabase
      .from("requests")
      .select(`
        *,
        request_members (*),
        house_bookings (
          *,
          houses (*)
        ),
        house_bookings (
          *,
          houses (*)
        ),
        house_bookings (
          *,
          houses (*)
        ),
        house_bookings (
          *,
          houses (*)
        ),
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

    // ✅ Notify user of the update via PubSub and Email
    try {
      await notifyAllocationUpdate(id);
    } catch (notifyErr) {
      console.error("❌ Failed to send update notification:", notifyErr);
    }

    const requesterPradesh = fullRequest
      ? await supabase
          .from("users")
          .select("pradesh")
          .eq("id", fullRequest.user_id)
          .single()
      : null;

    res.json({
      success: true,
      message: "Request updated successfully",
      request: fullRequest
        ? { ...fullRequest, requester_pradesh: requesterPradesh?.data?.pradesh || "" }
        : data
    });
  } catch (err) {
    console.error("UPDATE /admin/requests/:id ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});



// DELETE REQUEST (SOFT DELETE)
router.delete("/requests/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    console.log(`🗑️ SOFT DELETING Request ID: ${id}`);

    // 1. Release all room bookings for this request
    await supabase.from("room_bookings").delete().eq("request_id", id);

    // 2. Release all house bookings for this request
    await supabase.from("house_bookings").delete().eq("request_id", id);

    // 3. Update request status to 'DELETED' instead of hard delete
    const { error } = await supabase
      .from("requests")
      .update({ status: 'CANCELLED', notes: `[DELETED] ${request.notes || ''}`.trim() })
      .eq("id", id);

    if (error) throw error;

    res.json({ success: true, message: "Request soft-deleted and resources released" });
  } catch (err) {
    console.error("DELETE /requests/:id ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
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

  const { data: allocationItem, error: fetchError } = await supabase
    .from("allocation_items")
    .select("id, allocations!inner(requests!inner(check_in))")
    .eq("id", id)
    .single();

  if (fetchError || !allocationItem) {
    return res.status(404).json({ error: "Allocation item not found" });
  }

  const checkIn = allocationItem.allocations?.requests?.check_in;
  if (!canModifyAllocationForCheckIn(checkIn)) {
    return res.status(400).json({
      error: "Allocation can be changed only before the check-in date."
    });
  }

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
  const { name, email, phone, role, pradesh } = req.body;

  const { data, error } = await supabase
    .from("users")
    .insert([{ name, email, phone, role, pradesh }])
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


// DELETE USER / ADMIN (SOFT DELETE)
router.delete("/users/:id", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id } = req.params;

  try {
    const { error } = await supabase
      .from("users")
      .update({ role: null })
      .eq("id", id);

    if (error) throw error;
    res.json({ success: true, message: "User soft-deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
      .select("room_id, request_id")
      .lte("check_in", check_out)
      .gte("check_out", check_in);

    if (bookingsError) throw bookingsError;

    const occupancyMap = {};
    if (bookings && bookings.length > 0) {
      const roomIds = [...new Set(bookings.map(b => b.room_id))];
      const requestIds = [...new Set(bookings.map(b => b.request_id))];

      const { data: memberAllocations, error: occupancyError } = await supabase
        .from("member_allocations")
        .select("request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))")
        .in("allocation_items.room_id", roomIds)
        .in("allocation_items.allocations.request_id", requestIds);

      if (occupancyError) throw occupancyError;

      memberAllocations?.forEach(ma => {
        const roomId = ma.allocation_items.room_id;
        const requestId = ma.allocation_items.allocations.request_id;
        const hasActiveBooking = bookings.some(b => b.room_id === roomId && b.request_id === requestId);
        if (hasActiveBooking) {
          occupancyMap[roomId] = (occupancyMap[roomId] || 0) + 1;
        }
      });
    }

    const availableRooms = allRooms
      .map(room => {
        const currentOccupancy = occupancyMap[room.id] || 0;
        const remainingCapacity = Math.max(0, (Number(room.capacity) || 0) - currentOccupancy);
        return {
          ...room,
          current_occupancy: currentOccupancy,
          remaining_capacity: remainingCapacity
        };
      })
      .filter(room => room.remaining_capacity > 0);

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

    // 2. Get all overlapping house bookings and count each booking row as one slot
    const { data: bookings, error: bookingsError } = await supabase
      .from("house_bookings")
      .select("house_id")
      .lte("check_in", check_out)
      .gte("check_out", check_in);

    if (bookingsError) throw bookingsError;

    const bookedCountByHouse = {};
    bookings.forEach(booking => {
      bookedCountByHouse[booking.house_id] = (bookedCountByHouse[booking.house_id] || 0) + 1;
    });

    // 3. Return houses with remaining capacity
    const availableHouses = allHouses
      .map(house => {
        const bookedCount = bookedCountByHouse[house.id] || 0;
        const capacity = Number(house.capacity) || 0;
        const remainingCapacity = Math.max(0, capacity - bookedCount);
        return {
          ...house,
          booked_count: bookedCount,
          current_occupancy: bookedCount,
          remaining_capacity: remainingCapacity
        };
      })
      .filter(house => house.booked_count < (Number(house.capacity) || 0));

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
        house_bookings (
          *,
          houses (*)
        ),
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

  const { data: existing, error: fetchError } = await supabase
    .from("member_allocations")
    .select("id, allocation_items!inner(allocation_id, allocations!inner(request_id, requests!inner(check_in)))")
    .eq("id", id)
    .single();

  if (fetchError || !existing) {
    return res.status(404).json({ error: "Member allocation not found" });
  }

  const requestId = existing.allocation_items?.allocations?.request_id;
  const allocationId = existing.allocation_items?.allocation_id;
  const checkIn = existing.allocation_items?.allocations?.requests?.check_in;

  if (!canModifyAllocationForCheckIn(checkIn)) {
    return res.status(400).json({
      error: "Allocation can be changed only before the check-in date."
    });
  }

  const { error } = await supabase
    .from("member_allocations")
    .delete()
    .eq("id", id);

  if (error) return res.status(400).json({ error: error.message });

  if (requestId && allocationId) {
    await cleanupEmptyAllocationLocations(requestId, allocationId);
    await notifyAllocationUpdate(requestId);
  }

  res.json({ success: true, message: "Deleted successfully" });
});

// =========================
// HOUSE BOOKINGS CRUD (ADMIN)
// =========================

// CREATE HOUSE BOOKING
router.post("/house-bookings", authenticateToken, authorizeAdmin, async (req, res) => {
  const { house_id, request_id } = req.body;
  const { check_in, check_out } = mapHouseBookingDates(req.body);

  const { data, error } = await supabase
    .from("house_bookings")
    .insert([{ house_id, request_id, check_in, check_out }])
    .select()
    .single();

  if (error) return res.status(400).json({ error: error.message });

  // Automatically update request status to ACCEPTED
  await supabase
    .from("requests")
    .update({ status: 'ACCEPTED', notes: null })
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
  const updates = { ...req.body };
  if (
    updates.check_in ||
    updates.check_out ||
    updates.check_in_date ||
    updates.check_out_date
  ) {
    const { check_in, check_out } = mapHouseBookingDates(updates);
    delete updates.check_in_date;
    delete updates.check_out_date;
    if (check_in) updates.check_in = check_in;
    if (check_out) updates.check_out = check_out;
  }

  const { data, error } = await supabase
    .from("house_bookings")
    .update(updates)
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
      .select("check_in, check_out, status")
      .eq("id", request_id)
      .single();

    if (reqError || !request) {
      console.error("[ALLOCATE] Request not found:", request_id);
      return res.status(404).json({ error: "Request not found" });
    }

    if (!canModifyAllocationForCheckIn(request.check_in)) {
      return res.status(400).json({
        error: "Allocation can be changed only before the check-in date."
      });
    }

    // 1.1 Capacity Check (If Room is selected)
    if (room_id) {
      const { data: room } = await supabase.from("rooms").select("capacity").eq("id", room_id).single();
      if (room) {
        const selectedMemberCount = Math.max(1, Number(assigned_capacity) || 1);

        if (selectedMemberCount > Number(room.capacity)) {
          return res.status(400).json({
            error: `Room capacity is ${room.capacity}. You can only allocate ${room.capacity} members.`
          });
        }

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
          const membersFromOtherRequests = new Set();
          memberAllocations?.forEach(ma => {
            const rId = ma.allocation_items.room_id;
            const reqId = ma.allocation_items.allocations.request_id;

            const isValid = activeBookings.some(b => b.room_id === rId && b.request_id === reqId);
            if (isValid && rId === parseInt(room_id)) {
              currentMembers.add(ma.request_member_id);
              if (parseInt(reqId) !== parseInt(request_id)) {
                membersFromOtherRequests.add(ma.request_member_id);
              }
            }
          });

          const availableSlotsForThisRequest = Number(room.capacity) - membersFromOtherRequests.size;
          if (selectedMemberCount > availableSlotsForThisRequest) {
            return res.status(400).json({
              error: `Room capacity is ${room.capacity}. You can only allocate ${Math.max(0, availableSlotsForThisRequest)} members.`
            });
          }

          // If this member is NOT already in the room, check if adding them exceeds capacity
          if (!currentMembers.has(parseInt(request_member_id))) {
            if (currentMembers.size >= Number(room.capacity)) {
              return res.status(400).json({
                error: `Room capacity is ${room.capacity}. You can only allocate 0 members.`
              });
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

    const isFullyAllocated = allocatedCount === (allMembers?.length || 0);

    if (isFullyAllocated) {
      if (shouldPromoteRequestOnAllocation(currentRequest?.status)) {
        console.log(`[ALLOCATE] All ${allocatedCount} members allocated. Updating request ${request_id} status to ACCEPTED`);
        await supabase
          .from("requests")
          .update({ status: 'ACCEPTED', notes: null })
          .eq("id", request_id);
      }

      // ✅ Notify user of the new/updated allocation
      await notifyAllocationUpdate(request_id);
    } else {
      if (isAcceptedOrApprovedStatus(currentRequest?.status)) {
        await supabase
          .from("requests")
          .update({ status: "PENDING" })
          .eq("id", request_id);
      }
      console.log(`[ALLOCATE] Only ${allocatedCount}/${allMembers?.length || 0} members allocated. Request ${request_id} remains partial pending.`);
    }

    res.json({ success: true, message: "Member allocated successfully", allocation: finalMA });
  } catch (err) {
    console.error("[ALLOCATE] ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// SYNC REQUEST ALLOCATION (Manage Allocation screen)
router.post("/requests/:id/sync-allocation", authenticateToken, authorizeAdmin, async (req, res) => {
  const { id: request_id } = req.params;
  const { member_ids = [], room_id, house_id, assigned_capacity } = req.body;

  if (!Array.isArray(member_ids)) {
    return res.status(400).json({ error: "member_ids must be an array." });
  }

  if (!room_id && !house_id) {
    return res.status(400).json({ error: "Please provide room_id or house_id." });
  }

  try {
    const { data: request, error: reqError } = await supabase
      .from("requests")
      .select("check_in, check_out, status")
      .eq("id", request_id)
      .single();

    if (reqError || !request) {
      return res.status(404).json({ error: "Request not found" });
    }

    if (!canModifyAllocationForCheckIn(request.check_in)) {
      return res.status(400).json({
        error: "Allocation can be changed only before the check-in date."
      });
    }

    const { data: requestMembers, error: membersError } = await supabase
      .from("request_members")
      .select("id")
      .eq("request_id", request_id);

    if (membersError) throw membersError;

    const validMemberIds = new Set((requestMembers || []).map(m => Number(m.id)));
    const selectedMemberIds = [...new Set(member_ids.map(id => Number(id)))]
      .filter(id => validMemberIds.has(id));

    if (room_id && selectedMemberIds.length > 0) {
      const { data: room, error: roomError } = await supabase
        .from("rooms")
        .select("capacity")
        .eq("id", room_id)
        .single();

      if (roomError || !room) {
        return res.status(404).json({ error: "Room not found" });
      }

      const { data: activeBookings, error: activeBookingsError } = await supabase
        .from("room_bookings")
        .select("room_id, request_id")
        .eq("room_id", room_id)
        .lte("check_in", request.check_out)
        .gte("check_out", request.check_in);

      if (activeBookingsError) throw activeBookingsError;

      const currentMembers = new Set();
      if (activeBookings && activeBookings.length > 0) {
        const requestIds = [...new Set(activeBookings.map(b => b.request_id))];
        const { data: memberAllocations, error: memberAllocationsError } = await supabase
          .from("member_allocations")
          .select("request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))")
          .eq("allocation_items.room_id", room_id)
          .in("allocation_items.allocations.request_id", requestIds);

        if (memberAllocationsError) throw memberAllocationsError;

        memberAllocations?.forEach(ma => {
          const reqId = ma.allocation_items.allocations.request_id;
          const hasActiveBooking = activeBookings.some(b => b.request_id === reqId);
          if (hasActiveBooking) currentMembers.add(Number(ma.request_member_id));
        });
      }

      const additions = selectedMemberIds.filter(memberId => !currentMembers.has(memberId));
      const capacity = Number(room.capacity) || 0;
      const remainingSlots = Math.max(0, capacity - currentMembers.size);

      if (additions.length > remainingSlots) {
        return res.status(400).json({
          error: `Room capacity is ${capacity}. You can only allocate ${remainingSlots} more members.`
        });
      }
    }

    let { data: allocation, error: allocationError } = await supabase
      .from("allocations")
      .select("id")
      .eq("request_id", request_id)
      .maybeSingle();

    if (allocationError) throw allocationError;

    if (!allocation) {
      const { data: newAllocation, error: createAllocationError } = await supabase
        .from("allocations")
        .insert([{ request_id }])
        .select("id")
        .single();

      if (createAllocationError) throw createAllocationError;
      allocation = newAllocation;
    }

    const filterCol = room_id ? "room_id" : "house_id";
    const filterVal = Number(room_id || house_id);
    const allocationType = room_id ? "ROOM" : "HOUSE";

    let { data: item, error: itemFetchError } = await supabase
      .from("allocation_items")
      .select("id")
      .eq("allocation_id", allocation.id)
      .eq(filterCol, filterVal)
      .maybeSingle();

    if (itemFetchError) throw itemFetchError;

    if (!item) {
      const { data: newItem, error: createItemError } = await supabase
        .from("allocation_items")
        .insert([{
          allocation_id: allocation.id,
          room_id: room_id || null,
          house_id: room_id ? null : house_id,
          allocation_type: allocationType,
          assigned_capacity: assigned_capacity || selectedMemberIds.length
        }])
        .select("id")
        .single();

      if (createItemError) throw createItemError;
      item = newItem;
    } else {
      const { error: updateItemError } = await supabase
        .from("allocation_items")
        .update({
          allocation_type: allocationType,
          assigned_capacity: assigned_capacity || selectedMemberIds.length
        })
        .eq("id", item.id);

      if (updateItemError) throw updateItemError;
    }

    const { data: existingMemberAllocations, error: existingError } = await supabase
      .from("member_allocations")
      .select("id, request_member_id, allocation_item_id, allocation_items!inner(allocation_id)")
      .eq("allocation_items.allocation_id", allocation.id);

    if (existingError) throw existingError;

    const existingByMemberId = new Map();

    for (const ma of existingMemberAllocations || []) {
      existingByMemberId.set(Number(ma.request_member_id), ma);
    }

    for (const memberId of selectedMemberIds) {
      const existing = existingByMemberId.get(memberId);
      if (existing) {
        if (Number(existing.allocation_item_id) !== Number(item.id)) {
          const { error: updateMaError } = await supabase
            .from("member_allocations")
            .update({ allocation_item_id: item.id })
            .eq("id", existing.id);

          if (updateMaError) throw updateMaError;
        }
      } else {
        const { error: insertMaError } = await supabase
          .from("member_allocations")
          .insert([{ request_member_id: memberId, allocation_item_id: item.id }]);

        if (insertMaError) throw insertMaError;
      }
    }

    if (selectedMemberIds.length > 0) {
      if (room_id) {
        const { data: existingBooking } = await supabase
          .from("room_bookings")
          .select("id")
          .eq("room_id", room_id)
          .eq("request_id", request_id)
          .maybeSingle();

        if (existingBooking) {
          await supabase
            .from("room_bookings")
            .update({ check_in: request.check_in, check_out: request.check_out })
            .eq("id", existingBooking.id);
        } else {
          await supabase
            .from("room_bookings")
            .insert([{ room_id, request_id, check_in: request.check_in, check_out: request.check_out }]);
        }
      } else if (house_id) {
        const { data: existingBooking } = await supabase
          .from("house_bookings")
          .select("id")
          .eq("house_id", house_id)
          .eq("request_id", request_id)
          .maybeSingle();

        if (existingBooking) {
          await supabase
            .from("house_bookings")
            .update({ check_in: request.check_in, check_out: request.check_out })
            .eq("id", existingBooking.id);
        } else {
          await supabase
            .from("house_bookings")
            .insert([{ house_id, request_id, check_in: request.check_in, check_out: request.check_out }]);
        }
      }
    }

    await cleanupEmptyAllocationLocations(request_id, allocation.id);

    let allocatedMembers = [];
    if (validMemberIds.size > 0) {
      const { data, error: allocatedMembersError } = await supabase
        .from("member_allocations")
        .select("request_member_id")
        .in("request_member_id", [...validMemberIds]);

      if (allocatedMembersError) throw allocatedMembersError;
      allocatedMembers = data || [];
    }

    const allocatedCount = new Set(
      allocatedMembers.map(ma => Number(ma.request_member_id))
    ).size;
    const isFullyAllocated = validMemberIds.size > 0 && allocatedCount >= validMemberIds.size;

    if (isFullyAllocated && shouldPromoteRequestOnAllocation(request.status)) {
      await supabase.from("requests").update({ status: "ACCEPTED", notes: null }).eq("id", request_id);
    } else if (selectedMemberIds.length > 0) {
      if (isAcceptedOrApprovedStatus(request.status)) {
        await supabase.from("requests").update({ status: "PENDING" }).eq("id", request_id);
      }
      console.log(`[SYNC ALLOCATION] ${allocatedCount}/${validMemberIds.size} members allocated. Request ${request_id} remains partial pending.`);
    }

    await notifyAllocationUpdate(request_id);

    res.json({
      success: true,
      message: "Allocation synced successfully",
      selected_member_ids: selectedMemberIds
    });
  } catch (err) {
    console.error("[SYNC ALLOCATION] ERROR:", err.message);
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
            check_in: ha.check_in || ha.check_in_date,
            check_out: ha.check_out || ha.check_out_date
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

