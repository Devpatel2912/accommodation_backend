import * as HouseModel from "../models/houseModel.js";
import { mapHouseBookingDates } from "../utils/helpers.js";
import { notifyAllocationUpdate } from "./adminController.js";
import { supabase } from "../config/supabase.js";

export const createHouse = async (req, res) => {
  const { owner_name, contact_number, address, latitude, longitude, capacity, image_url, is_active } = req.body;
  const { data, error } = await HouseModel.createHouse({ owner_name, contact_number, address, latitude, longitude, capacity, image_url, is_active: is_active ?? true });
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, house: data });
};

export const getAllHouses = async (req, res) => {
  const { check_in, check_out } = req.query;
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const qCI = check_in || today, qCO = check_out || tomorrow;
  try {
    let { data: houses, error } = await HouseModel.getAllHouses();
    if (error) throw error;
    const { data: bookings, error: bErr } = await HouseModel.getOverlappingHouseBookings(qCI, qCO);
    if (bErr) throw bErr;
    const occupancyMap = {};
    bookings?.forEach(b => { occupancyMap[b.house_id] = (occupancyMap[b.house_id] || 0) + 1; });
    houses = houses.map(house => {
      const occ = occupancyMap[house.id] || 0;
      return { ...house, booked_count: occ, current_occupancy: occ, remaining_capacity: Math.max(0, (house.capacity || 0) - occ) };
    });
    res.json({ success: true, houses });
  } catch (error) { console.error("GET HOUSES ERROR:", error); res.status(500).json({ error: error.message }); }
};

export const getHouseById = async (req, res) => {
  const { data, error } = await HouseModel.getHouseById(req.params.id);
  if (error || !data) return res.status(404).json({ error: "House not found" });
  res.json({ success: true, house: data });
};

export const updateHouse = async (req, res) => {
  const { data, error } = await HouseModel.updateHouse(req.params.id, req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, house: data });
};

export const deleteHouse = async (req, res) => {
  const { error } = await HouseModel.deleteHouse(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: "House deleted from database" });
};

// ─── House Bookings ─────────────────────────────────────────────────
export const createHouseBooking = async (req, res) => {
  const { house_id, request_id } = req.body;
  const { check_in, check_out } = mapHouseBookingDates(req.body);
  const { data, error } = await HouseModel.createHouseBooking({ house_id, request_id, check_in, check_out });
  if (error) return res.status(400).json({ error: error.message });
  await supabase.from("requests").update({ status: "ACCEPTED", notes: null }).eq("id", request_id);
  await notifyAllocationUpdate(request_id);
  res.json({ success: true, booking: data });
};

export const getAllHouseBookings = async (req, res) => {
  const { data, error } = await HouseModel.getAllHouseBookings();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, bookings: data });
};

export const getHouseBookingById = async (req, res) => {
  const { data, error } = await HouseModel.getHouseBookingById(req.params.id);
  if (error || !data) return res.status(404).json({ error: "Booking not found" });
  res.json({ success: true, booking: data });
};

export const updateHouseBooking = async (req, res) => {
  const updates = { ...req.body };
  if (updates.check_in || updates.check_out || updates.check_in_date || updates.check_out_date) {
    const { check_in, check_out } = mapHouseBookingDates(updates);
    delete updates.check_in_date; delete updates.check_out_date;
    if (check_in) updates.check_in = check_in;
    if (check_out) updates.check_out = check_out;
  }
  const { data, error } = await HouseModel.updateHouseBooking(req.params.id, updates);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, booking: data });
};

export const deleteHouseBooking = async (req, res) => {
  const { error } = await HouseModel.deleteHouseBooking(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: "House booking deleted" });
};

export const releaseHouseBooking = async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const { data, error } = await HouseModel.updateHouseBooking(req.params.id, { check_out: today });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, message: "House released successfully", booking: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const releaseHouseByHouseId = async (req, res) => {
  const { house_id } = req.params;
  const today = new Date().toISOString().split("T")[0];
  try {
    let { data: booking } = await HouseModel.findActiveHouseBooking(house_id, today);
    if (!booking) {
      const { data: future } = await HouseModel.findNextHouseBooking(house_id, today);
      if (!future) return res.status(404).json({ error: "No active or upcoming bookings found." });
      booking = future;
    }
    const { data: full } = await HouseModel.getFullHouseBooking(booking.id);
    if (full.check_in > today) {
      await supabase.from("house_bookings").delete().eq("id", booking.id);
      return res.json({ success: true, message: `Future booking for house ${house_id} cancelled.` });
    }
    const { data, error } = await HouseModel.updateHouseBooking(booking.id, { check_out: today });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, message: `House ${house_id} released successfully`, booking: data });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
