import { supabase } from "../config/supabase.js";

async function checkSchema() {
    const { data, error } = await supabase
        .from("rooms")
        .select("house_id")
        .limit(1);
    
    if (error) {
        console.log("house_id NOT found in rooms table:", error.message);
    } else {
        console.log("house_id FOUND in rooms table");
    }
}

checkSchema();
