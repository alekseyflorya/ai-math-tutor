import {
  judgeLine,
  lineContext,
  parseEquation,
  type AttemptView,
  type StepView,
} from '@tutor/shared';

/**
 * The line the student just sent, as the notebook shows it until the server answers. The verdict
 * comes from the same engine function the server runs (`judgeLine`), so it is final in all but
 * a bug: the server's answer replaces it either way.
 */
export interface ProvisionalLine {
  latex: string;
  phase: StepView['phase'];
  /** null: shown without a mark (while checking, a line that is not a substitution). */
  isCorrect: boolean | null;
}

/** The engine's verdict on `text`, or null when it is not a line the notebook records. */
export function provisionalLine(attempt: AttemptView, text: string): ProvisionalLine | null {
  let verdict;
  try {
    verdict = judgeLine(text, lineContext(attempt, attempt.steps));
  } catch {
    return null; // the server decides; nothing to show early
  }
  switch (verdict.kind) {
    case 'step':
      return { latex: verdict.latex, phase: 'SOLUTION', isCorrect: verdict.isCorrect };
    case 'check':
      return { latex: verdict.latex, phase: 'CHECK', isCorrect: verdict.isCorrect };
    case 'not_check':
      return { latex: parseEquation(text).latex, phase: 'CHECK', isCorrect: null };
    default:
      return null;
  }
}

/**
 * Whether the server recorded what the browser predicted: one new step with the same verdict,
 * or no step for a line without a mark (and for lines the browser did not show).
 */
export function agreesWithServer(
  line: ProvisionalLine | null,
  before: AttemptView,
  after: AttemptView,
): boolean {
  const added = after.steps.slice(before.steps.length);
  if (!line || line.isCorrect === null) return added.length === 0;
  return (
    added.length === 1 && added[0]!.isCorrect === line.isCorrect && added[0]!.phase === line.phase
  );
}
