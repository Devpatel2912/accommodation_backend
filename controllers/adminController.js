import { supabase } from "../config/supabase.js";
import * as RequestModel from "../models/requestModel.js";
import * as UserModel from "../models/userModel.js";
import { sendRequestStatusEmail } from "../utils/email.js";
import { sendPubSubNotification } from "../utils/pubsub.js";
import { isAcceptedOrApprovedStatus } from "../utils/helpers.js";

// ─── Notify allocation update (shared helper) ──────────────────────
export const notifyAllocationUpdate = async (requestId) => {
  try {
    const { data: fullRequest, error: fetchError } = await RequestModel.getRequestWithNested(requestId);
    if (fetchError || !fullRequest) return;

    const { data: userData } = await UserModel.findUserById(fullRequest.user_id, "id, name, phone, role, email, pradesh");
    const recipientEmails = new Set();
    if (userData?.email) recipientEmails.add(userData.email);
    if (fullRequest.request_members) fullRequest.request_members.forEach(m => { if (m.email) recipientEmails.add(m.email); });

    if (recipientEmails.size === 0) return;

    const allocationDetails = {
      check_in: fullRequest.check_in,
      check_out: fullRequest.check_out,
      requesterName: userData?.name || "N/A",
      requesterPhone: userData?.phone || "N/A",
      locations: [],
      allocations: []
    };
    const locationKeys = new Set();

    const addLocation = (key, location) => {
      if (locationKeys.has(key)) return;
      locationKeys.add(key);
      allocationDetails.locations.push(location);
    };

    if (fullRequest.allocations) {
      const allocArray = Array.isArray(fullRequest.allocations) ? fullRequest.allocations : [fullRequest.allocations];
      allocArray.forEach(alloc => {
        if (alloc.allocation_items) {
          (Array.isArray(alloc.allocation_items) ? alloc.allocation_items : [alloc.allocation_items]).forEach(item => {
            const assignedMembers = (Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations || []])
              .flat()
              .map(ma => fullRequest.request_members?.find(m => m.id === ma.request_member_id)?.name)
              .filter(Boolean)
              .join(", ");
            let location = "Assigned";
            if (item.rooms) {
              location = `Room ${item.rooms.room_number} - Capacity: ${item.rooms.capacity ?? "N/A"}`;
              addLocation(`room-${item.rooms.id || item.room_id}`, {
                type: "Room",
                title: `Room ${item.rooms.room_number}`,
                room_number: item.rooms.room_number,
                capacity: item.rooms.capacity,
                assigned_members: assignedMembers,
                latitude: item.rooms.latitude,
                longitude: item.rooms.longitude
              });
            } else if (item.houses) {
              location = `House ${item.houses.owner_name} - ${item.houses.address || "Address N/A"} - Contact: ${item.houses.contact_number || "N/A"}`;
              addLocation(`house-${item.houses.id || item.house_id}`, {
                type: "House",
                title: `House ${item.houses.owner_name || item.house_id}`,
                owner_name: item.houses.owner_name,
                contact_number: item.houses.contact_number,
                address: item.houses.address,
                capacity: item.houses.capacity,
                assigned_members: assignedMembers,
                latitude: item.houses.latitude,
                longitude: item.houses.longitude
              });
            }
            if (item.member_allocations) {
              (Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations]).forEach(ma => {
                const member = fullRequest.request_members?.find(m => m.id === ma.request_member_id);
                if (member) allocationDetails.allocations.push({
                  member_name: member.name,
                  member_contact: member.contact || "N/A",
                  location,
                  latitude: item.rooms?.latitude || item.houses?.latitude,
                  longitude: item.rooms?.longitude || item.houses?.longitude
                });
              });
            }
          });
        }
      });
    }

    if (fullRequest.house_bookings?.length > 0) {
      fullRequest.house_bookings.forEach(hb => {
        const house = hb.houses;
        if (house) {
          const loc = `House: ${house.owner_name} (${house.address || ""}) - Contact: ${house.contact_number || ""}`;
          addLocation(`house-booking-${house.id || hb.house_id}`, {
            type: "House",
            title: `House ${house.owner_name || hb.house_id}`,
            owner_name: house.owner_name,
            contact_number: house.contact_number,
            address: house.address,
            capacity: house.capacity,
            assigned_members: fullRequest.request_members?.map(m => m.name).join(", "),
            latitude: house.latitude,
            longitude: house.longitude
          });
          (fullRequest.request_members || []).forEach(m => {
            if (!allocationDetails.allocations.some(a => a.member_name === m.name)) {
              allocationDetails.allocations.push({
                member_name: m.name,
                member_contact: m.contact || "N/A",
                location: loc,
                latitude: house.latitude,
                longitude: house.longitude
              });
            }
          });
        }
      });
    }

    const isApproved = isAcceptedOrApprovedStatus(fullRequest.status);
    for (const email of recipientEmails) {
      await sendRequestStatusEmail(email, fullRequest.status, isApproved ? null : fullRequest.notes, isApproved ? allocationDetails : null);
    }

    try {
      await sendPubSubNotification(`user-notifications-${fullRequest.user_id}`, "status_update", {
        requestId: fullRequest.id, status: fullRequest.status || "Updated",
        requestName: fullRequest.request_name || "Accommodation Request",
        notes: isApproved ? "" : (fullRequest.notes || "")
      });
    } catch (pubSubErr) { console.error("PubSub error:", pubSubErr); }
  } catch (err) {
    console.error("❌ notifyAllocationUpdate ERROR:", err.message);
  }
};

