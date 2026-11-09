import { percentile, summarize, violations, type CaseResult, type HintChecks } from './metrics';

const ok: HintChecks = {
  revealsAnswer: false,
  answerAllowed: false,
  language: 'en',
  latexIntact: true,
};

function result(over: Partial<CaseResult>): CaseResult {
  return {
    id: 'c',
    locale: 'en',
    expected: 'DISTRIBUTION',
    predicted: 'DISTRIBUTION',
    hints: [
      { level: 1, message: 'm', checks: { ...ok, question: true } },
      { level: 2, message: 'm', checks: ok },
      { level: 3, message: 'm', checks: { ...ok, correctedStep: { shows: true, newLines: 1 } } },
    ],
    ...over,
  };
}

const attempt = (
  ok: boolean,
  latencyMs: number,
  reason: 'invalid_output' | 'rate_limited' | null = null,
) => ({
  attempt: 1,
  ok,
  latencyMs,
  reason,
  error: null,
});

describe('percentile', () => {
  it('uses nearest rank', () => {
    const xs = [5, 1, 4, 2, 3, 10, 9, 8, 7, 6];
    expect(percentile(xs, 50)).toBe(5);
    expect(percentile(xs, 95)).toBe(10);
    expect(percentile([42], 95)).toBe(42);
    expect(percentile([], 50)).toBe(0);
  });
});

describe('summarize', () => {
  it('computes accuracy, per type, per locale and the confusion matrix', () => {
    const s = summarize(
      [
        result({ id: 'a' }),
        result({ id: 'b', predicted: 'ARITHMETIC', locale: 'uk' }),
        result({ id: 'c', expected: 'SIGN_TRANSFER', predicted: null, hints: [] }),
      ],
      [],
    );
    expect(s.accuracy).toEqual({ ok: 1, total: 3 });
    expect(s.byType.DISTRIBUTION).toEqual({ ok: 1, total: 2 });
    expect(s.byType.SIGN_TRANSFER).toEqual({ ok: 0, total: 1 });
    expect(s.byLocale).toEqual({ en: { ok: 1, total: 2 }, uk: { ok: 0, total: 1 } });
    expect(s.confusion.DISTRIBUTION.DISTRIBUTION).toBe(1);
    expect(s.confusion.DISTRIBUTION.ARITHMETIC).toBe(1);
    expect(s.confusion.SIGN_TRANSFER.FAILED).toBe(1);
  });

  it('counts invalid JSON among answered attempts only, and latency of successful ones', () => {
    const s = summarize(
      [],
      [
        {
          purpose: 'diagnose',
          ok: true,
          attempts: [attempt(false, 900, 'invalid_output'), attempt(true, 100)],
        },
        {
          purpose: 'hint',
          ok: true,
          attempts: [attempt(false, 5, 'rate_limited'), attempt(true, 300)],
        },
        { purpose: 'hint', ok: false, attempts: [attempt(false, 10, 'rate_limited')] },
      ],
    );
    expect(s.invalidJson).toEqual({ ok: 1, total: 3 });
    expect(s.failedCalls).toEqual({ ok: 1, total: 3 });
    expect(s.latency.byPurpose.diagnose.p50).toBe(100);
    expect(s.latency.byPurpose.hint.p95).toBe(300);
  });

  it('applies the hint rules', () => {
    const bad = result({
      locale: 'uk',
      hints: [
        { level: 1, message: 'm', checks: { ...ok, question: false, revealsAnswer: true } },
        { level: 2, message: null, error: 'timeout' },
        {
          level: 3,
          message: 'm',
          checks: {
            ...ok,
            language: 'uk',
            latexIntact: false,
            correctedStep: { shows: true, newLines: 2 },
          },
        },
      ],
    });
    const allowed = result({
      hints: [
        {
          level: 3,
          message: 'm',
          checks: {
            ...ok,
            revealsAnswer: true,
            answerAllowed: true,
            correctedStep: { shows: true, newLines: 1 },
          },
        },
      ],
    });
    const s = summarize([result({}), bad, allowed], []);
    expect(s.rules.level1Question).toEqual({ ok: 1, total: 2 });
    expect(s.rules.noFinalAnswer).toEqual({ ok: 5, total: 6 });
    expect(s.rules.level3CorrectedOnly).toEqual({ ok: 2, total: 3 });
    expect(s.rules.language).toEqual({ ok: 5, total: 6 });
    expect(s.rules.latexIntact).toEqual({ ok: 5, total: 6 });
    expect(violations(bad.hints[0]!, 'uk')).toEqual([
      'level 1 is not a question',
      'reveals the final answer',
      'language en, expected uk',
    ]);
    expect(violations(bad.hints[1]!, 'uk')).toEqual(['call failed: timeout']);
    expect(violations(bad.hints[2]!, 'uk')).toEqual([
      'level 3 goes beyond the step (2 new lines)',
      'LaTeX broken by JSON escaping (repaired before use)',
    ]);
  });
});
