import { supabase } from "../config/supabase.js";

export const createHouse = async (houseData) => {
  const { data, error } = await supabase.from("houses").insert([houseData]).select().single();
  return { data, error };
};

export const getAllHouses = async () => {
  const { data, error } = await supabase.from("houses").select("*").order("id", { ascending: true });
  return { data, error };
};

export const getActiveHouses = async () => {
  const { data, error } = await supabase.from("houses").select("*").eq("is_active", true);
  return { data, error };
};

export const getHouseById = async (id) => {
  const { data, error } = await supabase.from("houses").select("*").eq("id", id).single();
  return { data, error };
};

export const updateHouse = async (id, updates) => {
  const { data, error } = await supabase.from("houses").update(updates).eq("id", id).select().single();
  return { data, error };
};

export const deleteHouse = async (id) => {
  const { error } = await supabase.from("houses").delete().eq("id", id);
  return { error };
};

export const getOverlappingHouseBookings = async (checkIn, checkOut) => {
  const { data, error } = await supabase.from("house_bookings").select("house_id").lte("check_in", checkOut).gte("check_out", checkIn);
  return { data, error };
};

export const deleteHouseBookingsByRequestId = async (requestId) => {
  return supabase.from("house_bookings").delete().eq("request_id", requestId);
};

export const createHouseBooking = async (bookingData) => {
  const { data, error } = await supabase.from("house_bookings").insert([bookingData]).select().single();
  return { data, error };
};

export const getAllHouseBookings = async () => {
  const { data, error } = await supabase.from("house_bookings").select("*, houses(*), requests(*)");
  return { data, error };
};

export const getHouseBookingById = async (id) => {
  const { data, error } = await supabase.from("house_bookings").select("*").eq("id", id).single();
  return { data, error };
};

export const updateHouseBooking = async (id, updates) => {
  const { data, error } = await supabase.from("house_bookings").update(updates).eq("id", id).select().single();
  return { data, error };
};

export const deleteHouseBooking = async (id) => {
  const { error } = await supabase.from("house_bookings").delete().eq("id", id);
  return { error };
};

export const findActiveHouseBooking = async (houseId, date) => {
  const { data, error } = await supabase.from("house_bookings").select("id").eq("house_id", houseId).lte("check_in", date).gte("check_out", date).single();
  return { data, error };
};

export const findNextHouseBooking = async (houseId, date) => {
  const { data, error } = await supabase.from("house_bookings").select("id").eq("house_id", houseId).gt("check_in", date).order("check_in", { ascending: true }).limit(1).single();
  return { data, error };
};

export const getFullHouseBooking = async (id) => {
  const { data, error } = await supabase.from("house_bookings").select("*").eq("id", id).single();
  return { data, error };
};

export const findHouseBookingForRequest = async (houseId, requestId) => {
  const { data, error } = await supabase.from("house_bookings").select("id").eq("house_id", houseId).eq("request_id", requestId).maybeSingle();
  return { data, error };
};

export const upsertHouseBooking = async (houseId, requestId, checkIn, checkOut) => {
  const { data: existing } = await findHouseBookingForRequest(houseId, requestId);
  if (existing) {
    await supabase.from("house_bookings").update({ check_in: checkIn, check_out: checkOut }).eq("id", existing.id);
  } else {
    await supabase.from("house_bookings").insert([{ house_id: houseId, request_id: requestId, check_in: checkIn, check_out: checkOut }]);
  }
};
