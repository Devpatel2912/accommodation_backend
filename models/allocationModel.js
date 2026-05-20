import { supabase } from "../config/supabase.js";

export const findAllocationByRequestId = async (requestId) => {
  const { data, error } = await supabase.from("allocations").select("id").eq("request_id", requestId).maybeSingle();
  return { data, error };
};

export const createAllocation = async (requestId) => {
  const { data, error } = await supabase.from("allocations").insert([{ request_id: requestId }]).select().single();
  return { data, error };
};

export const getAllAllocations = async () => {
  const { data, error } = await supabase.from("allocations").select("*, allocation_items(*)");
  return { data, error };
};

export const getAllocationById = async (id) => {
  const { data, error } = await supabase.from("allocations").select(`*, allocation_items (id, room_id, assigned_capacity, rooms (room_number, capacity))`).eq("id", id).single();
  return { data, error };
};

export const updateAllocation = async (id, updates) => {
  const { error } = await supabase.from("allocations").update(updates).eq("id", id);
  return { error };
};

export const deleteAllocation = async (id) => {
  await supabase.from("allocation_items").delete().eq("allocation_id", id);
  const { error } = await supabase.from("allocations").delete().eq("id", id);
  return { error };
};

export const deleteAllocationItemsByAllocationId = async (allocationId) => {
  const { error } = await supabase.from("allocation_items").delete().eq("allocation_id", allocationId);
  return { error };
};

// ─── Allocation Items ───────────────────────────────────────────────

export const createAllocationItem = async (itemData) => {
  const { data, error } = await supabase.from("allocation_items").insert([itemData]).select().single();
  return { data, error };
};

export const getAllAllocationItems = async () => {
  const { data, error } = await supabase.from("allocation_items").select("*");
  return { data, error };
};

export const updateAllocationItem = async (id, updates) => {
  const { error } = await supabase.from("allocation_items").update(updates).eq("id", id);
  return { error };
};

export const deleteAllocationItem = async (id) => {
  const { error } = await supabase.from("allocation_items").delete().eq("id", id);
  return { error };
};

export const getAllocationItemWithCheckIn = async (id) => {
  const { data, error } = await supabase.from("allocation_items").select("id, allocations!inner(requests!inner(check_in))").eq("id", id).single();
  return { data, error };
};

export const findAllocationItemForLocation = async (allocationId, filterCol, filterVal) => {
  const { data, error } = await supabase.from("allocation_items").select("id").eq("allocation_id", allocationId).eq(filterCol, filterVal);
  return { data, error };
};

export const getItemsWithMemberAllocations = async (allocationId) => {
  const { data, error } = await supabase.from("allocation_items").select("id, room_id, house_id, member_allocations(id)").eq("allocation_id", allocationId);
  return { data, error };
};

// ─── Member Allocations ─────────────────────────────────────────────

export const createMemberAllocation = async (maData) => {
  const { data, error } = await supabase.from("member_allocations").insert([maData]).select().single();
  return { data, error };
};

export const insertMemberAllocations = async (maDataArray) => {
  const { error } = await supabase.from("member_allocations").insert(maDataArray);
  return { error };
};

export const getAllMemberAllocations = async () => {
  const { data, error } = await supabase.from("member_allocations").select("*");
  return { data, error };
};

export const getMemberAllocationById = async (id) => {
  const { data, error } = await supabase.from("member_allocations").select("*").eq("id", id).single();
  return { data, error };
};

export const updateMemberAllocation = async (id, updates) => {
  const { data, error } = await supabase.from("member_allocations").update(updates).eq("id", id).select().single();
  return { data, error };
};

export const deleteMemberAllocation = async (id) => {
  const { error } = await supabase.from("member_allocations").delete().eq("id", id);
  return { error };
};

export const getMemberAllocationWithContext = async (id) => {
  const { data, error } = await supabase.from("member_allocations").select("id, allocation_items!inner(allocation_id, allocations!inner(request_id, requests!inner(check_in)))").eq("id", id).single();
  return { data, error };
};

export const deleteMemberAllocationsByItemId = async (itemId) => {
  const { error } = await supabase.from("member_allocations").delete().eq("allocation_item_id", itemId);
  return { error };
};

export const findExistingMemberAllocation = async (requestMemberId) => {
  const { data, error } = await supabase.from("member_allocations").select("id, allocation_item_id, allocation_items(room_id, house_id)").eq("request_member_id", requestMemberId).maybeSingle();
  return { data, error };
};

export const getMemberAllocationsByMemberIds = async (memberIds) => {
  const { data, error } = await supabase.from("member_allocations").select("request_member_id").in("request_member_id", memberIds);
  return { data, error };
};

export const getMemberAllocationsForAllocation = async (allocationId) => {
  const { data, error } = await supabase.from("member_allocations").select("id, request_member_id, allocation_item_id, allocation_items!inner(allocation_id)").eq("allocation_items.allocation_id", allocationId);
  return { data, error };
};

export const getMemberAllocationsForRoomValidation = async (roomIds, requestIds) => {
  const { data, error } = await supabase.from("member_allocations").select("id, request_member_id, allocation_items!inner(room_id, allocations!inner(request_id))").in("allocation_items.room_id", roomIds).in("allocation_items.allocations.request_id", requestIds);
  return { data, error };
};

// ─── Cleanup empty allocation locations ─────────────────────────────
export const cleanupEmptyAllocationLocations = async (requestId, allocationId) => {
  const { data: items, error } = await supabase.from("allocation_items").select("id, room_id, house_id, member_allocations(id)").eq("allocation_id", allocationId);
  if (error) throw error;

  for (const item of items || []) {
    if ((item.member_allocations || []).length > 0) continue;

    if (item.room_id) {
      await supabase.from("room_bookings").delete().eq("room_id", item.room_id).eq("request_id", requestId);
    }
    if (item.house_id) {
      await supabase.from("house_bookings").delete().eq("house_id", item.house_id).eq("request_id", requestId);
    }
    await supabase.from("allocation_items").delete().eq("id", item.id);
  }
};

// ─── Helper: delete allocation_items cascade for room deletion ──────
export const deleteAllocationItemsByRoomId = async (roomId) => {
  const { data: items, error } = await supabase.from("allocation_items").select("id").eq("room_id", roomId);
  if (error) throw error;
  if (items && items.length > 0) {
    const itemIds = items.map(i => i.id);
    await supabase.from("member_allocations").delete().in("allocation_item_id", itemIds);
    await supabase.from("allocation_items").delete().in("id", itemIds);
  }
};
