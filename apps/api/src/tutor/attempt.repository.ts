import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import type {
  AttemptSummary,
  AttemptView,
  ErrorType,
  ListAttemptsQuery,
  Locale,
  MessageKind,
  MessageMeta,
  MessageRole,
  Skill,
} from '@tutor/shared';
import { DB, type Executor } from '../db/db.module';
import {
  attempts,
  messages,
  mistakes,
  problems,
  steps,
  users,
  type Attempt,
  type Mistake,
  type Step,
} from '../db/schema';
import { toAttemptView } from './attempt.mapper';

export type AttemptPatch = Partial<typeof attempts.$inferInsert>;
export type NewAttempt = typeof attempts.$inferInsert;
export type NewStep = typeof steps.$inferInsert;
export type NewMistake = typeof mistakes.$inferInsert;

/**
 * Every query the tutor makes. The state machine (TutorService) decides; this reads and writes.
 * `in(tx)` gives the same repository on a transaction.
 */
@Injectable()
export class AttemptRepository {
  constructor(@Inject(DB) private readonly db: Executor) {}

  /** The same queries, run on a transaction. */
  in(tx: Executor): AttemptRepository {
    return new AttemptRepository(tx);
  }

  /** Runs `fn` in a transaction, with this repository bound to it. */
  transaction<T>(fn: (repo: AttemptRepository, tx: Executor) => Promise<T>): Promise<T> {
    return this.db.transaction((tx) => fn(this.in(tx), tx));
  }

  // --- Reads -------------------------------------------------------------------

