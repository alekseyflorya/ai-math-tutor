import type { Locale, Skill } from '@tutor/shared';
import type { Attempt, Mistake, Step } from '../db/schema';

/** An attempt plus what a turn needs; mutated in memory as the turn progresses. */
export interface Turn {
  attempt: Attempt;
  steps: Step[];
  mistakes: Mistake[];
  problemSkills: Skill[];
  locale: Locale;
  /** Epoch ms: every model call of this turn, together, must finish by then. */
  deadline: number;
}

/** The mistake the student is currently fixing (REMEDIATION), if any. */
export function activeMistake(turn: Turn): Mistake | null {
  const id = turn.attempt.activeMistakeId;
  return id ? (turn.mistakes.find((m) => m.id === id) ?? null) : null;
}
