import { checkSubstitution, Fraction } from '@tutor/shared';
import { LlmUnavailableError } from '../llm/llm.types';

/**
 * A deterministic guard for hints on a slip in the check by substitution. The prompts already say
 * "compute nothing for the student", but a model sometimes writes the value of a side anyway
 * ("the left side is right: 3 · 11 = 33"). This catches that in code.
 */

/** Values a check hint must not state, and which side has the slip. */
export interface CheckHintFacts {
  /** The value both sides take at the root, and the values of both sides of the student's line. */
  forbidden: Fraction[];
  wrongSides: ('left' | 'right')[];
}

const abs = (f: Fraction) => (f.isNegative() ? f.neg() : f);

function decimal(text: string): Fraction {
  const [whole, frac = ''] = text.replace(',', '.').split('.');
  return new Fraction(BigInt(`${whole}${frac}`), 10n ** BigInt(frac.length));
}

/**
 * Every number a text states, as a value without its sign: "33", "2.5" or "2,5", and LaTeX
 * fractions ("\frac{7}{2}"). A plain "6/2" is read as two numbers: it is usually an operation.
 */
export function valuesIn(text: string): Fraction[] {
  const out: Fraction[] = [];
  const rest = text.replace(
    /\\[dt]?frac\s*\{\s*(\d+)\s*\}\s*\{\s*(\d+)\s*\}/g,
    (_m, n: string, d: string) => {
      if (d !== '0') out.push(new Fraction(BigInt(n), BigInt(d)));
      return ' ';
    },
  );
  for (const m of rest.matchAll(/\d+(?:[.,]\d+)?/g)) out.push(decimal(m[0]));
  return out;
}

/**
 * The values a hint for this slip must not state: v* (both sides of the equation at the root) and
 * the true values of both sides of the student's line — except numbers already written in the
 * original equation or in the student's line. Naming those gives nothing away: in x + 5 = 12, v*
 * is the 12 on the right, and a hint may quote the equation; quoting their own "33 = 32" is fine
 * too. Null when the line is not a slip in the check.
 */
export function checkHintFacts(equation: string, line: string): CheckHintFacts | null {
  const result = checkSubstitution(equation, line, { afterCheckLine: true });
  const v = result.verdict;
  if (v.kind !== 'arithmetic') return null;
  const written = [...valuesIn(equation), ...valuesIn(line)];
  const forbidden: Fraction[] = [];
  for (const value of [result.target, v.left, v.right].map(abs)) {
    if (written.some((w) => w.equals(value))) continue;
    if (forbidden.some((f) => f.equals(value))) continue;
    forbidden.push(value);
  }
  return { forbidden, wrongSides: v.wrongSides };
}

/** The forbidden values a message states (as text, e.g. "33"); empty when it gives nothing away. */
export function leakedValues(message: string, forbidden: readonly Fraction[]): string[] {
  const stated = valuesIn(message);
  return forbidden.filter((f) => stated.some((s) => s.equals(f))).map((f) => f.toString());
}

/** What the model is told when its hint stated a value the student must compute. */
export const guardRetryNote = (leaked: readonly string[]) =>
  `Your previous answer stated ${leaked.join(', ')}: a value the student must compute themselves. ` +
  'Write the hint again without any computed value; point at what to compute instead.';

export type GuardResult<T> =
  /** Clean on the first try. */
  | { guard: null; value: T }
  /** Leaked, then clean on the one retry. */
  | { guard: 'retried'; value: T; leaked: string[] }
  /** Leaked twice (or the retry failed): the caller shows its fixed template instead. */
  | { guard: 'template'; value: null; leaked: string[]; discarded: T };

/**
 * Runs a model call for a check hint; if the message states a forbidden value, one retry that
 * names the violation; if it leaks again, the result asks for the template. `generate` gets the
 * retry note (null on the first try).
 */
export async function guardCheckHint<T extends { message: string }>(opts: {
  forbidden: readonly Fraction[];
  generate: (retryNote: string | null) => Promise<T>;
}): Promise<GuardResult<T>> {
  const first = await opts.generate(null);
  const leaked = leakedValues(first.message, opts.forbidden);
  if (leaked.length === 0) return { guard: null, value: first };

  let second: T;
  try {
    second = await opts.generate(guardRetryNote(leaked));
  } catch (e) {
    // A first answer exists but gives the value away: a fixed hint beats "AI unavailable".
    if (e instanceof LlmUnavailableError) {
      return { guard: 'template', value: null, leaked, discarded: first };
    }
    throw e;
  }
  if (leakedValues(second.message, opts.forbidden).length === 0) {
    return { guard: 'retried', value: second, leaked };
  }
  return { guard: 'template', value: null, leaked, discarded: first };
}
