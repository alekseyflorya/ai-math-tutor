import { randomUUID } from 'node:crypto';
import { ConflictException, Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { AppConfig } from '../config/config.service';
import { DB, type Db } from '../db/db.module';
import { attempts } from '../db/schema';

const UUID = /^[0-9a-f-]{36}$/i;
const LEASE_MARGIN_MS = 15_000;

/**
 * Rejects overlapping turns on one attempt (double clicks, two tabs, two API instances) with
 * 409 BUSY. The lock is a lease in the attempts row: taken with one conditional UPDATE, held for
 * at most the lease (so a crashed instance cannot block an attempt for long), and released only
 * by the holder's token. No transaction or pool connection is held while the model thinks.
 */
@Injectable()
export class AttemptLock {
  private readonly logger = new Logger(AttemptLock.name);
  private readonly leaseMs: number;

  constructor(
    @Inject(DB) private readonly db: Db,
    config: AppConfig,
  ) {
    this.leaseMs =
      config.get('TURN_LOCK_LEASE_MS') ?? config.get('LLM_TURN_BUDGET_MS') + LEASE_MARGIN_MS;
  }

  /** Only the attempt's owner can take its lease: anyone else's request just gets its 404. */
  async run<T>(userId: string, attemptId: string, fn: () => Promise<T>): Promise<T> {
    const lease = await this.acquire(userId, attemptId);
    if (lease === 'busy') {
      throw new ConflictException({
        code: 'BUSY',
        message: 'The tutor is still answering your previous message',
      });
    }
    // No such attempt for this user: nothing to lock, and `fn` answers 404 as usual.
    if (lease === 'missing') return fn();
    try {
      return await fn();
    } finally {
      await this.release(attemptId, lease.token).catch((e: unknown) =>
        this.logger.error(`Failed to release the lock on ${attemptId}: ${String(e)}`),
      );
    }
  }

  /** Takes the lease on the user's attempt if it is free or expired. */
  async acquire(
    userId: string,
    attemptId: string,
  ): Promise<{ token: string } | 'busy' | 'missing'> {
    if (!UUID.test(attemptId)) return 'missing';
    const token = randomUUID();
    const taken = await this.db
      .update(attempts)
      .set({
        busyUntil: sql`now() + ${this.leaseMs} * interval '1 millisecond'`,
        busyToken: token,
      })
      .where(
        and(
          eq(attempts.id, attemptId),
          eq(attempts.userId, userId),
          or(isNull(attempts.busyUntil), lt(attempts.busyUntil, sql`now()`)),
        ),
      )
      .returning({ id: attempts.id });
    if (taken.length) return { token };
    const [exists] = await this.db
      .select({ id: attempts.id })
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)));
    return exists ? 'busy' : 'missing';
  }

  /** Frees the lease, unless it expired and someone else holds it now. */
  async release(attemptId: string, token: string): Promise<void> {
    await this.db
      .update(attempts)
      .set({ busyUntil: null, busyToken: null })
      .where(and(eq(attempts.id, attemptId), eq(attempts.busyToken, token)));
  }
}
