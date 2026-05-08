import { supabase } from "../config/supabase.js";

async function probeEnum() {
  const { error } = await supabase
    .from("users")
    .update({ role: "BOGUS_ROLE" })
    .eq("id", 1); // Dummy ID
  
  console.log("PROBE ERROR:", error.message);
  process.exit(0);
}

probeEnum();
