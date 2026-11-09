import { Inject, Injectable } from '@nestjs/common';
import { parseEquation, solve } from '@tutor/shared';
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
/** Messages of recent dialogue the model sees. */
const RECENT = 8;

@Injectable()
export class TutorContextBuilder {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * `pendingStudentMessage`: what the student sent this turn. A turn writes only after the model
   * has answered, so the message is not in the database yet; it is added to the dialogue exactly
   * where the stored message would appear.
   */
  async build(
    turn: Turn,
    override: Partial<TutorContext> = {},
    pendingStudentMessage?: string,
  ): Promise<TutorContext> {
    const { attempt } = turn;
    const active = activeMistake(turn);
    const stored = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(
        and(
          eq(messages.attemptId, attempt.id),
          notInArray(messages.kind, ['GREETING', 'FOLLOW_UP']),
        ),
      )
      .orderBy(desc(messages.seq))
      .limit(pendingStudentMessage === undefined ? RECENT : RECENT - 1);
    const recent =
      pendingStudentMessage === undefined
        ? stored
        : [{ role: 'STUDENT' as const, content: pendingStudentMessage }, ...stored];
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
      steps: turn.steps.map((s) => ({ input: s.input, isCorrect: s.isCorrect, phase: s.phase })),
      checking: attempt.mode === 'CHECKING' ? { solution: solutionText(attempt) } : null,
      mode: attempt.mode,
      hintLevel: attempt.hintLevel,
      activeMistake: active
        ? {
            errorType: active.errorType,
            description: active.description,
            stepInput: active.stepInput,
            previousLine: active.previousLine,
            phase: active.phase,
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

/** "x = 7": only used once the student has reached it (CHECKING). */
function solutionText(attempt: Turn['attempt']): string {
  const s = solve(parseEquation(attempt.equation));
  return s.kind === 'unique' ? `${attempt.variable} = ${s.value.toString()}` : '';
}
