import { supabase } from './config/supabase.js';

async function check() {
  const { data, error } = await supabase.from('requests').select('status').limit(20);
  if (error) {
    console.error(error);
    return;
  }
  console.log(data);
  process.exit(0);
}

check();
