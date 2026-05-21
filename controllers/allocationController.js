import { supabase } from "../config/supabase.js";
import * as AllocModel from "../models/allocationModel.js";
import * as RequestModel from "../models/requestModel.js";
import { notifyAllocationUpdate } from "./adminController.js";
import { canModifyAllocationForCheckIn, shouldPromoteRequestOnAllocation, isAcceptedOrApprovedStatus } from "../utils/helpers.js";

// ─── ALLOCATIONS CRUD ───────────────────────────────────────────────
export const createAllocation = async (req, res) => {
  const { request_id, items } = req.body;
  try {
    const { data: allocation, error } = await AllocModel.createAllocation(request_id);
    if (error) return res.status(400).json({ error: error.message });

    if (Array.isArray(items) && items.length > 0) {
      const itemsData = items.map(item => ({
        allocation_id: allocation.id, room_id: item.room_id || null,
        house_id: item.room_id ? null : (item.house_id || null),
        allocation_type: item.room_id ? "ROOM" : "HOUSE", assigned_capacity: item.assigned_capacity
      }));
      const { error: itemsErr } = await supabase.from("allocation_items").insert(itemsData);
      if (itemsErr) return res.status(400).json({ error: "Allocation created but items failed: " + itemsErr.message });
    }
    res.json({ success: true, allocation });
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
};

export const getAllAllocations = async (req, res) => {
  const { data, error } = await AllocModel.getAllAllocations();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, allocations: data });
};

export const getAllocationById = async (req, res) => {
  const { data, error } = await AllocModel.getAllocationById(req.params.id);
  if (error) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, allocation: data });
};

export const updateAllocation = async (req, res) => {
  const { id } = req.params;
  const { items, ...updates } = req.body;
  try {
    if (Object.keys(updates).length > 0) {
      const { error } = await AllocModel.updateAllocation(id, updates);
      if (error) return res.status(400).json({ error: error.message });
    }
    if (Array.isArray(items)) {
      await AllocModel.deleteAllocationItemsByAllocationId(id);
      if (items.length > 0) {
        const itemsData = items.map(item => ({
          allocation_id: id, room_id: item.room_id || null,
          house_id: item.room_id ? null : (item.house_id || null),
          allocation_type: item.room_id ? "ROOM" : "HOUSE", assigned_capacity: item.assigned_capacity
        }));
        await supabase.from("allocation_items").insert(itemsData);
      }
    }
    res.json({ success: true, message: "Allocation updated successfully" });
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
};

export const deleteAllocation = async (req, res) => {
  const { error } = await AllocModel.deleteAllocation(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: "Allocation deleted" });
};

// ─── ALLOCATION ITEMS CRUD ──────────────────────────────────────────
export const createAllocationItem = async (req, res) => {
  const { allocation_id, room_id, house_id, assigned_capacity, member_ids } = req.body;
  try {
    const { data: item, error } = await AllocModel.createAllocationItem({
      allocation_id, room_id: room_id || null, house_id: room_id ? null : (house_id || null),
      allocation_type: room_id ? "ROOM" : "HOUSE", assigned_capacity
    });
    if (error) return res.status(400).json({ error: error.message });

    if (Array.isArray(member_ids) && member_ids.length > 0) {
      await AllocModel.insertMemberAllocations(member_ids.map(mId => ({ request_member_id: mId, allocation_item_id: item.id })));
    }
    res.json({ success: true, item });
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
};

export const getAllAllocationItems = async (req, res) => {
  const { data, error } = await AllocModel.getAllAllocationItems();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, items: data });
};

export const updateAllocationItem = async (req, res) => {
  const { id } = req.params;
  const { member_ids, ...updates } = req.body;
  try {
    if (updates.room_id) { updates.house_id = null; updates.allocation_type = "ROOM"; }
    else if (updates.house_id) { updates.room_id = null; updates.allocation_type = "HOUSE"; }

    if (Object.keys(updates).length > 0) {
      const { error } = await AllocModel.updateAllocationItem(id, updates);
      if (error) return res.status(400).json({ error: error.message });
    }

    if (Array.isArray(member_ids)) {
      await AllocModel.deleteMemberAllocationsByItemId(id);
      if (member_ids.length > 0) {
        await AllocModel.insertMemberAllocations(member_ids.map(mId => ({ request_member_id: mId, allocation_item_id: id })));
      }
    }
    res.json({ success: true, message: "Allocation item updated" });
  } catch (err) { res.status(500).json({ error: "Internal server error" }); }
};

