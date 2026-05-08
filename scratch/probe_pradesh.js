import { supabase } from "../config/supabase.js";

async function probe() {
  const { data: tableData, error: tableError } = await supabase
    .from("pradesh")
    .select("name");

  console.log("TABLE DATA:", tableData);
  console.log("TABLE ERROR:", tableError);

  const { data: userData } = await supabase.from("users").select("pradesh");
  const { data: memberData } = await supabase.from("request_members").select("pradesh");

  const set = new Set();
  if (userData) userData.forEach(u => u.pradesh && set.add(u.pradesh));
  if (memberData) memberData.forEach(m => m.pradesh && set.add(m.pradesh));

  console.log("FALLBACK SET:", Array.from(set));
}

probe();
