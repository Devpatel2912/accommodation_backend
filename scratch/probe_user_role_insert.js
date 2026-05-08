import { supabase } from "../config/supabase.js";

async function probeEnum() {
  const { error } = await supabase
    .from("users")
    .insert([{ name: "Probe", email: "probe@test.com", role: "BOGUS_ROLE" }]);
  
  if (error) {
    console.log("PROBE ERROR:", error.message);
  } else {
    console.log("INSERT SUCCESS (unexpected)");
  }
  process.exit(0);
}

probeEnum();
