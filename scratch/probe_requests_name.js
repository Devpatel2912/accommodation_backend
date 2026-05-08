import { supabase } from '../config/supabase.js';
import dotenv from 'dotenv';
dotenv.config();

async function probe() {
  const { data, error } = await supabase
    .from('requests')
    .select('id, request_name, status, notes, request_members(*)')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) {
    console.error(error);
    return;
  }

  console.log(JSON.stringify(data, null, 2));
}

probe();
