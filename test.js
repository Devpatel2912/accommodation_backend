import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const testDB = async () => {
  const { data, error } = await supabase
    .from("users")
    .insert([
      {
        name: "Test User",
        email: "test_new@gmail.com",
        role: "USER"
      }
    ])
    .select();

  console.log("INSERT:", data, error);
};

testDB();