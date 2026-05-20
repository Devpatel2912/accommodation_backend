import * as RoomModel from "../models/roomModel.js";
import { deleteAllocationItemsByRoomId } from "../models/allocationModel.js";

export const createRoom = async (req, res) => {
  const { room_number, capacity, is_active } = req.body;
  if (!room_number || !capacity) return res.status(400).json({ error: "room_number and capacity are required" });
  try {
    const { data: existing } = await RoomModel.findRoomByNumber(room_number);
    if (existing) return res.status(400).json({ error: "Room number already exists" });
    const { data, error } = await RoomModel.createRoom({ room_number, capacity, is_active: is_active ?? true });
    if (error) throw error;
    res.status(201).json({ success: true, room: data });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAllRoomsAdmin = async (req, res) => {
  try {
    const { data, error } = await RoomModel.getAllRoomsAdmin();
    if (error) throw error;
    res.json({ success: true, rooms: data });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const getAvailableRooms = async (req, res) => {
  const { check_in, check_out } = req.query;
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];
  const qCI = check_in || today, qCO = check_out || tomorrow;

  try {
    let { data: rooms, error } = await RoomModel.getActiveRooms();
    if (error) throw error;

    const { data: activeBookings, error: bErr } = await RoomModel.getOverlappingRoomBookings(qCI, qCO);
    if (bErr) throw bErr;

    const occupancyMap = {};
    if (activeBookings?.length > 0) {
      const { data: allocations, error: oErr } = await RoomModel.getMemberAllocationsForRooms();
      if (oErr) throw oErr;
      allocations?.forEach(ma => {
        const rId = ma.allocation_items.room_id, reqId = ma.allocation_items.allocations.request_id;
        if (activeBookings.some(b => b.room_id === rId && b.request_id === reqId)) {
          occupancyMap[rId] = (occupancyMap[rId] || 0) + 1;
        }
      });
    }

    rooms = rooms.map(room => {
      const occ = occupancyMap[room.id] || 0;
      return { ...room, current_occupancy: occ, remaining_capacity: Math.max(0, room.capacity - occ) };
    });
    if (check_in && check_out) rooms = rooms.filter(r => Number(r.remaining_capacity) > 0);

    res.json({ success: true, rooms });
  } catch (error) { console.error("GET ROOMS ERROR:", error); res.status(500).json({ error: error.message }); }
};

export const getRoomById = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    const { data, error } = await RoomModel.getRoomById(id);
    if (error || !data) return res.status(404).json({ error: "Room not found" });
    res.json({ success: true, room: data });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const updateRoom = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    if (req.body.is_active === false) {
      const today = new Date().toISOString().split("T")[0];
      const { data: active } = await RoomModel.getActiveRoomBookingsForRoom(id, today);
      if (active?.length > 0) return res.status(400).json({ error: "Cannot deactivate room while it is occupied." });
    }
    const { data, error } = await RoomModel.updateRoom(id, req.body);
    if (error || !data) return res.status(404).json({ error: "Room not found or update failed" });
    res.json({ success: true, room: data });
  } catch (error) { res.status(500).json({ error: error.message }); }
};

export const deleteRoom = async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
  try {
    const today = new Date().toISOString().split("T")[0];
    const { data: active } = await RoomModel.getActiveRoomBookingsForRoom(id, today);
    if (active?.length > 0) return res.status(400).json({ error: "Cannot delete room while it is occupied." });

    await RoomModel.deleteRoomBookingsByRoomId(id);
    await deleteAllocationItemsByRoomId(id);
    const { error } = await RoomModel.deleteRoom(id);
    if (error) throw error;
    res.json({ success: true, message: "Room and all associated data deleted successfully" });
  } catch (error) { console.error("DELETE ROOM ERROR:", error); res.status(500).json({ error: error.message }); }
};

// ─── Room Bookings ──────────────────────────────────────────────────
export const createRoomBooking = async (req, res) => {
  const { data, error } = await RoomModel.createRoomBooking(req.body);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, booking: data });
};

export const getAllRoomBookings = async (req, res) => {
  const { data, error } = await RoomModel.getAllRoomBookings();
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, bookings: data });
};

export const getRoomBookingById = async (req, res) => {
  const { data, error } = await RoomModel.getRoomBookingById(req.params.id);
  if (error || !data) return res.status(404).json({ error: "Booking not found" });
  res.json({ success: true, booking: data });
};

export const updateRoomBooking = async (req, res) => {
  const { data, error } = await RoomModel.updateRoomBooking(req.params.id, req.body);
  if (error) return res.status(400).json({ error: error.message });
  if (!data || data.length === 0) return res.status(404).json({ error: "Booking not found" });
  res.json({ success: true, booking: data[0] });
};

export const deleteRoomBooking = async (req, res) => {
  const { error } = await RoomModel.deleteRoomBooking(req.params.id);
  if (error) return res.status(400).json({ error: error.message });
  res.json({ success: true, message: "Booking deleted" });
};

export const releaseRoomBooking = async (req, res) => {
  const today = new Date().toISOString().split("T")[0];
  try {
    const { data, error } = await RoomModel.updateRoomBooking(req.params.id, { check_out: today });
    if (error) return res.status(400).json({ error: error.message });
    if (!data || data.length === 0) return res.status(404).json({ error: "Booking not found" });
    res.json({ success: true, message: "Room released successfully", booking: data[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
};

export const releaseRoomByRoomId = async (req, res) => {
  const { room_id } = req.params;
  const today = new Date().toISOString().split("T")[0];
  try {
    let { data: booking } = await RoomModel.findActiveRoomBooking(room_id, today);
    if (!booking) {
      const { data: future } = await RoomModel.findNextRoomBooking(room_id, today);
      if (!future) return res.status(404).json({ error: "No active or upcoming bookings found." });
      booking = future;
    }
    const { data: full } = await RoomModel.getFullRoomBooking(booking.id);
    if (full.check_in > today) {
      await RoomModel.deleteRoomBookingById(booking.id);
      return res.json({ success: true, message: `Future booking for room ${room_id} cancelled.` });
    }
    const { data, error } = await RoomModel.updateRoomBooking(booking.id, { check_out: today });
    if (error) return res.status(400).json({ error: error.message });
    res.json({ success: true, message: `Room ${room_id} released successfully`, booking: data[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
};
