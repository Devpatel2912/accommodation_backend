import { Client } from 'pg';
import fs from 'fs';

const connectionString = 'postgresql://postgres:@db.woushgaduuivvupthfge.supabase.co:5432/postgres';

const client = new Client({
  connectionString: connectionString,
});

async function run() {
  try {
    await client.connect();
    console.log("Connected to PostgreSQL successfully!");
    
    const sql = fs.readFileSync('supabase_migration.sql', 'utf8');
    await client.query(sql);
    console.log("SQL script executed successfully!");

  } catch (err) {
    console.error("Error:", err.message);
  } finally {
    await client.end();
  }
}

run();
