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
// 🔐 ADMIN CHECK
// =========================
const authorizeAdmin = (req, res, next) => {
    if (req.user?.role === "ADMIN") return next();
    return res.status(403).json({ error: "Admin only" });
};



// =========================
// ➕ CREATE HOUSE
// =========================
router.post("/", authenticateToken, authorizeAdmin, async (req, res) => {
    const {
        owner_name,
        contact_number,
        address,
        latitude,
        longitude,
        capacity,
        image_url,
        is_active
    } = req.body;

    const { data, error } = await supabase
        .from("houses")
        .insert([{
            owner_name,
            contact_number,
            address,
            latitude,
            longitude,
            capacity,
            image_url,
            is_active: is_active ?? true
        }])
        .select()
        .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, house: data });
});



// =========================
// 📄 GET ALL HOUSES
// =========================
router.get("/", authenticateToken, authorizeAdmin, async (req, res) => {
    const { check_in, check_out } = req.query;

    // 1. Default to today if no dates provided
    const today = new Date().toISOString().split('T')[0];
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0];
    
    const queryCheckIn = check_in || today;
    const queryCheckOut = check_out || tomorrow;

    try {
        // 1. Fetch all houses
        let { data: houses, error: housesError } = await supabase
            .from("houses")
            .select("*")
            .order("id", { ascending: true });

        if (housesError) throw housesError;

        // 2. Calculate occupancy for the selected (or default) dates.
        // Each overlapping house booking row occupies one capacity slot.
        const { data: activeBookings, error: bookingsError } = await supabase
            .from("house_bookings")
            .select("house_id")
            .lte("check_in", queryCheckOut)
            .gte("check_out", queryCheckIn);

        if (bookingsError) throw bookingsError;

        const occupancyMap = {};
        activeBookings?.forEach(booking => {
            occupancyMap[booking.house_id] = (occupancyMap[booking.house_id] || 0) + 1;
        });

        // 3. Map occupancy data to houses
        houses = houses.map(house => {
            const currentOccupancy = occupancyMap[house.id] || 0;
            const remaining = (house.capacity || 0) - currentOccupancy;
            return {
                ...house,
                booked_count: currentOccupancy,
                current_occupancy: currentOccupancy,
                remaining_capacity: Math.max(0, remaining)
            };
        });

        res.json({
            success: true,
            houses: houses
        });

    } catch (error) {
        console.error("GET HOUSES ERROR:", error);
        res.status(500).json({ error: error.message });
    }
});



// =========================
// 🔍 GET SINGLE HOUSE
// =========================
router.get("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from("houses")
        .select("*")
        .eq("id", id)
        .single();

    if (error || !data) {
        return res.status(404).json({ error: "House not found" });
    }

    res.json({ success: true, house: data });
});



// =========================
// ✏️ UPDATE HOUSE
// =========================
router.put("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from("houses")
        .update(req.body)
        .eq("id", id)
        .select()
        .single();

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, house: data });
});



// =========================
// ❌ DELETE HOUSE (HARD DELETE)
// =========================
router.delete("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;

    const { error } = await supabase
        .from("houses")
        .delete()
        .eq("id", id);

    if (error) return res.status(400).json({ error: error.message });

    res.json({
        success: true,
        message: "House deleted from database"
    });
});


export default router;
