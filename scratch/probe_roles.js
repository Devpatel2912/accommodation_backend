import { supabase } from "../config/supabase.js";

async function probeRoles() {
  const roles = ["USER", "ADMIN", "DELETED", "INACTIVE", "DISABLED"];
  for (const role of roles) {
    const { error } = await supabase
      .from("users")
      .insert([{ name: "Probe", email: `probe_${role}@test.com`, role }]);
    
    if (error) {
      console.log(`Role ${role}: ERROR ${error.message}`);
    } else {
      console.log(`Role ${role}: SUCCESS`);
      // Cleanup
      await supabase.from("users").delete().eq("email", `probe_${role}@test.com`);
    }
  }
  process.exit(0);
}

probeRoles();
