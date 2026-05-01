import { supabase } from "../config/supabase.js";

async function seedRooms() {
  console.log("Seeding rooms...");
  
  const rooms = [
    { room_number: "301", capacity: 4, is_active: true },
    { room_number: "302", capacity: 4, is_active: true },
    { room_number: "303", capacity: 2, is_active: true },
    { room_number: "304", capacity: 3, is_active: true },
    { room_number: "401", capacity: 6, is_active: true },
    { room_number: "402", capacity: 4, is_active: true },
  ];

  for (const room of rooms) {
    const { data: existing } = await supabase
      .from("rooms")
      .select("id")
      .eq("room_number", room.room_number)
      .single();

    if (!existing) {
      const { error } = await supabase.from("rooms").insert([room]);
      if (error) console.error(`Error inserting room ${room.room_number}:`, error.message);
      else console.log(`Inserted room ${room.room_number}`);
    } else {
      console.log(`Room ${room.room_number} already exists`);
    }
  }
  
  console.log("Seeding completed!");
  process.exit(0);
}

seedRooms();
