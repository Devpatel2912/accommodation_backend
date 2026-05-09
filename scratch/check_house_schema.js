import { supabase } from "../config/supabase.js";

async function checkColumns() {
  try {
    const tables = ['houses', 'rooms', 'allocation_items', 'house_bookings'];
    for (const table of tables) {
      const { data, error } = await supabase.from(table).select('*').limit(1);
      if (error) {
        console.error(`Error fetching ${table}:`, error.message);
        continue;
      }
      if (data && data.length > 0) {
        console.log(`Columns in ${table}:`, Object.keys(data[0]));
      } else {
        console.log(`No data in ${table} to check columns.`);
      }
    }
  } catch (err) {
    console.error(err);
  }
}

checkColumns();
