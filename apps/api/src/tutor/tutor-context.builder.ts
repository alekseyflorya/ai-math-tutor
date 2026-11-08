import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ne, notInArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module';
import { attempts, messages, mistakes } from '../db/schema';
import type { TutorContext } from '../llm/prompts';
import { activeMistake, type Turn } from './turn';

/**
 * Everything the model is told about the situation on a turn: the problem, the verified line,
 * the student's steps, the mistake being fixed, recent dialogue and a short profile of earlier
 * work. Student-authored parts are delimited later, in `contextBlock()`.
 */
@Injectable()
export class TutorContextBuilder {
  constructor(@Inject(DB) private readonly db: Db) {}

  async build(turn: Turn, override: Partial<TutorContext> = {}): Promise<TutorContext> {
    const { attempt } = turn;
    const active = activeMistake(turn);
    const recent = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.attemptId, attempt.id),
          notInArray(messages.kind, ['GREETING', 'FOLLOW_UP']),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(8);
    // Short profile of EARLIER work so explanations can connect to recurring patterns.
    const [pastMistakes, [solved]] = await Promise.all([
      this.db
        .select({
          errorType: mistakes.errorType,
          total: count(),
          verified: sql<number>`count(*) filter (where ${mistakes.verified})`.mapWith(Number),
        })
        .from(mistakes)
        .where(and(eq(mistakes.userId, attempt.userId), ne(mistakes.attemptId, attempt.id)))
        .groupBy(mistakes.errorType)
        .orderBy(desc(count())),
      this.db
        .select({ n: count() })
        .from(attempts)
        .where(
          and(
            eq(attempts.userId, attempt.userId),
            eq(attempts.status, 'SOLVED'),
            ne(attempts.id, attempt.id),
          ),
        ),
    ]);
    return {
      locale: turn.locale,
      problem: attempt.equation,
      currentLine: attempt.currentLine,
      steps: turn.steps.map((s) => ({ input: s.input, isCorrect: s.isCorrect })),
      mode: attempt.mode,
      hintLevel: attempt.hintLevel,
      activeMistake: active
        ? {
            errorType: active.errorType,
            description: active.description,
            stepInput: active.stepInput,
            previousLine: active.previousLine,
          }
        : null,
      recentDialogue: recent.reverse().map((m) => ({
        role: m.role === 'STUDENT' ? 'Student' : 'Tutor',
        content: m.content.slice(0, 400),
      })),
      isFollowUp: Boolean(attempt.targetErrorType),
      history: {
        solvedProblems: solved?.n ?? 0,
        mistakes: pastMistakes.filter((m) => m.errorType !== 'OTHER'),
      },
      ...override,
    };
  }
}
