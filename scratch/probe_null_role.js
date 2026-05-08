import { supabase } from "../config/supabase.js";

async function probeNullRole() {
  const { error } = await supabase
    .from("users")
    .update({ role: null })
    .eq("id", 1);
  
  if (error) {
    console.log("NULL ROLE ERROR:", error.message);
  } else {
    console.log("NULL ROLE SUCCESS");
  }
  process.exit(0);
}

probeNullRole();
