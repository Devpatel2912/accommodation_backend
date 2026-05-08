
import { supabase } from './config/supabase.js';

async function checkHouses() {
  const { data: houses, error: houseError } = await supabase.from('houses').select('*');
  console.log('HOUSES COUNT:', houses?.length);
  console.log('HOUSES:', JSON.stringify(houses, null, 2));
  
  const { data: bookings, error: bookingError } = await supabase.from('house_bookings').select('*');
  console.log('HOUSE BOOKINGS COUNT:', bookings?.length);
  console.log('HOUSE BOOKINGS:', JSON.stringify(bookings, null, 2));
}

checkHouses();
