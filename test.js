import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import bcrypt from "bcrypt";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const testDB = async () => {
  const password = "123456";

  // 🔐 hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  // ✅ include password_hash
  const { data, error } = await supabase
    .from("users")
    .insert([
      {
        name: "Test User",
        email: "test123@gmail.com",
        role: "USER",
        password_hash: hashedPassword   // 🔥 THIS WAS MISSING
      }
    ])
    .select();

  console.log("INSERT:", data, error);
};

testDB();