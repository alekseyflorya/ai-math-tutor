import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, gte } from 'drizzle-orm';
import { ERROR_TYPES, SKILLS, type ErrorType, type ProgressView } from '@tutor/shared';
import { DB, type Db } from '../db/db.module';
import { attempts, mistakes, skillStats, steps } from '../db/schema';

const DAYS = 14;
const DAY_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class ProgressService {
  constructor(@Inject(DB) private readonly db: Db) {}

  async get(userId: string): Promise<ProgressView> {
    const since = new Date(Date.now() - (DAYS - 1) * DAY_MS);
    since.setUTCHours(0, 0, 0, 0);
    const ownAttempts = eq(attempts.userId, userId);

    const [attemptRows, stepRows, userMistakes, skills, recentAttempts] = await Promise.all([
      this.db
        .select({ status: attempts.status, solvedAt: attempts.solvedAt })
        .from(attempts)
        .where(ownAttempts),
      this.db
        .select({ isCorrect: steps.isCorrect, n: count() })
        .from(steps)
        .innerJoin(attempts, eq(steps.attemptId, attempts.id))
        .where(ownAttempts)
        .groupBy(steps.isCorrect),
      this.db.select().from(mistakes).where(eq(mistakes.userId, userId)).orderBy(desc(mistakes.createdAt)),
      this.db.select().from(skillStats).where(eq(skillStats.userId, userId)),
      this.db
        .select({
          id: attempts.id,
          title: attempts.title,
          equation: attempts.equation,
          status: attempts.status,
          parentAttemptId: attempts.parentAttemptId,
          updatedAt: attempts.updatedAt,
        })
        .from(attempts)
        .where(ownAttempts)
        .orderBy(desc(attempts.updatedAt))
        .limit(8),
    ]);
    const recentSteps = await this.db
      .select({ createdAt: steps.createdAt })
      .from(steps)
      .innerJoin(attempts, eq(steps.attemptId, attempts.id))
      .where(and(ownAttempts, gte(steps.createdAt, since)));

    const correctSteps = stepRows.find((r) => r.isCorrect)?.n ?? 0;
    const totalSteps = stepRows.reduce((sum, r) => sum + r.n, 0);

    const byType = new Map<ErrorType, { total: number; corrected: number; verified: number }>();
    for (const m of userMistakes) {
      const row = byType.get(m.errorType) ?? { total: 0, corrected: 0, verified: 0 };
      row.total++;
      if (m.corrected) row.corrected++;
      if (m.verified) row.verified++;
      byType.set(m.errorType, row);
    }

    const activity = new Map<string, { solved: number; steps: number }>();
    for (let i = DAYS - 1; i >= 0; i--) {
      activity.set(new Date(Date.now() - i * DAY_MS).toISOString().slice(0, 10), { solved: 0, steps: 0 });
    }
    for (const a of attemptRows) {
      if (a.solvedAt && a.solvedAt >= since) {
        const row = activity.get(a.solvedAt.toISOString().slice(0, 10));
        if (row) row.solved++;
      }
    }
    for (const s of recentSteps) {
      const row = activity.get(s.createdAt.toISOString().slice(0, 10));
      if (row) row.steps++;
    }

    const skillMap = new Map(skills.map((s) => [s.skill, s]));
    const verified = userMistakes.filter((m) => m.verified).length;

    return {
      totals: {
        attempts: attemptRows.length,
        solved: attemptRows.filter((a) => a.status === 'SOLVED').length,
        steps: totalSteps,
        correctSteps,
        accuracy: totalSteps ? Math.round((correctSteps / totalSteps) * 100) : 0,
        mistakes: userMistakes.length,
        correctedMistakes: userMistakes.filter((m) => m.corrected).length,
        verifiedMistakes: verified,
        followUpsPassed: verified,
      },
      mistakesByType: ERROR_TYPES.filter((t) => byType.has(t)).map((errorType) => ({ errorType, ...byType.get(errorType)! })),
      skills: SKILLS.map((skill) => ({
        skill,
        mastery: Math.round((skillMap.get(skill)?.mastery ?? 0) * 100) / 100,
        attempts: skillMap.get(skill)?.attempts ?? 0,
      })),
      recentMistakes: userMistakes.slice(0, 8).map((m) => ({
        id: m.id,
        errorType: m.errorType,
        description: m.description,
        stepInput: m.stepInput,
        corrected: m.corrected,
        verified: m.verified,
        createdAt: m.createdAt.toISOString(),
      })),
      recentAttempts: recentAttempts.map((a) => ({
        id: a.id,
        title: a.title,
        equation: a.equation,
        status: a.status,
        isFollowUp: Boolean(a.parentAttemptId),
        updatedAt: a.updatedAt.toISOString(),
      })),
      activity: [...activity.entries()].map(([date, v]) => ({ date, ...v })),
    };
  }
}
