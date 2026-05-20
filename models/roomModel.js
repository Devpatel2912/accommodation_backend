import { supabase } from "../config/supabase.js";

// ─── Create room ────────────────────────────────────────────────────
export const createRoom = async (roomData) => {
  const { data, error } = await supabase
    .from("rooms")
    .insert([roomData])
    .select()
    .single();
  return { data, error };
};

// ─── Find room by room_number ───────────────────────────────────────
export const findRoomByNumber = async (roomNumber) => {
  const { data, error } = await supabase
    .from("rooms")
    .select("id")
    .eq("room_number", roomNumber)
    .single();
  return { data, error };
};

// ─── Get all rooms (admin view — includes inactive) ─────────────────
export const getAllRoomsAdmin = async () => {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .order("room_number", { ascending: true });
  return { data, error };
};

// ─── Get all active rooms ───────────────────────────────────────────
export const getActiveRooms = async () => {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("is_active", true)
    .order("room_number", { ascending: true });
  return { data, error };
};

// ─── Get single room by ID ─────────────────────────────────────────
export const getRoomById = async (id) => {
  const { data, error } = await supabase
    .from("rooms")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
};

// ─── Update room ────────────────────────────────────────────────────
export const updateRoom = async (id, updates) => {
  const { data, error } = await supabase
    .from("rooms")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  return { data, error };
};

// ─── Delete room ────────────────────────────────────────────────────
export const deleteRoom = async (id) => {
  const { error } = await supabase
    .from("rooms")
    .delete()
    .eq("id", id);
  return { error };
};

// ─── Room Bookings ──────────────────────────────────────────────────

export const getOverlappingRoomBookings = async (checkIn, checkOut) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("room_id, request_id")
    .lte("check_in", checkOut)
    .gte("check_out", checkIn);
  return { data, error };
};

export const getActiveRoomBookingsForRoom = async (roomId, date) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("id")
    .eq("room_id", roomId)
    .lte("check_in", date)
    .gte("check_out", date);
  return { data, error };
};

export const deleteRoomBookingsByRoomId = async (roomId) => {
  const { error } = await supabase
    .from("room_bookings")
    .delete()
    .eq("room_id", roomId);
  return { error };
};

export const deleteRoomBookingsByRequestId = async (requestId) => {
  const { error } = await supabase
    .from("room_bookings")
    .delete()
    .eq("request_id", requestId);
  return { error };
};

export const createRoomBooking = async (bookingData) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .insert([bookingData])
    .select()
    .single();
  return { data, error };
};

export const getAllRoomBookings = async () => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("*, rooms(*), requests(*)")
    .order("id", { ascending: true });
  return { data, error };
};

export const getRoomBookingById = async (id) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
};

export const updateRoomBooking = async (id, updates) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .update(updates)
    .eq("id", id)
    .select();
  return { data, error };
};

export const deleteRoomBooking = async (id) => {
  const { error } = await supabase
    .from("room_bookings")
    .delete()
    .eq("id", id);
  return { error };
};

export const findActiveRoomBooking = async (roomId, date) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("id")
    .eq("room_id", roomId)
    .lte("check_in", date)
    .gte("check_out", date)
    .single();
  return { data, error };
};

export const findNextRoomBooking = async (roomId, date) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("id")
    .eq("room_id", roomId)
    .gt("check_in", date)
    .order("check_in", { ascending: true })
    .limit(1)
    .single();
  return { data, error };
};

export const getFullRoomBooking = async (id) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("*")
    .eq("id", id)
    .single();
  return { data, error };
};

export const deleteRoomBookingById = async (id) => {
  const { error } = await supabase
    .from("room_bookings")
    .delete()
    .eq("id", id);
  return { error };
};

export const findRoomBookingForRequest = async (roomId, requestId) => {
  const { data, error } = await supabase
    .from("room_bookings")
    .select("id")
    .eq("room_id", roomId)
    .eq("request_id", requestId)
    .maybeSingle();
  return { data, error };
};

export const upsertRoomBooking = async (roomId, requestId, checkIn, checkOut) => {
  const { data: existing } = await findRoomBookingForRequest(roomId, requestId);
  if (existing) {
    await supabase.from("room_bookings").update({ check_in: checkIn, check_out: checkOut }).eq("id", existing.id);
  } else {
    await supabase.from("room_bookings").insert([{ room_id: roomId, request_id: requestId, check_in: checkIn, check_out: checkOut }]);
  }
};

// ─── Member allocations for room occupancy ──────────────────────────
export const getMemberAllocationsForRooms = async () => {
  const { data, error } = await supabase
    .from("member_allocations")
    .select(`
      id,
      allocation_items!inner (
        room_id,
        allocations!inner (
          request_id
        )
      )
    `);
  return { data, error };
};

// ─── Get room capacity ──────────────────────────────────────────────
export const getRoomCapacity = async (roomId) => {
  const { data, error } = await supabase
    .from("rooms")
    .select("capacity")
    .eq("id", roomId)
    .single();
  return { data, error };
};
