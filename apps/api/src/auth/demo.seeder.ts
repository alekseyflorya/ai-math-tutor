import { Inject, Injectable } from '@nestjs/common';
import { parseEquation, type ErrorType } from '@tutor/shared';
import { DB, type Db } from '../db/db.module';
import { attempts, mistakes, skillStats, steps } from '../db/schema';

const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 60 * 60 * 1000);

/**
 * Pre-fills a demo account with a short, realistic history (two solved problems,
 * one sign mistake that was corrected and then verified on a follow-up), so a
 * reviewer immediately sees what progress tracking looks like. The featured
 * test-scenario problem is left untouched.
 */
@Injectable()
export class DemoSeeder {
  constructor(@Inject(DB) private readonly db: Db) {}

  async seedHistory(userId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const solved = async (opts: {
        problemId?: string;
        title: string;
        equation: string;
        lines: { input: string; ok?: boolean }[];
        when: Date;
        parentAttemptId?: string;
        targetErrorType?: ErrorType;
        sourceMistakeId?: string;
      }) => {
        const [a] = await tx
          .insert(attempts)
          .values({
            userId,
            problemId: opts.problemId ?? null,
            title: opts.title,
            equation: opts.equation,
            currentLine: opts.lines.at(-1)!.input,
            status: 'SOLVED',
            solvedAt: opts.when,
            createdAt: opts.when,
            updatedAt: opts.when,
            parentAttemptId: opts.parentAttemptId ?? null,
            targetErrorType: opts.targetErrorType ?? null,
            sourceMistakeId: opts.sourceMistakeId ?? null,
          })
          .returning();
        await tx.insert(steps).values(
          opts.lines.map((l, index) => ({
            attemptId: a!.id,
            index,
            input: l.input,
            latex: parseEquation(l.input).latex,
            isCorrect: l.ok ?? true,
            createdAt: opts.when,
          })),
        );
        return a!;
      };

      await solved({ problemId: 'lin-01', title: 'One step', equation: 'x + 5 = 12', lines: [{ input: 'x = 12 - 5' }, { input: 'x = 7' }], when: daysAgo(3) });
      await solved({ problemId: 'lin-02', title: 'Two steps', equation: '3x - 7 = 11', lines: [{ input: '3x = 18' }, { input: 'x = 6' }], when: daysAgo(2) });

      const when = daysAgo(1);
      const withMistake = await solved({
        problemId: 'lin-03',
        title: 'Unknown on both sides',
        equation: '5x + 3 = 2x + 18',
        lines: [{ input: '5x + 2x = 18 - 3', ok: false }, { input: '5x - 2x = 18 - 3' }, { input: '3x = 15' }, { input: 'x = 5' }],
        when,
      });
      const [mistake] = await tx
        .insert(mistakes)
        .values({
          userId,
          attemptId: withMistake.id,
          errorType: 'SIGN_TRANSFER',
          description: 'Moved 2x to the left side without changing its sign.',
          previousLine: '5x + 3 = 2x + 18',
          stepInput: '5x + 2x = 18 - 3',
          hintsUsed: 1,
          corrected: true,
          correctedAt: when,
          verified: true,
          verifiedAt: when,
          createdAt: when,
        })
        .returning();
      await solved({
        title: 'Follow-up: moving terms',
        equation: '7x - 4 = 3x + 12',
        lines: [{ input: '7x - 3x = 12 + 4' }, { input: '4x = 16' }, { input: 'x = 4' }],
        when,
        parentAttemptId: withMistake.id,
        targetErrorType: 'SIGN_TRANSFER',
        sourceMistakeId: mistake!.id,
      });

      await tx.insert(skillStats).values([
        { userId, skill: 'isolate_variable', mastery: 0.74, attempts: 3 },
        { userId, skill: 'arithmetic', mastery: 0.6, attempts: 1 },
        { userId, skill: 'transfer', mastery: 0.62, attempts: 3 },
        { userId, skill: 'like_terms', mastery: 0.6, attempts: 1 },
      ]);
    });
  }
}
