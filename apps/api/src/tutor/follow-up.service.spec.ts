import { ERROR_TYPES } from '@tutor/shared';
import { templateProblem, validateFollowUp } from './follow-up.service';

describe('validateFollowUp (math engine as referee for generated problems)', () => {
  it('accepts a problem that re-tests the same trap', () => {
    expect(
      validateFollowUp('5(x - 2) = 3x + 4', 'DISTRIBUTION', ['3(x + 4) = 2x + 19']),
    ).toBeUndefined();
  });

  it('rejects problems that cannot test the targeted mistake', () => {
    expect(validateFollowUp('5x - 2 = 3x + 4', 'DISTRIBUTION', [])).toMatch(/bracket/);
    expect(validateFollowUp('5x - 2 = 13', 'SIGN_TRANSFER', [])).toMatch(/both sides/);
  });

  it('rejects ugly, unsolvable, non-linear or repeated problems', () => {
    expect(validateFollowUp('2x = 3', 'ARITHMETIC', [])).toMatch(/whole number/);
    expect(validateFollowUp('2(x + 1) = 2x + 2', 'DISTRIBUTION', [])).toMatch(/exactly one/);
    expect(validateFollowUp('x^2 = 4', 'OTHER', [])).toMatch(/parsed/);
    expect(validateFollowUp('3(x + 4) = 2x + 19', 'DISTRIBUTION', ['3(x+4)=2x+19'])).toMatch(
      /repeats/,
    );
    expect(validateFollowUp('3(y + 4) = 2y + 19', 'DISTRIBUTION', [])).toMatch(/must be x/);
  });

  it('template fallback always produces a valid problem', () => {
    for (const t of ERROR_TYPES) {
      for (let i = 0; i < 50; i++)
        expect(validateFollowUp(templateProblem(t), t, [])).toBeUndefined();
    }
  });
});
