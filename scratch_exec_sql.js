import { supabase } from './config/supabase.js';

async function trySQL() {
  const { data, error } = await supabase.rpc('exec_sql', { sql: "ALTER TYPE request_status ADD VALUE 'DELETED';" });
  console.log('Result:', data);
  console.log('Error:', error);
  process.exit(0);
}

trySQL();
