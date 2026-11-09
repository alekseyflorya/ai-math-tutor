import {
  CHECK_CASES,
  equationShowsValue,
  guardFalsePositive,
  hiddenValues,
  validateCheckCase,
  validateCheckCases,
} from './check-cases';

describe('check-by-substitution eval cases', () => {
  it('are all valid for the math engine', () => {
    expect(() => validateCheckCases(CHECK_CASES)).not.toThrow();
  });

  it('cover both sides, both kinds of slip and both languages', () => {
    expect(CHECK_CASES.length).toBeGreaterThanOrEqual(10);
    for (const side of ['left', 'right']) {
      for (const operation of ['multiplication', 'addition']) {
        expect(CHECK_CASES.some((k) => k.side === side && k.operation === operation)).toBe(true);
      }
    }
    expect(new Set(CHECK_CASES.map((k) => k.locale))).toEqual(new Set(['en', 'uk']));
  });

  it('rejects a slip in the other side, a right line, and a hidden number the student wrote', () => {
    const k = CHECK_CASES[0]!; // 3·11 = 12 + 19: the slip is on the right
    expect(() => validateCheckCase({ ...k, side: 'left' })).toThrow(/not left/);
    expect(() => validateCheckCase({ ...k, slip: '3·11 = 14 + 19' })).toThrow(/not an arithmetic/);
    expect(() => validateCheckCase({ ...k, slip: '3·11 = 14 + 18' })).toThrow(/hidden number 14/);
  });

  it('include equations that show the value of the sides, with the first curriculum problems', () => {
    const shown = CHECK_CASES.filter(equationShowsValue);
    expect(shown.length).toBeGreaterThanOrEqual(4);
    expect(shown.map((k) => k.problem)).toEqual(
      expect.arrayContaining(['x + 5 = 12', '3x - 7 = 11']),
    );
    expect(new Set(shown.map((k) => k.locale))).toEqual(new Set(['en', 'uk']));
    // In x + 5 = 12 nothing is hidden (12 is in the equation); in 3x − 7 = 11 only 3·6 = 18 is.
    const byProblem = (p: string) => CHECK_CASES.find((k) => k.problem === p)!;
    expect(hiddenValues(byProblem('x + 5 = 12'))).toEqual([]);
    expect(hiddenValues(byProblem('3x - 7 = 11')).map(String)).toEqual(['18']);
  });

  it('calls a guard trigger false when it caught only numbers already written', () => {
    const k = CHECK_CASES.find((c) => c.problem === 'x + 5 = 12')!;
    expect(guardFalsePositive(k, ['12'])).toBe(true);
    expect(guardFalsePositive(k, ['12', '6'])).toBe(false);
    expect(guardFalsePositive(k, [])).toBe(false);
  });
});
