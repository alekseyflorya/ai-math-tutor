import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
} from '@nestjs/common';
import { and, asc, eq, isNotNull } from 'drizzle-orm';
import { parseEquation, solve, type Locale, type ProblemView, type Skill } from '@tutor/shared';
import { DB, type Db } from '../db/db.module';
import { attempts, problems, skillStats } from '../db/schema';
import { CURRICULUM } from './curriculum';

@Injectable()
export class ProblemsService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ProblemsService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /** Idempotent: the curriculum in code is the source of truth, synced on every boot. */
  async onApplicationBootstrap() {
    for (const [order, p] of CURRICULUM.entries()) {
      const s = solve(parseEquation(p.equation));
      if (s.kind !== 'unique' || !s.value.isInteger()) {
        throw new Error(`Curriculum problem ${p.id} must have a unique integer solution`);
      }
      const data = {
        title: p.title,
        titleUk: p.titleUk,
        equation: p.equation,
        difficulty: p.difficulty,
        skills: p.skills,
        order,
        featured: Boolean(p.featured),
      };
      await this.db
        .insert(problems)
        .values({ id: p.id, ...data })
        .onConflictDoUpdate({ target: problems.id, set: data });
    }
    this.logger.log(`Curriculum synced: ${CURRICULUM.length} problems`);
  }

  async get(id: string) {
    const [problem] = await this.db.select().from(problems).where(eq(problems.id, id));
    if (!problem)
      throw new NotFoundException({ code: 'PROBLEM_NOT_FOUND', message: 'Problem not found' });
    return problem;
  }

  /**
   * Adaptive recommendation: the first unsolved problem that trains the student's
   * weakest skill; otherwise the first unsolved problem in curriculum order.
   */
  async list(userId: string, locale: Locale): Promise<ProblemView[]> {
    const [all, solvedRows, skills] = await Promise.all([
      this.db.select().from(problems).orderBy(asc(problems.order)),
      this.db
        .selectDistinct({ problemId: attempts.problemId })
        .from(attempts)
        .where(
          and(
            eq(attempts.userId, userId),
            eq(attempts.status, 'SOLVED'),
            isNotNull(attempts.problemId),
          ),
        ),
      this.db
        .select()
        .from(skillStats)
        .where(eq(skillStats.userId, userId))
        .orderBy(asc(skillStats.mastery)),
    ]);
    const solved = new Set(solvedRows.map((r) => r.problemId));
    const unsolved = all.filter((p) => !solved.has(p.id));
    // Stay within the student's zone: never jump more than one difficulty level ahead.
    const frontier = Math.min(...unsolved.map((p) => p.difficulty));
    const reachable = unsolved.filter((p) => p.difficulty <= frontier + 1);
    const weakSkills = skills.filter((s) => s.mastery < 0.7).map((s) => s.skill);
    const recommended =
      weakSkills.map((skill) => reachable.find((p) => p.skills.includes(skill))).find(Boolean) ??
      unsolved[0] ??
      null;

    return all.map((p) => ({
      id: p.id,
      title: locale === 'uk' ? p.titleUk : p.title,
      equation: p.equation,
      latex: parseEquation(p.equation).latex,
      difficulty: p.difficulty,
      skills: p.skills as Skill[],
      order: p.order,
      solved: solved.has(p.id),
      recommended: recommended?.id === p.id,
      featured: p.featured,
    }));
  }
}
