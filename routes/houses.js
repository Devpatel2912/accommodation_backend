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
    const { data, error } = await supabase
        .from("houses")
        .select("*")
        .order("id", { ascending: true });

    if (error) return res.status(400).json({ error: error.message });

    res.json({ success: true, houses: data });
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
// ❌ DELETE HOUSE (SOFT DELETE)
// =========================
router.delete("/:id", authenticateToken, authorizeAdmin, async (req, res) => {
    const { id } = req.params;

    const { data, error } = await supabase
        .from("houses")
        .update({ is_active: false })
        .eq("id", id)
        .select()
        .single();

    if (error || !data) {
        return res.status(404).json({ error: "House not found" });
    }

    res.json({
        success: true,
        message: "House deactivated",
        house: data
    });
});


export default router;