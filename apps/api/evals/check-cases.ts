import {
  checkSubstitution,
  evaluateSide,
  MathInputError,
  parseEquation,
  solve,
  type Fraction,
  type Locale,
} from '@tutor/shared';
import { valuesIn } from '../src/tutor/check-hint-guard';

/**
 * Eval cases for the check by substitution: the student has the root, substituted it correctly,
 * and then made one calculation slip while computing a side. The tutor's hints must not do the
 * calculation for them: no value of a side, no computed check line, and level 3 lists the
 * operations without their results.
 */
export interface CheckCase {
  id: string;
  locale: Locale;
  problem: string;
  /** The first line of the check: the root substituted into the problem (right). */
  substituted: string;
  /** The next line, with one slip. */
  slip: string;
  /** Which side has the slip. */
  side: 'left' | 'right';
  /** Which kind of operation slipped (subtraction counts as addition). */
  operation: 'multiplication' | 'addition';
  /** The right result of the operation that slipped (the value of a side is added on its own). */
  slippedResult: string;
}

const c = (
  id: string,
  locale: Locale,
  problem: string,
  substituted: string,
  slip: string,
  side: CheckCase['side'],
  operation: CheckCase['operation'],
  slippedResult: string,
): CheckCase => ({ id, locale, problem, substituted, slip, side, operation, slippedResult });

// One case per line: id, locale, problem, substituted line, line with the slip, side, operation,
// the right result of the slipped operation.
// prettier-ignore
export const CHECK_CASES: CheckCase[] = [
  c('check-1',  'en', '3(x + 4) = 2x + 19', '3(7 + 4) = 2·7 + 19',   '3·11 = 12 + 19',     'right', 'multiplication', '14'),
  c('check-2',  'uk', '3(x + 4) = 2x + 19', '3(7 + 4) = 2·7 + 19',   '3·11 = 32',          'right', 'addition',       '33'),
  c('check-3',  'en', '5(x - 2) = 3x + 4',  '5(7 - 2) = 3·7 + 4',    '30 = 3·7 + 4',       'left',  'multiplication', '25'),
  c('check-4',  'uk', '4(x + 3) = 6x - 2',  '4(7 + 3) = 6·7 - 2',    '4·11 = 6·7 - 2',     'left',  'addition',       '10'),
  c('check-5',  'en', '4(x + 3) = 6x - 2',  '4(7 + 3) = 6·7 - 2',    '4·10 = 48 - 2',      'right', 'multiplication', '42'),
  c('check-6',  'uk', '2(x + 5) = 4x - 2',  '2(6 + 5) = 4·6 - 2',    '2·11 = 21',          'right', 'addition',       '22'),
  c('check-7',  'en', '7x - 4 = 3x + 12',   '7·4 - 4 = 3·4 + 12',    '27 - 4 = 3·4 + 12',  'left',  'multiplication', '28'),
  c('check-8',  'uk', '7x - 4 = 3x + 12',   '7·4 - 4 = 3·4 + 12',    '28 - 4 = 22',        'right', 'addition',       '24'),
  c('check-9',  'en', 'x/2 + 3 = x - 1',    '8/2 + 3 = 8 - 1',       '8 = 8 - 1',          'left',  'addition',       '7'),
  c('check-10', 'uk', '3(2x - 1) = 4x + 9', '3(2·6 - 1) = 4·6 + 9',  '3(13 - 1) = 4·6 + 9', 'left', 'multiplication', '12'),
  c('check-11', 'en', '3(2x - 1) = 4x + 9', '3(2·6 - 1) = 4·6 + 9',  '3·11 = 30 + 9',      'right', 'multiplication', '24'),
  c('check-12', 'uk', '2(x + 4) = 3x + 1',  '2(7 + 4) = 3·7 + 1',    '2·11 = 23',          'right', 'addition',       '22'),
  // The equation itself shows v* (a number on one side): quoting it gives nothing away, and the
  // guard must not fire on it. check-13 and check-14 are the first curriculum problems.
  c('check-13', 'en', 'x + 5 = 12',         '7 + 5 = 12',            '13 = 12',            'left',  'addition',       '12'),
  c('check-14', 'uk', '3x - 7 = 11',        '3·6 - 7 = 11',          '17 - 7 = 11',        'left',  'multiplication', '18'),
  c('check-15', 'en', '2x + 3 = 13',        '2·5 + 3 = 13',          '11 + 3 = 13',        'left',  'multiplication', '10'),
  c('check-16', 'uk', 'x - 4 = 9',          '13 - 4 = 9',            '8 = 9',              'left',  'addition',       '9'),
  c('check-17', 'en', '4x = 28',            '4·7 = 28',              '24 = 28',            'left',  'multiplication', '28'),
  c('check-18', 'uk', '2(x - 1) = 10',      '2(6 - 1) = 10',         '2·4 = 10',           'left',  'addition',       '5'),
];

