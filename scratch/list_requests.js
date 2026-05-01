import { supabase } from "../config/supabase.js";
import dotenv from "dotenv";
dotenv.config();

async function check() {
  const { data, error } = await supabase.from("requests").select("id, status");
  if (error) {
    console.error("Error:", error.message);
  } else {
    console.log("Current Requests in DB:");
    console.table(data);
  }
}

check();
