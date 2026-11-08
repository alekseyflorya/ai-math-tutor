/** Applies SQL migrations without starting the API (the API also applies them on boot). */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  await migrate(drizzle(pool), { migrationsFolder: join(__dirname, '..', 'drizzle') });
  await pool.end();
  console.log('Migrations applied');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
