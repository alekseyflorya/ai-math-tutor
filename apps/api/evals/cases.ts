import { checkStep, MathInputError, type ErrorType, type Locale } from '@tutor/shared';

/**
 * Eval cases for the AI part: a wrong step and the category a teacher would give it.
 *
 * `previousLine` is the last line the engine verified (it may already be several steps into
 * the problem); `wrongStep` is what the student wrote next. Labels are a teacher's judgement:
 * the taxonomy overlaps at the edges (an arithmetic slip while combining terms, for example),
 * so a few "misses" are arguable. Read the confusion matrix, not only the total.
 */
export interface EvalCase {
  id: string;
  problem: string;
  previousLine: string;
  wrongStep: string;
  expectedErrorType: ErrorType;
  locale: Locale;
}

const c = (
  id: string,
  locale: Locale,
  expectedErrorType: ErrorType,
  problem: string,
  previousLine: string | null,
  wrongStep: string,
): EvalCase => ({
  id,
  problem,
  previousLine: previousLine ?? problem,
  wrongStep,
  expectedErrorType,
  locale,
});

export const CASES: EvalCase[] = [
  // --- DISTRIBUTION: brackets opened incorrectly -----------------------------------------------
  c('dist-1', 'en', 'DISTRIBUTION', '3(x + 4) = 2x + 19', null, '3x + 4 = 2x + 19'),
  c('dist-2', 'uk', 'DISTRIBUTION', '5(x - 2) = 3x + 4', null, '5x - 2 = 3x + 4'),
  c('dist-3', 'en', 'DISTRIBUTION', '-2(x - 3) = 4x', null, '-2x - 6 = 4x'),
  c('dist-4', 'uk', 'DISTRIBUTION', '4(2x + 1) = 3x + 14', null, '8x + 1 = 3x + 14'),
  c('dist-5', 'en', 'DISTRIBUTION', '7 - 3(x + 2) = 4', null, '7 - 3x + 6 = 4'),
  c('dist-6', 'uk', 'DISTRIBUTION', '2(3x - 5) = x + 10', null, '6x - 5 = x + 10'),
  c('dist-7', 'en', 'DISTRIBUTION', '3(x + 2) = 2(x + 5)', null, '3x + 6 = 2x + 5'),
  c('dist-8', 'uk', 'DISTRIBUTION', '-(x + 4) = 2x - 1', null, '-x + 4 = 2x - 1'),

  // --- SIGN_TRANSFER: a term crosses "=" without changing its sign ------------------------------
  c(
    'sign-1',
    'en',
    'SIGN_TRANSFER',
    '3(x + 4) = 2x + 19',
    '3x + 12 = 2x + 19',
    '3x - 2x = 19 + 12',
  ),
  c('sign-2', 'uk', 'SIGN_TRANSFER', '5x - 7 = 2x + 8', null, '5x - 2x = 8 - 7'),
  c('sign-3', 'en', 'SIGN_TRANSFER', '4x + 9 = x + 3', null, '4x + x = 3 - 9'),
  c('sign-4', 'uk', 'SIGN_TRANSFER', '7x = 3x + 20', null, '7x + 3x = 20'),
  c('sign-5', 'en', 'SIGN_TRANSFER', '2x - 5 = 11', null, '2x = 11 - 5'),
  c('sign-6', 'uk', 'SIGN_TRANSFER', '6 - x = 2x + 15', null, '6 - 15 = 2x - x'),
  c('sign-7', 'en', 'SIGN_TRANSFER', '3x + 8 = 5x - 6', null, '3x - 5x = -6 + 8'),
  c('sign-8', 'uk', 'SIGN_TRANSFER', '2(x - 1) = x + 6', '2x - 2 = x + 6', '2x - x = 6 - 2'),

  // --- COMBINING_LIKE_TERMS: like terms added/subtracted wrongly, or x mixed with numbers -------
  c('comb-1', 'en', 'COMBINING_LIKE_TERMS', '3(x + 4) = 2x + 19', '3x - 2x = 19 - 12', '5x = 7'),
  c('comb-2', 'uk', 'COMBINING_LIKE_TERMS', '4x + 3 - x = 12', null, '5x + 3 = 12'),
  c('comb-3', 'en', 'COMBINING_LIKE_TERMS', '2x + 5 + x = 14', null, '8x = 14'),
  c('comb-4', 'uk', 'COMBINING_LIKE_TERMS', '6x - 2x + 4 = 20', null, '8x + 4 = 20'),
  c('comb-5', 'en', 'COMBINING_LIKE_TERMS', '5x - 8x = 9', null, '3x = 9'),
  c('comb-6', 'uk', 'COMBINING_LIKE_TERMS', 'x + x + 6 = 20', null, 'x + 6 = 20'),
  c('comb-7', 'en', 'COMBINING_LIKE_TERMS', '9 - 2x + 5x = 21', null, '9 - 7x = 21'),
  c('comb-8', 'uk', 'COMBINING_LIKE_TERMS', '8x - 3 - 3x = 12', null, '11x - 3 = 12'),

  // --- INVERSE_OPERATION: wrong operation used to isolate x -------------------------------------
  c('inv-1', 'en', 'INVERSE_OPERATION', '4x + 3 = 23', '4x = 20', 'x = 16'),
  c('inv-2', 'uk', 'INVERSE_OPERATION', 'x/3 + 2 = 6', 'x/3 = 4', 'x = 4/3'),
  c('inv-3', 'en', 'INVERSE_OPERATION', '5x - 4 = 2x + 11', '3x = 15', 'x = 45'),
  c('inv-4', 'uk', 'INVERSE_OPERATION', '2(x + 3) = 18', '2x = 12', 'x = 10'),
  c('inv-5', 'en', 'INVERSE_OPERATION', 'x/4 - 1 = 2', 'x/4 = 3', 'x = 3/4'),
  c('inv-6', 'uk', 'INVERSE_OPERATION', '-3x + 2 = 14', '-3x = 12', 'x = 15'),
  c('inv-7', 'en', 'INVERSE_OPERATION', '6x = 2x + 24', '4x = 24', 'x = 20'),
  c('inv-8', 'uk', 'INVERSE_OPERATION', '7x - 5 = 30', '7x = 35', 'x = 245'),

  // --- ONE_SIDE_ONLY: an operation applied to one side, or to one term only ---------------------
  c('one-1', 'en', 'ONE_SIDE_ONLY', '2x + 6 = 10', null, 'x + 6 = 5'),
  c('one-2', 'uk', 'ONE_SIDE_ONLY', '3(x + 4) = 2x + 19', 'x + 12 = 19', 'x = 19'),
  c('one-3', 'en', 'ONE_SIDE_ONLY', '4x + 8 = 2x + 20', null, '4x + 8 = 20'),
  c('one-4', 'uk', 'ONE_SIDE_ONLY', '6x - 9 = 15', null, '2x - 9 = 5'),
  c('one-5', 'en', 'ONE_SIDE_ONLY', 'x/2 + 3 = 7', null, 'x + 3 = 14'),
  c('one-6', 'uk', 'ONE_SIDE_ONLY', '5x + 10 = 3x + 20', null, '5x = 3x + 20'),
  c('one-7', 'en', 'ONE_SIDE_ONLY', '3x = 12 + x', null, '2x = 12 + x'),
  c('one-8', 'uk', 'ONE_SIDE_ONLY', '4(x - 1) = 2x + 6', '4x - 4 = 2x + 6', '2x - 2 = 2x + 6'),

  // --- ARITHMETIC: the method is right, a calculation is not -----------------------------------
  c('arith-1', 'en', 'ARITHMETIC', '3(x + 4) = 2x + 19', 'x + 12 = 19', 'x = 8'),
  c('arith-2', 'uk', 'ARITHMETIC', '5x + 3 = 38', '5x = 35', 'x = 6'),
  c('arith-3', 'en', 'ARITHMETIC', '2x + 17 = 41', null, '2x = 34'),
  c('arith-4', 'uk', 'ARITHMETIC', '4x - 9 = 27', null, '4x = 38'),
  c('arith-5', 'en', 'ARITHMETIC', '6(x - 2) = 30', null, '6x - 14 = 30'),
  c('arith-6', 'uk', 'ARITHMETIC', '3x + 15 = 7x - 13', '28 = 4x', '8 = x'),
  c('arith-7', 'en', 'ARITHMETIC', '9x - 4 = 50', '9x = 54', 'x = 7'),
  c('arith-8', 'uk', 'ARITHMETIC', 'x - 23 = 48', null, 'x = 61'),

  // --- OTHER: not a broken transformation rule (miscopying, x disappears, numbers swapped) ------
  c('other-1', 'en', 'OTHER', '3(x + 4) = 2x + 19', null, '3(x + 4) = 2x + 91'),
  c('other-2', 'uk', 'OTHER', '4x + 7 = 31', null, '7x + 4 = 31'),
  c('other-3', 'en', 'OTHER', '3x + 4 = 19', null, '3 + 4 = 19'),
  c('other-4', 'uk', 'OTHER', 'x + 9 = 4x - 3', null, 'x + 9 = 4x + 3'),
  c('other-5', 'en', 'OTHER', '5x - 2 = 3x + 6', null, '5x - 2 = 3x + 6x'),
  c('other-6', 'uk', 'OTHER', '2x + 9 = 5x', null, '2 + 9 = 5'),
];

export class InvalidCaseError extends Error {}

/**
 * A case is only meaningful if the math engine agrees the step is wrong and the previous line
 * is a correct state of the problem. The eval refuses to run otherwise.
 */
export function validateCase(k: EvalCase): void {
  const fail = (why: string) => {
    throw new InvalidCaseError(`Eval case ${k.id} is invalid: ${why}`);
  };
  try {
    if (k.previousLine !== k.problem && !checkStep(k.problem, k.previousLine).equivalent) {
      fail(`previousLine "${k.previousLine}" is not equivalent to the problem`);
    }
    if (checkStep(k.previousLine, k.wrongStep).equivalent) {
      fail(`the engine accepts "${k.wrongStep}" after "${k.previousLine}" as correct`);
    }
  } catch (e) {
    if (e instanceof MathInputError) fail(`the engine cannot read it (${e.message})`);
    throw e;
  }
}

export function validateCases(cases: readonly EvalCase[]): void {
  const ids = new Set<string>();
  for (const k of cases) {
    if (ids.has(k.id)) throw new InvalidCaseError(`Duplicate eval case id ${k.id}`);
    ids.add(k.id);
    validateCase(k);
  }
}
