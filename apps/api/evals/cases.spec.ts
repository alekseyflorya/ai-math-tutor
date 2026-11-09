import { ERROR_TYPES } from '@tutor/shared';
import { CASES, InvalidCaseError, validateCase, validateCases } from './cases';

describe('eval cases', () => {
  it('are all valid: the engine rejects every wrong step and accepts every previous line', () => {
    expect(() => validateCases(CASES)).not.toThrow();
  });

  it('cover every error type, roughly half EN and half UK', () => {
    expect(CASES.length).toBeGreaterThanOrEqual(50);
    expect(CASES.length).toBeLessThanOrEqual(60);
    for (const t of ERROR_TYPES) {
      expect(CASES.filter((k) => k.expectedErrorType === t).length).toBeGreaterThanOrEqual(5);
    }
    const en = CASES.filter((k) => k.locale === 'en').length;
    expect(Math.abs(en - (CASES.length - en))).toBeLessThanOrEqual(2);
  });

  it('refuses a case whose "wrong" step is actually correct', () => {
    const k = { ...CASES[0]!, wrongStep: '3x + 12 = 2x + 19' };
    expect(() => validateCase(k)).toThrow(InvalidCaseError);
    expect(() => validateCase({ ...k, wrongStep: '3x + = 1' })).toThrow(/cannot read/);
    expect(() => validateCase({ ...k, previousLine: 'x = 1' })).toThrow(/not equivalent/);
  });
});
