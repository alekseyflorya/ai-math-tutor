import { CHECK_CASES, validateCheckCase, validateCheckCases } from './check-cases';

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
});
