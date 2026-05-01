import express from "express";
import { supabase } from "../config/supabase.js";
import { verifyToken } from "../utils/jwt.js";

const router = express.Router();


// =========================
// 🔐 AUTH MIDDLEWARE
// =========================
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers["authorization"];
    const token = authHeader && authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({ error: "Access denied. No token provided." });
    }

    try {
        const decoded = verifyToken(token);
        req.user = decoded;
        next();
    } catch (error) {
        res.status(403).json({ error: "Invalid or expired token" });
    }
};


// =========================
// 🔐 ADMIN CHECK
// =========================
const authorizeAdmin = (req, res, next) => {
    if (req.user && req.user.role === "ADMIN") {
        next();
    } else {
        res.status(403).json({ error: "Admin access only" });
    }
};


// =========================
// ➕ CREATE ROOM (ADMIN)
// =========================
router.post("/", authenticateToken, authorizeAdmin, async (req, res) => {
    const { room_number, capacity, is_active } = req.body;

    if (!room_number || !capacity) {
        return res.status(400).json({ error: "room_number and capacity are required" });
    }

    try {
        // Check duplicate room number
        const { data: existing } = await supabase
            .from("rooms")
            .select("id")
            .eq("room_number", room_number)
            .single();

        if (existing) {
            return res.status(400).json({ error: "Room number already exists" });
        }

        const { data, error } = await supabase
            .from("rooms")
            .insert([
                {
                    room_number,
                    capacity,
                    is_active: is_active ?? true
                }
            ])
            .select()
            .single();

        if (error) throw error;

        res.status(201).json({
            success: true,
            room: data
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// =========================
// 📄 GET ALL ROOMS (ADMIN VIEW - INCLUDES INACTIVE)
// =========================
router.get("/admin/all", authenticateToken, authorizeAdmin, async (req, res) => {
    try {
        const { data: rooms, error } = await supabase
            .from("rooms")
            .select("*")
            .order("room_number", { ascending: true });

        if (error) throw error;

        res.json({
            success: true,
            rooms: rooms
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// =========================
// 📄 GET AVAILABLE ROOMS
// =========================
router.get("/", async (req, res) => {
    const { check_in, check_out } = req.query;

    // 1. Default to today if no dates provided
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    const queryCheckIn = check_in || today;
    const queryCheckOut = check_out || tomorrow;

    try {
        // 1. Fetch all active rooms
        let { data: rooms, error: roomsError } = await supabase
            .from("rooms")
            .select("*")
            .eq("is_active", true)
            .order("room_number", { ascending: true });

        if (roomsError) throw roomsError;

        // 2. Calculate occupancy for the selected (or default) dates
        // Step 1: Find all room bookings that overlap with requested dates
        const { data: activeBookings, error: bookingsError } = await supabase
            .from("room_bookings")
            .select("room_id, request_id")
            .lte("check_in", queryCheckOut)
            .gte("check_out", queryCheckIn);

        if (bookingsError) throw bookingsError;

        const occupancyMap = {};

        if (activeBookings && activeBookings.length > 0) {
            // Step 2: Get all member allocations linked to these rooms and requests
            // We join member_allocations -> allocation_items -> allocations
            const { data: allocations, error: occupancyError } = await supabase
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

            if (occupancyError) throw occupancyError;

            // Step 3: Filter those allocations against the active bookings (date-wise)
            allocations?.forEach(ma => {
                const rId = ma.allocation_items.room_id;
                const reqId = ma.allocation_items.allocations.request_id;
                
                // Only count if this (room, request) pair has an active booking for our date range
                const hasActiveBooking = activeBookings.some(b => b.room_id === rId && b.request_id === reqId);
                if (hasActiveBooking) {
                    occupancyMap[rId] = (occupancyMap[rId] || 0) + 1;
                }
            });
        }

        // 3. Map occupancy data to rooms
        rooms = rooms.map(room => {
            const currentOccupancy = occupancyMap[room.id] || 0;
            const remaining = room.capacity - currentOccupancy;
            return {
                ...room,
                current_occupancy: currentOccupancy,
                remaining_capacity: Math.max(0, remaining)
            };
        });

        // 4. In selection mode, we only show rooms with availability
        if (check_in && check_out) {
            rooms = rooms.filter(room => room.remaining_capacity > 0);
        }

        res.json({
            success: true,
            rooms: rooms
        });

    } catch (error) {
        console.error("GET ROOMS ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});


// =========================
// 🔍 GET SINGLE ROOM (ADMIN)
// =========================
router.get("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
    }

    try {
        const { data, error } = await supabase
            .from("rooms")
            .select("*")
            .eq("id", id)
            .single();

        if (error || !data) {
            return res.status(404).json({ error: "Room not found" });
        }

        res.json({
            success: true,
            room: data
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// =========================
// ✏️ UPDATE ROOM (ADMIN)
// =========================
router.put("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);
    const updates = req.body;

    if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
    }

    try {
        // If deactivating, check if occupied today
        if (updates.is_active === false) {
            const today = new Date().toISOString().split('T')[0];
            const { data: activeBookings } = await supabase
                .from("room_bookings")
                .select("id")
                .eq("room_id", id)
                .lte("check_in", today)
                .gte("check_out", today);

            if (activeBookings && activeBookings.length > 0) {
                return res.status(400).json({ 
                    error: "Cannot deactivate room while it is occupied. Please wait for checkout or release the room first." 
                });
            }
        }

        const { data, error } = await supabase
            .from("rooms")
            .update(updates)
            .eq("id", id)
            .select()
            .single();

        if (error || !data) {
            return res.status(404).json({ error: "Room not found or update failed" });
        }

        res.json({
            success: true,
            room: data
        });

    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});


// =========================
// ❌ DELETE ROOM (ADMIN - HARD DELETE)
// =========================
router.delete("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const id = parseInt(req.params.id, 10);

    if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid ID" });
    }

    try {
        // Check if occupied today before deleting
        const today = new Date().toISOString().split('T')[0];
        const { data: activeBookings } = await supabase
            .from("room_bookings")
            .select("id")
            .eq("room_id", id)
            .lte("check_in", today)
            .gte("check_out", today);

        if (activeBookings && activeBookings.length > 0) {
            return res.status(400).json({ 
                error: "Cannot delete room while it is occupied. Please wait for checkout or release the room first." 
            });
        }

        // 1. Delete associated room bookings (historical ones)
        const { error: rbError } = await supabase
            .from("room_bookings")
            .delete()
            .eq("room_id", id);

        if (rbError) throw rbError;

        // 2. Find and delete associated allocation items and their member links
        const { data: items, error: itemsFetchError } = await supabase
            .from("allocation_items")
            .select("id")
            .eq("room_id", id);

        if (itemsFetchError) throw itemsFetchError;

        if (items && items.length > 0) {
            const itemIds = items.map(i => i.id);
            // Delete member allocations linked to these items
            await supabase
                .from("member_allocations")
                .delete()
                .in("allocation_item_id", itemIds);
            
            // Delete the allocation items
            await supabase
                .from("allocation_items")
                .delete()
                .in("id", itemIds);
        }

        // 3. Finally delete the room from database
        const { error } = await supabase
            .from("rooms")
            .delete()
            .eq("id", id);

        if (error) throw error;

        res.json({
            success: true,
            message: "Room and all associated data deleted successfully from database"
        });

    } catch (error) {
        console.error("DELETE ROOM ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});


export default router;