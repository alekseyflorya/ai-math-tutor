import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { Skill } from '@tutor/shared';
import { DB, type Db } from '../db/db.module';
import { skillStats } from '../db/schema';

/** How fast mastery reacts to new evidence. 0.25 ≈ the last ~4 outcomes dominate. */
const ALPHA = 0.25;

/**
 * Outcome signals (0..1) used across the tutor:
 *   1.0 solved cleanly / follow-up passed (understanding verified)
 *   0.7 solved, but with mistakes along the way
 *   0.6 corrected a mistake (with hints)
 *   0.0 made a mistake on this skill
 */
export const OUTCOME = { CLEAN: 1, SOLVED_WITH_MISTAKES: 0.7, CORRECTED: 0.6, MISTAKE: 0 } as const;

@Injectable()
export class SkillsService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /** Atomic upsert of the moving average: mastery += α · (outcome − mastery). */
  async record(userId: string, skill: Skill, outcome: number): Promise<void> {
    const initial = 0.5 + ALPHA * (outcome - 0.5);
    await this.db
      .insert(skillStats)
      .values({ userId, skill, mastery: initial, attempts: 1 })
      .onConflictDoUpdate({
        target: [skillStats.userId, skillStats.skill],
        set: {
          mastery: sql`${skillStats.mastery} + ${ALPHA} * (${outcome} - ${skillStats.mastery})`,
          attempts: sql`${skillStats.attempts} + 1`,
          updatedAt: new Date(),
        },
      });
  }
}
