import { Global, Inject, Injectable, Logger, Module, OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase, type NodePgQueryResultHKT } from 'drizzle-orm/node-postgres';
import type { PgDatabase } from 'drizzle-orm/pg-core';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { join } from 'node:path';
import { Pool } from 'pg';
import { AppConfig } from '../config/config.service';
import * as schema from './schema';

export type Db = NodePgDatabase<typeof schema>;
/** The database or a transaction on it: what repositories run their queries on. */
export type Executor = PgDatabase<NodePgQueryResultHKT, typeof schema>;
export const DB = Symbol('DB');
export const MIGRATIONS_DIR = join(__dirname, '..', '..', 'drizzle');
const MIGRATION_LOCK = 'ai-math-tutor:migrations';

@Injectable()
class PoolCloser implements OnModuleDestroy {
  constructor(@Inject(Pool) private readonly pool: Pool) {}
  async onModuleDestroy() {
    await this.pool.end();
  }
}

@Global()
@Module({
  providers: [
    {
      provide: Pool,
      inject: [AppConfig],
      // A 1–2 GB VPS: a small pool is plenty and keeps Postgres memory low.
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.get('DATABASE_URL'), max: 10 }),
    },
    {
      provide: DB,
      inject: [Pool],
      useFactory: async (pool: Pool): Promise<Db> => {
        const db = drizzle(pool, { schema });
        // Migrations are plain SQL files in apps/api/drizzle, applied on boot. Several instances
        // may boot at once: a session advisory lock lets one apply them while the others wait.
        const client = await pool.connect();
        try {
          await client.query('SELECT pg_advisory_lock(hashtext($1))', [MIGRATION_LOCK]);
          await migrate(db, { migrationsFolder: MIGRATIONS_DIR });
        } finally {
          await client.query('SELECT pg_advisory_unlock(hashtext($1))', [MIGRATION_LOCK]);
          client.release();
        }
        new Logger('Db').log('Migrations applied');
        return db;
      },
    },
    PoolCloser,
  ],
  exports: [DB],
})
export class DbModule {}
