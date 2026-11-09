import { classifyInput, normalizeMathInput, parseEquation } from './equation';
import { MathInputError, type MathErrorCode } from './errors';
import { checkStep, type StepCheckResult } from './step-check';
import { checkSubstitution, type SubstitutionCheck } from './substitution';

/** What the engine needs to judge a line: all of it is in the attempt (and in AttemptView). */
export interface LineContext {
  mode: 'SOLVING' | 'REMEDIATION' | 'CHECKING';
  /** The original equation (checked by substitution). */
  equation: string;
  /** The last line known to be correct (the next solution step is checked against it). */
  currentLine: string;
  variable: string;
  /** Input of the last correct line of the check, if any. */
  lastCheckLine: string | null;
}

/**
 * The engine's verdict on what the student sent, before any tutor reply. The server acts on it
 * and the browser shows it at once; both call this one function, so they cannot disagree.
 */
export type LineVerdict =
  /** A message to the tutor, not a line of the solution. */
  | { kind: 'message' }
  /** The same line as the last correct one: proves nothing, not recorded. */
  | { kind: 'repeated' }
  /** Could not be read: not recorded. */
  | { kind: 'unreadable'; code: MathErrorCode }
  /** While checking: the line is not a substitution into the equation (not recorded). */
  | { kind: 'not_check'; reason: 'not_numeric' | 'not_substitution' }
  /** A step of the solution, right or wrong. */
  | { kind: 'step'; latex: string; isCorrect: boolean; result: StepCheckResult }
  /** A line of the check by substitution, right or wrong. */
  | { kind: 'check'; latex: string; isCorrect: boolean; result: SubstitutionCheck };

export function judgeLine(text: string, ctx: LineContext): LineVerdict {
  if (classifyInput(text, { mode: ctx.mode }) === 'message') return { kind: 'message' };
  try {
    return ctx.mode === 'CHECKING' ? judgeCheckLine(text, ctx) : judgeStep(text, ctx);
  } catch (e) {
    if (e instanceof MathInputError) return { kind: 'unreadable', code: e.code };
    throw e;
  }
}

function judgeStep(text: string, ctx: LineContext): LineVerdict {
  // Re-typing the last correct line is "equivalent" but proves nothing; after a mistake it
  // would otherwise count as the correction.
  if (sameText(text, ctx.currentLine)) return { kind: 'repeated' };
  const result = checkStep(ctx.currentLine, text, ctx.variable);
  return { kind: 'step', latex: result.current.latex, isCorrect: result.equivalent, result };
}

function judgeCheckLine(text: string, ctx: LineContext): LineVerdict {
  if (ctx.lastCheckLine !== null && sameText(text, ctx.lastCheckLine)) return { kind: 'repeated' };
  const result = checkSubstitution(ctx.equation, text, {
    afterCheckLine: ctx.lastCheckLine !== null,
  });
  const { verdict } = result;
  if (verdict.kind === 'not_numeric' || verdict.kind === 'not_substitution') {
    return { kind: 'not_check', reason: verdict.kind };
  }
  return {
    kind: 'check',
    latex: parseEquation(text).latex,
    isCorrect: verdict.kind === 'correct',
    result,
  };
}

export function sameText(a: string, b: string): boolean {
  return normalizeMathInput(a).replace(/\s/g, '') === normalizeMathInput(b).replace(/\s/g, '');
}
