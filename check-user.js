import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
dotenv.config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

async function checkUser() {
  const email = "dev29123@gmail.com";
  console.log(`Checking user: ${email}`);
  
  const { data, error } = await supabase
    .from("users")
    .select("*")
    .eq("email", email);

  if (error) {
    console.error("❌ Supabase error:", error);
  } else {
    console.log("✅ User data:", data);
  }
}

checkUser();
