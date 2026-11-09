import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { and, eq, lt, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module';
import { users } from '../db/schema';

/** Demo accounts live this long; everything they own goes with them (FK cascades). */
export const DEMO_TTL_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class DemoCleanupService {
  private readonly logger = new Logger(DemoCleanupService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Never throws: a rejected promise from a cron job can become an unhandled rejection, which
   * ends the Node process. A database hiccup at 03:00 must not take the API down; the next run
   * catches up.
   */
  @Cron('0 3 * * *', { name: 'demo-cleanup', timeZone: 'UTC' })
  async daily(): Promise<void> {
    try {
      const deleted = await this.deleteExpired();
      if (deleted)
        this.logger.log(`Deleted ${deleted} demo accounts older than ${DEMO_TTL_DAYS} days`);
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      this.logger.error(`Demo cleanup failed: ${err.message}`, err.stack);
    }
  }

  /**
   * Deletes demo users created more than DEMO_TTL_DAYS ago. With several API instances the job
   * fires on each of them; a transaction-scoped advisory lock lets only one do the work.
   */
  async deleteExpired(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - DEMO_TTL_DAYS * DAY_MS);
    return this.db.transaction(async (tx) => {
      const lock = await tx.execute<{ locked: boolean }>(
        sql`SELECT pg_try_advisory_xact_lock(hashtext('ai-math-tutor:demo-cleanup')) AS locked`,
      );
      if (!lock.rows[0]?.locked) return 0;
      const deleted = await tx
        .delete(users)
        .where(and(eq(users.isDemo, true), lt(users.createdAt, cutoff)))
        .returning({ id: users.id });
      return deleted.length;
    });
  }
}
