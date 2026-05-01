import { supabase } from "../config/supabase.js";
import dotenv from "dotenv";
dotenv.config();

async function testQuery() {
  const requestId = 4;
  const { data: request, error: reqError } = await supabase
    .from("requests")
    .select(`
      *,
      allocations (
        allocation_items (
          room_id,
          house_id,
          rooms (room_number),
          houses (name),
          member_allocations (*)
        )
      )
    `)
    .eq("id", requestId)
    .single();

  if (reqError) {
    console.error("Error Message:", reqError.message);
    console.error("Error Detail:", reqError.details);
    console.error("Error Hint:", reqError.hint);
    console.error("Error Code:", reqError.code);
  } else {
    console.log("Request found:", JSON.stringify(request, null, 2));
  }
}

testQuery();