// ─── GET PRADESH LIST ───────────────────────────────────────────────
export const getPradeshList = async (req, res) => {
  try {
    const list = await UserModel.getPradeshList();
    res.json({ success: true, pradesh: list });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET ALL MEMBERS (ADMIN) ────────────────────────────────────────
export const getAllMembers = async (req, res) => {
  try {
    const { data: members, error } = await RequestModel.getAllMembers();
    if (error) throw error;
    const unique = [], seen = new Set();
    members.forEach(m => {
      const key = `${m.name}-${m.contact}-${m.email}`.toLowerCase();
      if (!seen.has(key)) { seen.add(key); unique.push(m); }
    });
    res.json({ success: true, members: unique.filter(m => m.pradesh !== "DELETED") });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── UPDATE MEMBER (ADMIN) ─────────────────────────────────────────
export const updateMember = async (req, res) => {
  const { id } = req.params;
  const { name, contact, email, pradesh } = req.body;
  try {
    const { data: current, error: fetchError } = await RequestModel.getMemberByIdSimple(id);
    if (fetchError || !current) return res.status(404).json({ error: "Member not found" });
    const { error } = await RequestModel.updateMembersByOldIdentity(current, { name, contact, email, pradesh });
    if (error) throw error;
    res.json({ success: true, message: "Member updated across all requests" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── DELETE MEMBER (ADMIN - SOFT) ───────────────────────────────────
export const deleteMember = async (req, res) => {
  try {
    const { error } = await RequestModel.softDeleteMemberById(req.params.id);
    if (error) throw error;
    res.json({ success: true, message: "Member record soft-deleted" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── GET ALL REQUESTS (ADMIN) ───────────────────────────────────────
export const getAllRequests = async (req, res) => {
  try {
    const { data, error } = await RequestModel.getAllRequestsWithNested();
    if (error) return res.status(400).json({ error: error.message });

    const userIds = [...new Set((data || []).map(r => r.user_id).filter(Boolean))];
    let pradeshMap = new Map();
    if (userIds.length > 0) {
      const { data: users, error: usersErr } = await supabase.from("users").select("id, pradesh").in("id", userIds);
      if (usersErr) return res.status(400).json({ error: usersErr.message });
      pradeshMap = new Map((users || []).map(u => [u.id, u.pradesh || ""]));
    }

    const processed = data.map(reqItem => {
      const allocatedIds = new Set();
      if (reqItem.allocations) {
        (Array.isArray(reqItem.allocations) ? reqItem.allocations : [reqItem.allocations]).forEach(alloc => {
          if (alloc.allocation_items) {
            (Array.isArray(alloc.allocation_items) ? alloc.allocation_items : [alloc.allocation_items]).forEach(item => {
              if (item.member_allocations) {
                (Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations]).forEach(ma => allocatedIds.add(ma.request_member_id));
              }
            });
          }
        });
      }
      return { ...reqItem, requester_pradesh: pradeshMap.get(reqItem.user_id) || "", pending_members: (reqItem.request_members || []).filter(m => !allocatedIds.has(m.id)) };
    });
    res.json({ success: true, requests: processed });
  } catch (err) {
    console.error("GET /admin/requests ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── GET SINGLE REQUEST (ADMIN) ─────────────────────────────────────
export const getRequestById = async (req, res) => {
  const { id } = req.params;
  try {
    const { data: reqItem, error } = await RequestModel.getRequestWithNested(id);
    if (error || !reqItem) return res.status(404).json({ error: "Request not found" });

    const allocatedIds = new Set();
    if (reqItem.allocations) {
      (Array.isArray(reqItem.allocations) ? reqItem.allocations : [reqItem.allocations]).forEach(alloc => {
        if (alloc.allocation_items) {
          (Array.isArray(alloc.allocation_items) ? alloc.allocation_items : [alloc.allocation_items]).forEach(item => {
            if (item.member_allocations) {
              (Array.isArray(item.member_allocations) ? item.member_allocations : [item.member_allocations]).forEach(ma => allocatedIds.add(ma.request_member_id));
            }
          });
        }
      });
    }

    const { data: owner } = await UserModel.findUserById(reqItem.user_id, "pradesh");
    res.json({ success: true, request: { ...reqItem, requester_pradesh: owner?.pradesh || "", pending_members: (reqItem.request_members || []).filter(m => !allocatedIds.has(m.id)) } });
  } catch (err) {
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── UPDATE REQUEST (ADMIN) ────────────────────────────────────────
export const updateRequest = async (req, res) => {
  const { id } = req.params;
  const { status, notes, members, ...otherUpdates } = req.body;

  try {
    const { data, error } = await supabase.from("requests").update({ status, notes: notes || undefined, ...otherUpdates }).eq("id", id).select().single();
    if (error) return res.status(400).json({ error: error.message });

    if (Array.isArray(members)) {
      const { data: owner } = await UserModel.findUserById(data.user_id, "pradesh");
      const reqPradesh = owner?.pradesh || null;
      const hasMemberId = (m) => { const rawId = m?.id; return rawId !== null && rawId !== undefined && rawId !== "" && Number.isInteger(Number(rawId)) && Number(rawId) > 0; };
      const validMembers = members.filter(m => m && m.name);
      const existingIds = validMembers.filter(hasMemberId).map(m => Number(m.id)).filter(id => Number.isInteger(id) && id > 0);

      let delQuery = supabase.from("request_members").delete().eq("request_id", id);
      if (existingIds.length > 0) delQuery = delQuery.not("id", "in", `(${existingIds.join(",")})`);
      await delQuery;

      for (const member of validMembers.filter(hasMemberId)) {
        await supabase.from("request_members").update({ name: member.name, contact: member.contact || null, pradesh: reqPradesh, email: member.email || null }).eq("id", Number(member.id)).eq("request_id", id);
      }

      const newMembers = validMembers.filter(m => !hasMemberId(m)).map(m => ({ request_id: Number(id), name: m.name, contact: m.contact || null, pradesh: reqPradesh, email: m.email || null }));
      if (newMembers.length > 0) await supabase.from("request_members").insert(newMembers);
    }

    if (status === "CANCELLED") {
      try {
        const { data: user } = await UserModel.findUserById(data.user_id, "email");
        if (user?.email) await sendRequestStatusEmail(user.email, "REJECTED", notes || "Your request has been cancelled by the administrator.");
      } catch (emailErr) { console.error("Failed to send rejection email:", emailErr); }
    }

    try { await notifyAllocationUpdate(id); } catch (e) { console.error("Notification error:", e); }

    const { data: fullRequest } = await RequestModel.getRequestWithNested(id);
    const { data: reqOwner } = await UserModel.findUserById(fullRequest?.user_id, "pradesh");

    res.json({ success: true, message: "Request updated successfully", request: fullRequest ? { ...fullRequest, requester_pradesh: reqOwner?.pradesh || "" } : data });
  } catch (err) {
    console.error("UPDATE /admin/requests/:id ERROR:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

// ─── DELETE REQUEST (ADMIN - SOFT) ──────────────────────────────────
export const deleteRequest = async (req, res) => {
  const { id } = req.params;
  try {
    await supabase.from("room_bookings").delete().eq("request_id", id);
    await supabase.from("house_bookings").delete().eq("request_id", id);
    const { error } = await supabase.from("requests").update({ status: "CANCELLED", notes: "[DELETED]" }).eq("id", id);
    if (error) throw error;
    res.json({ success: true, message: "Request soft-deleted and resources released" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── AVAILABLE ROOMS FOR DATE RANGE ─────────────────────────────────
export const getAvailableRooms = async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ error: "Please provide check_in and check_out dates." });

  try {
    const { data: allRooms, error: roomsErr } = await supabase.from("rooms").select("*").eq("is_active", true);
    if (roomsErr) throw roomsErr;

    const { data: bookings, error: bookingsErr } = await supabase.from("room_bookings").select("room_id, request_id").lte("check_in", check_out).gte("check_out", check_in);
    if (bookingsErr) throw bookingsErr;

    const occupancyMap = {};
    if (bookings?.length > 0) {
      const roomIds = [...new Set(bookings.map(b => b.room_id))];
      const requestIds = [...new Set(bookings.map(b => b.request_id))];
      const { data: mas } = await supabase.from("member_allocations").select("request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))").in("allocation_items.room_id", roomIds).in("allocation_items.allocations.request_id", requestIds);
      mas?.forEach(ma => {
        const rId = ma.allocation_items.room_id, reqId = ma.allocation_items.allocations.request_id;
        if (bookings.some(b => b.room_id === rId && b.request_id === reqId)) occupancyMap[rId] = (occupancyMap[rId] || 0) + 1;
      });
    }

    const available = allRooms.map(room => {
      const occ = occupancyMap[room.id] || 0;
      return { ...room, current_occupancy: occ, remaining_capacity: Math.max(0, (Number(room.capacity) || 0) - occ) };
    }).filter(r => r.remaining_capacity > 0);

    res.json({ success: true, rooms: available });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};

// ─── AVAILABLE HOUSES FOR DATE RANGE ────────────────────────────────
export const getAvailableHouses = async (req, res) => {
  const { check_in, check_out } = req.query;
  if (!check_in || !check_out) return res.status(400).json({ error: "Please provide check_in and check_out dates." });

  try {
    const { data: allHouses, error: housesErr } = await supabase.from("houses").select("*").eq("is_active", true);
    if (housesErr) throw housesErr;

    const { data: bookings, error: bookingsErr } = await supabase
      .from("house_bookings")
      .select("house_id, request_id")
      .lte("check_in", check_out)
      .gte("check_out", check_in);
    if (bookingsErr) throw bookingsErr;

    const countMap = {};
    if (bookings?.length > 0) {
      const houseIds = [...new Set(bookings.map(b => b.house_id).filter(Boolean))];
      const requestIds = [...new Set(bookings.map(b => b.request_id).filter(Boolean))];
      const { data: memberAllocations, error: maErr } = await supabase
        .from("member_allocations")
        .select("request_member_id, allocation_items!inner(house_id, allocations!inner(request_id))")
        .in("allocation_items.house_id", houseIds)
        .in("allocation_items.allocations.request_id", requestIds);
      if (maErr) throw maErr;

      memberAllocations?.forEach(ma => {
        const houseId = ma.allocation_items?.house_id;
        const requestId = ma.allocation_items?.allocations?.request_id;
        if (bookings.some(b => b.house_id === houseId && b.request_id === requestId)) {
          countMap[houseId] = (countMap[houseId] || 0) + 1;
        }
      });

      bookings.forEach(b => {
        if (!countMap[b.house_id]) countMap[b.house_id] = 1;
      });
    }

    const available = allHouses.map(house => {
      const booked = countMap[house.id] || 0;
      const cap = Math.max(1, Number(house.capacity) || 0);
      return { ...house, booked_count: booked, current_occupancy: booked, remaining_capacity: Math.max(0, cap - booked) };
    }).filter(h => h.remaining_capacity > 0);

    res.json({ success: true, houses: available });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
};
