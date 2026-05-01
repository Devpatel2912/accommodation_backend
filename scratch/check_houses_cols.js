import { supabase } from "../config/supabase.js";
import dotenv from "dotenv";
dotenv.config();

async function checkHousesSchema() {
  const { data, error } = await supabase
    .from("houses")
    .select("*")
    .limit(1);

  if (error) {
    console.error("Error fetching house:", error.message);
  } else if (data && data.length > 0) {
    console.log("House columns:", Object.keys(data[0]));
  } else {
    console.log("No houses found to check schema.");
  }
}

checkHousesSchema();