/** The value of the sides at the root is a number written in the equation (x + 5 = 12 → 12). */
export const equationShowsValue = (k: CheckCase): boolean =>
  valuesIn(k.problem).some((v) => v.equals(solveSides(k)));

/** The root and the value both sides take at it (the engine's numbers). */
export function checkFacts(k: Pick<CheckCase, 'problem'>): { root: string; sideValue: string } {
  const eq = parseEquation(k.problem);
  const s = solve(eq);
  if (s.kind !== 'unique') throw new InvalidCheckCaseError(`${k.problem} has no unique root`);
  return { root: s.value.toString(), sideValue: evaluateSide(eq.left, s.value).toString() };
}

/**
 * Values the tutor must not state: the value of the sides at the root and the right result of the
 * operation that slipped, unless the equation already shows them (naming those gives nothing
 * away). Wider than what the API's guard forbids (it does not know which operation slipped), so
 * the eval also sees what the guard lets through.
 */
export function hiddenValues(k: CheckCase): Fraction[] {
  const shown = valuesIn(k.problem);
  const out: Fraction[] = [];
  for (const v of [solveSides(k), valuesIn(k.slippedResult)[0]!]) {
    if (!shown.some((s) => s.equals(v)) && !out.some((o) => o.equals(v))) out.push(v);
  }
  return out;
}

function solveSides(k: CheckCase): Fraction {
  const eq = parseEquation(k.problem);
  const s = solve(eq);
  if (s.kind !== 'unique') throw new InvalidCheckCaseError(`${k.problem} has no unique root`);
  return evaluateSide(eq.left, s.value);
}

/** Every number the guard caught is already written in the equation or the student's lines. */
export function guardFalsePositive(k: CheckCase, leaked: readonly string[]): boolean {
  const written = [k.problem, k.substituted, k.slip].flatMap(valuesIn);
  return (
    leaked.length > 0 &&
    leaked.every((n) => valuesIn(n).every((v) => written.some((w) => w.equals(v))))
  );
}

export class InvalidCheckCaseError extends Error {}

/**
 * Meaningful only if the engine agrees: the substitution is a right first check line, the slip is
 * an arithmetic slip in the stated side, and none of the hidden numbers is written anywhere the
 * student wrote (so a hidden number in a hint can only come from the tutor).
 */
export function validateCheckCase(k: CheckCase): void {
  const fail = (why: string) => {
    throw new InvalidCheckCaseError(`Check case ${k.id} is invalid: ${why}`);
  };
  try {
    const first = checkSubstitution(k.problem, k.substituted, { afterCheckLine: false }).verdict;
    if (first.kind !== 'correct' || first.done) {
      fail(`"${k.substituted}" is not a right, unfinished first check line (${first.kind})`);
    }
    const slip = checkSubstitution(k.problem, k.slip, { afterCheckLine: true }).verdict;
    if (slip.kind !== 'arithmetic') fail(`"${k.slip}" is not an arithmetic slip (${slip.kind})`);
    else if (slip.wrongSides.join() !== k.side) {
      fail(`the slip is in ${slip.wrongSides.join(' and ')}, not ${k.side}`);
    }
    const written = [k.problem, k.substituted, k.slip].flatMap(valuesIn);
    for (const v of hiddenValues(k)) {
      if (written.some((w) => w.equals(v))) {
        fail(`hidden number ${v.toString()} already appears in what the student wrote`);
      }
    }
  } catch (e) {
    if (e instanceof MathInputError) fail(`the engine cannot read it (${e.message})`);
    throw e;
  }
}

export function validateCheckCases(cases: readonly CheckCase[]): void {
  const ids = new Set<string>();
  for (const k of cases) {
    if (ids.has(k.id)) throw new InvalidCheckCaseError(`Duplicate check case id ${k.id}`);
    ids.add(k.id);
    validateCheckCase(k);
  }
}
