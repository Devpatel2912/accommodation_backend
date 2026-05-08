import { supabase } from "../config/supabase.js";

async function probeRequestStatus() {
  const { error } = await supabase
    .from("requests")
    .select("*")
    .neq("status", "DELETED")
    .limit(1);
  
  if (error) {
    console.log("REQUEST STATUS QUERY ERROR:", error.message);
  } else {
    console.log("REQUEST STATUS QUERY SUCCESS");
  }
  process.exit(0);
}

probeRequestStatus();
