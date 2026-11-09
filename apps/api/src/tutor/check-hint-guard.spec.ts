import { Fraction } from '@tutor/shared';
import { LlmUnavailableError } from '../llm/llm.types';
import {
  checkHintFacts,
  guardCheckHint,
  guardRetryNote,
  leakedValues,
  valuesIn,
} from './check-hint-guard';
import { notices } from './notices';

const problem = '3(x + 4) = 2x + 19'; // x = 7, both sides 33

describe('check-hint guard: the detector', () => {
  it('reads numbers as values, LaTeX fractions included, without their sign', () => {
    expect(valuesIn('$3 \\cdot 11 = 33$, then −2,5 and \\frac{7}{2}').map(String)).toEqual([
      '7/2',
      '3',
      '11',
      '33',
      '5/2',
    ]);
  });

  it('forbids v* and both sides of the line, except numbers the student wrote', () => {
    // 3·11 = 12 + 19: the left side is 33 (= v*), the right side really is 31.
    const facts = checkHintFacts(problem, '3·11 = 12 + 19')!;
    expect(facts.forbidden.map(String)).toEqual(['33', '31']);
    expect(facts.wrongSides).toEqual(['right']);
    // "33 = 32": the student wrote both values, so quoting the line gives nothing away.
    expect(checkHintFacts(problem, '33 = 32')!.forbidden).toEqual([]);
    expect(checkHintFacts(problem, '33 = 33')).toBeNull(); // not a slip
  });

  it('finds a forbidden value in a message', () => {
    const forbidden = [new Fraction(33n), new Fraction(31n)];
    expect(leakedValues('The left side is right: $3 \\cdot 11 = 33$.', forbidden)).toEqual(['33']);
    expect(
      leakedValues('Which operation on the right gives a different result?', forbidden),
    ).toEqual([]);
    expect(leakedValues('Recompute $12 + 19$.', forbidden)).toEqual([]);
  });
});

describe('check-hint guard: violation → one retry → template', () => {
  const forbidden = [new Fraction(33n)];
  const leak = { message: 'The left side is right: 33. Look at the right side?' };
  const clean = { message: 'Which side should you recompute?' };

  it('passes a clean answer through with no retry', async () => {
    const generate = jest.fn().mockResolvedValue(clean);
    await expect(guardCheckHint({ forbidden, generate })).resolves.toEqual({
      guard: null,
      value: clean,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('retries once with the violation named, and keeps a clean second answer', async () => {
    const generate = jest.fn().mockResolvedValueOnce(leak).mockResolvedValueOnce(clean);
    await expect(guardCheckHint({ forbidden, generate })).resolves.toEqual({
      guard: 'retried',
      value: clean,
      leaked: ['33'],
    });
    expect(generate).toHaveBeenNthCalledWith(1, null);
    expect(generate).toHaveBeenNthCalledWith(2, guardRetryNote(['33']));
  });

  it('asks for the template when the retry leaks too, or fails', async () => {
    const twice = jest.fn().mockResolvedValue(leak);
    await expect(guardCheckHint({ forbidden, generate: twice })).resolves.toMatchObject({
      guard: 'template',
      value: null,
      discarded: leak,
    });
    expect(twice).toHaveBeenCalledTimes(2);

    const down = jest
      .fn()
      .mockResolvedValueOnce(leak)
      .mockRejectedValueOnce(new LlmUnavailableError('timeout', 'slow'));
    await expect(guardCheckHint({ forbidden, generate: down })).resolves.toMatchObject({
      guard: 'template',
    });
  });

  it('has a template for every level and language, with no number in it', () => {
    for (const locale of ['en', 'uk'] as const) {
      for (const level of [1, 2, 3] as const) {
        for (const sides of [['left'], ['right'], ['left', 'right']] as ('left' | 'right')[][]) {
          expect(notices.checkHintTemplate(locale, level, sides)).not.toMatch(/\d/);
        }
      }
      expect(notices.checkHintTemplate(locale, 1, ['right'])).toMatch(/\?$/);
    }
  });
});