  async findOwned(userId: string, attemptId: string): Promise<Attempt | null> {
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) return null;
    const [attempt] = await this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)));
    return attempt ?? null;
  }

  /** What a turn needs besides the attempt itself. */
  async loadTurnData(attempt: Attempt): Promise<{
    steps: Step[];
    mistakes: Mistake[];
    problemSkills: Skill[];
    locale: Locale;
  }> {
    const [stepRows, mistakeRows, problem, locale] = await Promise.all([
      this.db.select().from(steps).where(eq(steps.attemptId, attempt.id)).orderBy(asc(steps.index)),
      this.db
        .select()
        .from(mistakes)
        .where(eq(mistakes.attemptId, attempt.id))
        .orderBy(asc(mistakes.createdAt)),
      attempt.problemId
        ? this.db
            .select({ skills: problems.skills })
            .from(problems)
            .where(eq(problems.id, attempt.problemId))
            .then((r) => r[0])
        : Promise.resolve(undefined),
      this.localeOf(attempt.userId),
    ]);
    return {
      steps: stepRows,
      mistakes: mistakeRows,
      problemSkills: (problem?.skills ?? []) as Skill[],
      locale,
    };
  }

  async view(attempt: Attempt): Promise<AttemptView> {
    const [stepRows, messageRows, [next]] = await Promise.all([
      this.db.select().from(steps).where(eq(steps.attemptId, attempt.id)).orderBy(asc(steps.index)),
      this.db
        .select()
        .from(messages)
        .where(eq(messages.attemptId, attempt.id))
        .orderBy(asc(messages.seq)),
      this.db
        .select({
          id: attempts.id,
          status: attempts.status,
          sourceMistakeId: attempts.sourceMistakeId,
        })
        .from(attempts)
        .where(eq(attempts.parentAttemptId, attempt.id))
        .orderBy(desc(attempts.createdAt))
        .limit(1),
    ]);
    // The same mistake row links the original attempt and its practice problem.
    const mistakeId = attempt.sourceMistakeId ?? next?.sourceMistakeId ?? null;
    const [mistake] = mistakeId
      ? await this.db
          .select({ verified: mistakes.verified })
          .from(mistakes)
          .where(eq(mistakes.id, mistakeId))
      : [];
    return toAttemptView(
      attempt,
      stepRows,
      messageRows,
      next ? { id: next.id, status: next.status } : null,
      Boolean(mistake?.verified),
    );
  }

  /** kind = 'custom': only the student's own equations (no curriculum problems, no practice problems). */
  async listRecent(userId: string, kind?: ListAttemptsQuery['kind']): Promise<AttemptSummary[]> {
    const rows = await this.db
      .select({
        id: attempts.id,
        title: attempts.title,
        equation: attempts.equation,
        status: attempts.status,
        parentAttemptId: attempts.parentAttemptId,
        updatedAt: attempts.updatedAt,
      })
      .from(attempts)
      .where(
        kind === 'custom'
          ? and(
              eq(attempts.userId, userId),
              isNull(attempts.problemId),
              isNull(attempts.parentAttemptId),
            )
          : eq(attempts.userId, userId),
      )
      .orderBy(desc(attempts.updatedAt))
      .limit(20);
    return rows.map(({ parentAttemptId, updatedAt, ...r }) => ({
      ...r,
      isFollowUp: Boolean(parentAttemptId),
      updatedAt: updatedAt.toISOString(),
    }));
  }

  /** The newest attempt on a curriculum problem with this status, if any. */
  async latestForProblem(
    userId: string,
    problemId: string,
    status: 'IN_PROGRESS' | 'SOLVED',
  ): Promise<string | null> {
    const [row] = await this.db
      .select({ id: attempts.id })
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, userId),
          eq(attempts.problemId, problemId),
          eq(attempts.status, status),
        ),
      )
      .orderBy(desc(status === 'SOLVED' ? attempts.solvedAt : attempts.updatedAt))
      .limit(1);
    return row?.id ?? null;
  }

  /** Open attempts on the student's own equations, newest first. */
  async openCustom(userId: string): Promise<{ id: string; equation: string }[]> {
    return this.db
      .select({ id: attempts.id, equation: attempts.equation })
      .from(attempts)
      .where(
        and(
          eq(attempts.userId, userId),
          isNull(attempts.problemId),
          isNull(attempts.parentAttemptId),
          eq(attempts.status, 'IN_PROGRESS'),
        ),
      )
      .orderBy(desc(attempts.updatedAt))
      .limit(20);
  }

  /** Equations of earlier practice problems for this error type (not to be repeated). */
  async followUpEquations(userId: string, errorType: ErrorType): Promise<string[]> {
    const rows = await this.db
      .select({ equation: attempts.equation })
      .from(attempts)
      .where(and(eq(attempts.userId, userId), eq(attempts.targetErrorType, errorType)))
      .limit(10);
    return rows.map((r) => r.equation);
  }

  /** How many practice problems deep this attempt is. */
  async followUpDepth(attempt: Attempt): Promise<number> {
    let depth = 0;
    let parentId = attempt.parentAttemptId;
    while (parentId && depth < 10) {
      depth++;
      const [parent] = await this.db
        .select({ parentAttemptId: attempts.parentAttemptId })
        .from(attempts)
        .where(eq(attempts.id, parentId));
      parentId = parent?.parentAttemptId ?? null;
    }
    return depth;
  }

  async localeOf(userId: string): Promise<Locale> {
    const [u] = await this.db
      .select({ locale: users.locale })
      .from(users)
      .where(eq(users.id, userId));
    return u?.locale === 'uk' ? 'uk' : 'en';
  }

  // --- Writes ------------------------------------------------------------------

  /**
   * Inserts an attempt unless the student already has an open one on that curriculum problem
   * (partial unique index): then nothing is written and null comes back. A concurrent insert
   * waits for the other transaction, so a double click cannot create two attempts.
   */
  async insertUnlessOpen(values: NewAttempt): Promise<Attempt | null> {
    const [row] = await this.db
      .insert(attempts)
      .values(values)
      .onConflictDoNothing({
        target: [attempts.userId, attempts.problemId],
        where: sql`${attempts.status} = 'IN_PROGRESS'`,
      })
      .returning();
    return row ?? null;
  }

  async insert(values: NewAttempt): Promise<Attempt> {
    const [row] = await this.db.insert(attempts).values(values).returning();
    return row!;
  }

  async update(attemptId: string, patch: AttemptPatch): Promise<Attempt> {
    const [row] = await this.db
      .update(attempts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(attempts.id, attemptId))
      .returning();
    return row!;
  }

  async say<K extends MessageKind>(
    attemptId: string,
    role: MessageRole,
    kind: K,
    content: string,
    meta: MessageMeta<K> | null = null,
  ): Promise<void> {
    await this.db
      .insert(messages)
      .values({ attemptId, role, kind, content, meta: meta as Record<string, unknown> | null });
  }

  async insertStep(values: NewStep): Promise<Step> {
    const [row] = await this.db.insert(steps).values(values).returning();
    return row!;
  }

  async insertMistake(values: NewMistake): Promise<Mistake> {
    const [row] = await this.db.insert(mistakes).values(values).returning();
    return row!;
  }

  async markCorrected(mistakeId: string, hintsUsed: number): Promise<void> {
    await this.db
      .update(mistakes)
      .set({ corrected: true, correctedAt: new Date(), hintsUsed })
      .where(eq(mistakes.id, mistakeId));
  }

  async markVerified(mistakeId: string, userId: string): Promise<void> {
    await this.db
      .update(mistakes)
      .set({ verified: true, verifiedAt: new Date() })
      .where(and(eq(mistakes.id, mistakeId), eq(mistakes.userId, userId)));
  }
}
