import { supabase } from "../config/supabase.js";

async function testQuery() {
  const { data, error } = await supabase
    .from("users")
    .select("*");
  
  if (error) {
    console.log("QUERY ERROR:", error.message);
    console.log("ERROR CODE:", error.code);
  } else {
    console.log("QUERY SUCCESS, count:", data.length);
  }
  process.exit(0);
}

testQuery();
