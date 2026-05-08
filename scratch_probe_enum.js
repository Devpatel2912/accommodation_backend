import { supabase } from './config/supabase.js';

async function findEnumValues() {
  const { error } = await supabase
    .from('requests')
    .insert({ status: 'BOGUS_STATUS', check_in: '2025-01-01', check_out: '2025-01-02', total_people: 1 });
  
  console.log(error);
  process.exit(0);
}

findEnumValues();
