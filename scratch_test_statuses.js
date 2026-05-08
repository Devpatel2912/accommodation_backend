import { supabase } from './config/supabase.js';

async function testMany() {
  const statuses = ['PENDING', 'ACCEPTED', 'REJECTED', 'CANCELLED', 'APPROVED', 'DELETED', 'ARCHIVED', 'CLOSED', 'COMPLETED', 'WAITING', 'IN_PROGRESS'];
  for (const s of statuses) {
    const { error } = await supabase.from('requests').insert({ status: s, check_in: '2025-01-01', check_out: '2025-01-02', total_people: 1 });
    if (!error) {
      console.log(`✅ ${s} is VALID`);
      // Cleanup
      await supabase.from('requests').delete().eq('status', s).eq('check_in', '2025-01-01');
    } else {
      console.log(`❌ ${s} is INVALID: ${error.message}`);
    }
  }
  process.exit(0);
}

testMany();
