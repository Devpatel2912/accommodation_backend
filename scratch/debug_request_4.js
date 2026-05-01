import { supabase } from "../config/supabase.js";
import dotenv from "dotenv";
dotenv.config();

async function checkDetails() {
  const requestId = 4;
  console.log("--- Request 4 ---");
  const { data: req, error: err } = await supabase.from("requests").select("*").eq("id", requestId).single();
  console.log(req || err);

  console.log("--- Members of Request 4 ---");
  const { data: members } = await supabase.from("request_members").select("*").eq("request_id", requestId);
  console.table(members);

  console.log("--- Allocations for Request 4 ---");
  const { data: allocs } = await supabase.from("allocations").select("*, allocation_items(*)").eq("request_id", requestId);
  console.log(JSON.stringify(allocs, null, 2));
}

checkDetails();
