import { evaluateSide, isPlainNumber, parseEquation, solve } from './equation';
import type { Fraction } from './fraction';

/**
 * Checking an answer the way it is taught at school: substitute the root into the ORIGINAL
 * equation and compute both sides. At the root both sides of the original equation have the same
 * value v* (for 3(x + 4) = 2x + 19 at x = 7 that is 33), so a line of the check is right exactly
 * when it is a numeric equality whose sides both equal v* — whichever side is written first and
 * however far it is simplified ("3(7 + 4) = 2*7 + 19", "3*11 = 14 + 19", "33 = 33").
 */
export type SubstitutionVerdict =
  /** The line still has the variable: the number was not substituted. */
  | { kind: 'not_numeric' }
  /** A first check line where no side gives v*: not this equation, or another value substituted. */
  | { kind: 'not_substitution'; left: Fraction; right: Fraction }
  /** A side was computed wrongly. */
  | { kind: 'arithmetic'; left: Fraction; right: Fraction; wrongSides: ('left' | 'right')[] }
  /** Both sides equal v*; `done` when both are written as plain numbers ("33 = 33"). */
  | { kind: 'correct'; done: boolean };

export interface SubstitutionCheck {
  verdict: SubstitutionVerdict;
  /** The root that is being checked. */
  solution: Fraction;
  /** The value both sides of the original equation take at the root. */
  target: Fraction;
  /** Deterministic facts for the tutor's prompt (plain English). */
  facts: string[];
}

/**
 * Throws MathInputError when the line cannot be read (shown to the student like any step), and
 * a plain Error when the original equation has no unique solution (a bug: such attempts are
 * never created).
 */
export function checkSubstitution(
  equation: string,
  line: string,
  opts: { afterCheckLine: boolean },
): SubstitutionCheck {
  const original = parseEquation(equation);
  const sol = solve(original);
  if (sol.kind !== 'unique') throw new Error(`"${equation}" has no unique solution to check`);
  const solution = sol.value;
  const target = evaluateSide(original.left, solution);
  const variable = original.variable ?? 'x';

  const parsed = parseEquation(line);
  const facts = [
    `Checking by substitution: in the original equation ${equation}, at ${variable} = ${solution.toString()} both sides equal ${target.toString()}.`,
  ];
  if (parsed.variable !== null) {
    facts.push(`The student's line still contains ${parsed.variable}: nothing was substituted.`);
    return { verdict: { kind: 'not_numeric' }, solution, target, facts };
  }

  const left = parsed.left.b;
  const right = parsed.right.b;
  facts.push(
    `The student's check line: left side = ${left.toString()}, right side = ${right.toString()}.`,
  );
  const wrongSides = (['left', 'right'] as const).filter(
    (side) => !(side === 'left' ? left : right).equals(target),
  );

  if (wrongSides.length === 0) {
    const [l, r] = parsed.normalized.split('=');
    const done = isPlainNumber(l!) && isPlainNumber(r!);
    facts.push(done ? 'The check is complete.' : 'Correct so far; it can be simplified further.');
    return { verdict: { kind: 'correct', done }, solution, target, facts };
  }
  if (wrongSides.length === 2 && !opts.afterCheckLine) {
    facts.push(
      `Neither side equals ${target.toString()}: this is not ${variable} = ${solution.toString()} substituted into the original equation.`,
    );
    return { verdict: { kind: 'not_substitution', left, right }, solution, target, facts };
  }
  for (const side of wrongSides) {
    const value = side === 'left' ? left : right;
    facts.push(
      `The ${side} side was computed wrongly: ${value.toString()} instead of ${target.toString()}.`,
    );
  }
  return { verdict: { kind: 'arithmetic', left, right, wrongSides }, solution, target, facts };
}
