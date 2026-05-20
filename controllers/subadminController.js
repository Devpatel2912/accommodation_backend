import { supabase } from "../config/supabase.js";

// ─── GET SUBADMIN REQUESTS ──────────────────────────────────────────
// Returns requests that have been approved and forwarded to the SubAdmin's authority type
// Status format: "APPROVED (AVD)" or "APPROVED (ANAND)"
export const getSubAdminRequests = async (req, res) => {
  try {
    // Determine SubAdmin type from query param or from token
    let subAdminType = req.query.type?.toUpperCase();
    
    // If not provided in query, use the user's sub_admin_type
    if (!subAdminType && req.user?.sub_admin_type) {
      subAdminType = req.user.sub_admin_type.toUpperCase();
    }

    if (!subAdminType) {
      return res.status(400).json({ error: "SubAdmin type not specified" });
    }

    // Build the exact status value: "APPROVED (AVD)" or "APPROVED (ANAND)"
    const targetStatus = `APPROVED (${subAdminType})`;
    console.log(`🔍 SubAdmin query: type=${subAdminType}, targetStatus="${targetStatus}"`);

    // Use textSearch with cast since status may be an enum type
    // .filter("status::text", "ilike", pattern) casts enum to text for pattern matching
    const { data, error } = await supabase
      .from("requests")
      .select(`
        *,
        request_members (*),
        house_bookings (
          *,
          houses (*)
        ),
        allocations (
          *,
          allocation_items (
            *,
            member_allocations (*),
            rooms (*),
            houses (*)
          )
        )
      `)
      .filter("status::text", "eq", targetStatus)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("❌ SubAdmin requests error:", error);
      // Fallback: fetch all and filter in JS
      console.log("⚠️ Trying fallback: fetch all then filter in JS...");
      const { data: allData, error: allError } = await supabase
        .from("requests")
        .select(`
          *,
          request_members (*),
          house_bookings (
            *,
            houses (*)
          ),
          allocations (
            *,
            allocation_items (
              *,
              member_allocations (*),
              rooms (*),
              houses (*)
            )
          )
        `)
        .order("created_at", { ascending: false });

      if (allError) {
        return res.status(500).json({ error: "Failed to fetch requests" });
      }

      const filtered = (allData || []).filter(r => {
        const status = String(r.status || "").trim().toUpperCase();
        return status === targetStatus.toUpperCase();
      });

      console.log(`✅ Fallback: Found ${filtered.length} matching requests out of ${(allData || []).length} total`);
      // Log all unique statuses for debugging
      const statuses = [...new Set((allData || []).map(r => r.status))];
      console.log(`📊 All unique statuses in DB: ${JSON.stringify(statuses)}`);

      return res.json({ success: true, requests: filtered });
    }

    console.log(`✅ Found ${(data || []).length} requests for SubAdmin ${subAdminType}`);
    res.json({ success: true, requests: data || [] });
  } catch (err) {
    console.error("❌ SubAdmin requests error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
};