export const deleteAllocationItem = async (req, res) => {
  const { id } = req.params;
  const { data: item, error: fetchErr } = await AllocModel.getAllocationItemWithCheckIn(id);
  if (fetchErr || !item) return res.status(404).json({ error: "Allocation item not found" });

  const checkIn = item.allocations?.requests?.check_in;
  if (!canModifyAllocationForCheckIn(checkIn)) return res.status(400).json({ error: "Allocation can be changed only before the check-in date." });

  const { error } = await AllocModel.deleteAllocationItem(id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: "Item deleted" });
};

// ─── MEMBER ALLOCATIONS CRUD ────────────────────────────────────────
export const createMemberAllocation = async (req, res) => {
  const { data, error } = await AllocModel.createMemberAllocation(req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, allocation: data });
};

export const getAllMemberAllocations = async (req, res) => {
  const { data, error } = await AllocModel.getAllMemberAllocations();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, allocations: data });
};

export const getMemberAllocationById = async (req, res) => {
  const { data, error } = await AllocModel.getMemberAllocationById(req.params.id);
  if (error || !data) return res.status(404).json({ error: "Not found" });
  res.json({ success: true, allocation: data });
};

export const updateMemberAllocation = async (req, res) => {
  const { data, error } = await AllocModel.updateMemberAllocation(req.params.id, req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, allocation: data });
};

export const deleteMemberAllocation = async (req, res) => {
  const { id } = req.params;
  const { data: existing, error: fetchErr } = await AllocModel.getMemberAllocationWithContext(id);
  if (fetchErr || !existing) return res.status(404).json({ error: "Member allocation not found" });

  const requestId = existing.allocation_items?.allocations?.request_id;
  const allocationId = existing.allocation_items?.allocation_id;
  const checkIn = existing.allocation_items?.allocations?.requests?.check_in;

  if (!canModifyAllocationForCheckIn(checkIn)) return res.status(400).json({ error: "Allocation can be changed only before the check-in date." });

  const { error } = await AllocModel.deleteMemberAllocation(id);
  if (error) return res.status(400).json({ error: error.message });

  if (requestId && allocationId) {
    await AllocModel.cleanupEmptyAllocationLocations(requestId, allocationId);
    await notifyAllocationUpdate(requestId);
  }
  res.json({ success: true, message: "Deleted successfully" });
};

// ─── EASY ALLOCATE MEMBER ───────────────────────────────────────────
export const allocateMember = async (req, res) => {
  const { id: request_id } = req.params;
  const { request_member_id, room_id, house_id, assigned_capacity = 1 } = req.body;

  try {
    const { data: request } = await supabase.from("requests").select("check_in, check_out, status").eq("id", request_id).single();
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (!canModifyAllocationForCheckIn(request.check_in)) return res.status(400).json({ error: "Allocation can be changed only before the check-in date." });

    // Capacity check for rooms
    if (room_id) {
      const { data: room } = await supabase.from("rooms").select("capacity").eq("id", room_id).single();
      if (room) {
        const selectedCount = Math.max(1, Number(assigned_capacity) || 1);
        if (selectedCount > Number(room.capacity)) return res.status(400).json({ error: `Room capacity is ${room.capacity}.` });

        const { data: activeBookings } = await supabase.from("room_bookings").select("room_id, request_id").lte("check_in", request.check_out).gte("check_out", request.check_in);
        if (activeBookings?.length > 0) {
          const roomIds = [...new Set(activeBookings.map(b => b.room_id))];
          const requestIds = [...new Set(activeBookings.map(b => b.request_id))];
          const { data: mas } = await supabase.from("member_allocations").select("id, request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))").in("allocation_items.room_id", roomIds).in("allocation_items.allocations.request_id", requestIds);

          const currentMembers = new Set(), otherMembers = new Set();
          mas?.forEach(ma => {
            const rId = ma.allocation_items.room_id, reqId = ma.allocation_items.allocations.request_id;
            if (activeBookings.some(b => b.room_id === rId && b.request_id === reqId) && rId === parseInt(room_id)) {
              currentMembers.add(ma.request_member_id);
              if (parseInt(reqId) !== parseInt(request_id)) otherMembers.add(ma.request_member_id);
            }
          });

          const avail = Number(room.capacity) - otherMembers.size;
          if (selectedCount > avail) return res.status(400).json({ error: `Room capacity is ${room.capacity}. You can only allocate ${Math.max(0, avail)} members.` });
          if (!currentMembers.has(parseInt(request_member_id)) && currentMembers.size >= Number(room.capacity)) return res.status(400).json({ error: `Room capacity is ${room.capacity}. You can only allocate 0 members.` });
        }
      }
    }

    // Find or create allocation
    let { data: allocation } = await AllocModel.findAllocationByRequestId(request_id);
    if (!allocation) { const { data: newAlloc } = await AllocModel.createAllocation(request_id); allocation = newAlloc; }

    // Find or create allocation item
    const filterCol = room_id ? "room_id" : "house_id";
    const filterVal = room_id || house_id;
    const { data: existingItems } = await AllocModel.findAllocationItemForLocation(allocation.id, filterCol, filterVal);

    let item;
    if (existingItems?.length > 0) {
      item = existingItems[0];
      await AllocModel.updateAllocationItem(item.id, { assigned_capacity });
    } else {
      const { data: newItem } = await AllocModel.createAllocationItem({
        allocation_id: allocation.id, room_id: room_id || null, house_id: house_id || null,
        allocation_type: room_id ? "ROOM" : "HOUSE", assigned_capacity
      });
      item = newItem;
    }

    // Create/update member allocation
    const { data: existingMA } = await AllocModel.findExistingMemberAllocation(request_member_id);
    let finalMA;
    if (existingMA) {
      const oldRoomId = existingMA.allocation_items?.room_id;
      const oldHouseId = existingMA.allocation_items?.house_id;
      const { data: updatedMA } = await AllocModel.updateMemberAllocation(existingMA.id, { allocation_item_id: item.id });
      finalMA = updatedMA;

      // Cleanup old booking
      if (oldRoomId || oldHouseId) {
        let cleanupQ = supabase.from("member_allocations").select("id, allocation_items!inner(room_id, house_id, allocations!inner(request_id))").eq("allocation_items.allocations.request_id", request_id);
        if (oldRoomId) cleanupQ = cleanupQ.eq("allocation_items.room_id", oldRoomId);
        else cleanupQ = cleanupQ.eq("allocation_items.house_id", oldHouseId);
        const { data: remaining } = await cleanupQ;
        if (!remaining || remaining.length === 0) {
          if (oldRoomId) await supabase.from("room_bookings").delete().eq("room_id", oldRoomId).eq("request_id", request_id);
          else if (oldHouseId) await supabase.from("house_bookings").delete().eq("house_id", oldHouseId).eq("request_id", request_id);
        }
      }
    } else {
      const { data: newMA } = await AllocModel.createMemberAllocation({ request_member_id, allocation_item_id: item.id });
      finalMA = newMA;
    }

    // Create/update booking
    if (room_id) {
      const { data: eb } = await supabase.from("room_bookings").select("id").eq("room_id", room_id).eq("request_id", request_id).maybeSingle();
      if (eb) await supabase.from("room_bookings").update({ check_in: request.check_in, check_out: request.check_out }).eq("id", eb.id);
      else await supabase.from("room_bookings").insert([{ room_id, request_id, check_in: request.check_in, check_out: request.check_out }]);
    } else if (house_id) {
      const { data: eb } = await supabase.from("house_bookings").select("id").eq("house_id", house_id).eq("request_id", request_id).maybeSingle();
      if (eb) await supabase.from("house_bookings").update({ check_in: request.check_in, check_out: request.check_out }).eq("id", eb.id);
      else await supabase.from("house_bookings").insert([{ house_id, request_id, check_in: request.check_in, check_out: request.check_out }]);
    }

    // Auto-promote status
    const { data: allMembers } = await RequestModel.getRequestMembersByRequestId(request_id);
    const memberIds = allMembers.map(m => m.id);
    const { data: allocs } = await AllocModel.getMemberAllocationsByMemberIds(memberIds);
    const allocatedCount = new Set(allocs.map(a => a.request_member_id)).size;
    const isFullyAllocated = allocatedCount === (allMembers?.length || 0);

    const { data: currentReq } = await supabase.from("requests").select("status").eq("id", request_id).single();

    if (allocatedCount > 0) {
      if (shouldPromoteRequestOnAllocation(currentReq?.status) || isAcceptedOrApprovedStatus(currentReq?.status)) {
        await supabase.from("requests").update({ status: "ACCEPTED" }).eq("id", request_id);
      }
      await notifyAllocationUpdate(request_id);
    }

    res.json({ success: true, message: "Member allocated successfully", allocation: finalMA });
  } catch (err) {
    console.error("[ALLOCATE] ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── SYNC ALLOCATION ────────────────────────────────────────────────
export const syncAllocation = async (req, res) => {
  const { id: request_id } = req.params;
  const { member_ids = [], room_id, house_id, assigned_capacity } = req.body;

  if (!Array.isArray(member_ids)) return res.status(400).json({ error: "member_ids must be an array." });
  if (!room_id && !house_id) return res.status(400).json({ error: "Please provide room_id or house_id." });

  try {
    const { data: request } = await supabase.from("requests").select("check_in, check_out, status").eq("id", request_id).single();
    if (!request) return res.status(404).json({ error: "Request not found" });
    if (!canModifyAllocationForCheckIn(request.check_in)) return res.status(400).json({ error: "Allocation can be changed only before the check-in date." });

    const { data: requestMembers } = await RequestModel.getRequestMembersByRequestId(request_id);
    const validMemberIds = new Set((requestMembers || []).map(m => Number(m.id)));
    const selectedMemberIds = [...new Set(member_ids.map(id => Number(id)))].filter(id => validMemberIds.has(id));

    // Room capacity validation
    if (room_id && selectedMemberIds.length > 0) {
      const { data: room } = await supabase.from("rooms").select("capacity").eq("id", room_id).single();
      if (!room) return res.status(404).json({ error: "Room not found" });

      const { data: activeBookings } = await supabase.from("room_bookings").select("room_id, request_id").eq("room_id", room_id).lte("check_in", request.check_out).gte("check_out", request.check_in);
      const currentMembers = new Set();
      if (activeBookings?.length > 0) {
        const requestIds = [...new Set(activeBookings.map(b => b.request_id))];
        const { data: mas } = await supabase.from("member_allocations").select("request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))").eq("allocation_items.room_id", room_id).in("allocation_items.allocations.request_id", requestIds);
        mas?.forEach(ma => {
          if (activeBookings.some(b => b.request_id === ma.allocation_items.allocations.request_id)) currentMembers.add(Number(ma.request_member_id));
        });
      }
      const additions = selectedMemberIds.filter(id => !currentMembers.has(id));
      const remaining = Math.max(0, (Number(room.capacity) || 0) - currentMembers.size);
      if (additions.length > remaining) return res.status(400).json({ error: `Room capacity is ${room.capacity}. You can only allocate ${remaining} more members.` });
    }

    let { data: allocation } = await AllocModel.findAllocationByRequestId(request_id);
    if (!allocation) { const { data: na } = await AllocModel.createAllocation(request_id); allocation = na; }

    const filterCol = room_id ? "room_id" : "house_id";
    const filterVal = Number(room_id || house_id);
    let { data: item } = await supabase.from("allocation_items").select("id").eq("allocation_id", allocation.id).eq(filterCol, filterVal).maybeSingle();

    if (!item) {
      const { data: ni } = await AllocModel.createAllocationItem({
        allocation_id: allocation.id, room_id: room_id || null, house_id: room_id ? null : house_id,
        allocation_type: room_id ? "ROOM" : "HOUSE", assigned_capacity: assigned_capacity || selectedMemberIds.length
      });
      item = ni;
    } else {
      await AllocModel.updateAllocationItem(item.id, { allocation_type: room_id ? "ROOM" : "HOUSE", assigned_capacity: assigned_capacity || selectedMemberIds.length });
    }

    const { data: existingMAs } = await AllocModel.getMemberAllocationsForAllocation(allocation.id);
    const existingByMemberId = new Map();
    for (const ma of existingMAs || []) existingByMemberId.set(Number(ma.request_member_id), ma);

    for (const memberId of selectedMemberIds) {
      const existing = existingByMemberId.get(memberId);
      if (existing) {
        if (Number(existing.allocation_item_id) !== Number(item.id)) await supabase.from("member_allocations").update({ allocation_item_id: item.id }).eq("id", existing.id);
      } else {
        await supabase.from("member_allocations").insert([{ request_member_id: memberId, allocation_item_id: item.id }]);
      }
    }

    // Create bookings
    if (selectedMemberIds.length > 0) {
      if (room_id) {
        const { data: eb } = await supabase.from("room_bookings").select("id").eq("room_id", room_id).eq("request_id", request_id).maybeSingle();
        if (eb) await supabase.from("room_bookings").update({ check_in: request.check_in, check_out: request.check_out }).eq("id", eb.id);
        else await supabase.from("room_bookings").insert([{ room_id, request_id, check_in: request.check_in, check_out: request.check_out }]);
      } else if (house_id) {
        const { data: eb } = await supabase.from("house_bookings").select("id").eq("house_id", house_id).eq("request_id", request_id).maybeSingle();
        if (eb) await supabase.from("house_bookings").update({ check_in: request.check_in, check_out: request.check_out }).eq("id", eb.id);
        else await supabase.from("house_bookings").insert([{ house_id, request_id, check_in: request.check_in, check_out: request.check_out }]);
      }
    }

    await AllocModel.cleanupEmptyAllocationLocations(request_id, allocation.id);

    // Status management
    let allocatedMembers = [];
    if (validMemberIds.size > 0) {
      const { data } = await AllocModel.getMemberAllocationsByMemberIds([...validMemberIds]);
      allocatedMembers = data || [];
    }
    const allocatedCount = new Set(allocatedMembers.map(ma => Number(ma.request_member_id))).size;
    if (allocatedCount > 0) {
      if (shouldPromoteRequestOnAllocation(request.status) || isAcceptedOrApprovedStatus(request.status)) {
        await supabase.from("requests").update({ status: "ACCEPTED" }).eq("id", request_id);
      }
    }

    await notifyAllocationUpdate(request_id);
    res.json({ success: true, message: "Allocation synced successfully", selected_member_ids: selectedMemberIds });
  } catch (err) {
    console.error("[SYNC ALLOCATION] ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
};

// ─── ACCEPT-COMPLETE ────────────────────────────────────────────────
export const acceptComplete = async (req, res) => {
  const { id } = req.params;
  const { notes, room_assignments, house_assignments } = req.body;

  try {
    // Validate availability
    if (Array.isArray(room_assignments)) {
      for (const ra of room_assignments) {
        let query = supabase.from("room_bookings").select("*").eq("room_id", ra.room_id).lte("check_in", ra.check_out).gte("check_out", ra.check_in).neq("request_id", id);
        const { data } = await query;
        if (data?.length > 0) throw new Error(`Room ID ${ra.room_id} is already occupied during these dates.`);
      }
    }

    const { data: existingReq } = await supabase.from("requests").select("id").eq("id", id).single();
    if (!existingReq) return res.status(404).json({ error: `Request with ID ${id} not found.` });

    await supabase.from("requests").update({ status: "ACCEPTED", notes: notes || null }).eq("id", id);

    // Get or create allocation
    const { data: allocSearch } = await supabase.from("allocations").select("id").eq("request_id", id);
    let allocation;
    if (allocSearch?.length > 0) {
      allocation = allocSearch[0];
      await supabase.from("allocation_items").delete().eq("allocation_id", allocation.id);
      await supabase.from("room_bookings").delete().eq("request_id", id);
      await supabase.from("house_bookings").delete().eq("request_id", id);
    } else {
      const { data: newAlloc } = await supabase.from("allocations").insert([{ request_id: id }]).select().single();
      allocation = newAlloc;
    }

    // Process room assignments
    if (Array.isArray(room_assignments)) {
      for (const ra of room_assignments) {
        const { data: item } = await supabase.from("allocation_items").insert([{ allocation_id: allocation.id, room_id: ra.room_id, house_id: null, allocation_type: "ROOM", assigned_capacity: ra.assigned_capacity }]).select().single();
        await supabase.from("room_bookings").insert([{ room_id: ra.room_id, request_id: id, check_in: ra.check_in, check_out: ra.check_out }]);
        if (Array.isArray(ra.member_ids)) {
          await supabase.from("member_allocations").insert(ra.member_ids.map(mId => ({ request_member_id: mId, allocation_item_id: item.id })));
        }
      }
    }

    // Process house assignments
    if (Array.isArray(house_assignments)) {
      for (const ha of house_assignments) {
        await supabase.from("allocation_items").insert([{ allocation_id: allocation.id, room_id: null, house_id: ha.house_id, allocation_type: "HOUSE", assigned_capacity: 0 }]);
        await supabase.from("house_bookings").insert([{ house_id: ha.house_id, request_id: id, check_in: ha.check_in || ha.check_in_date, check_out: ha.check_out || ha.check_out_date }]);
      }
    }

    await notifyAllocationUpdate(id);
    res.json({ success: true, message: "Request accepted and fully allocated", allocation_id: allocation.id });
  } catch (err) {
    console.error("Accept-complete error:", err.message);
    res.status(400).json({ error: err.message });
  }
};
