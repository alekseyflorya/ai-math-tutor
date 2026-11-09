import {
  checkViolations,
  percentile,
  summarize,
  summarizeChecks,
  violations,
  type CaseResult,
  type CheckCaseResult,
  type CheckHintChecks,
  type CheckHintResult,
  type HintChecks,
} from './metrics';

const ok: HintChecks = {
  revealsAnswer: false,
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
    // The corrected step is the answer ("4x = 20 → x = 5"): name the operation, never show x = 5.
    const final = (checks: Partial<HintChecks>) => ({
      level: 3 as const,
      message: 'm',
      checks: { ...ok, finalStep: true, correctedStep: { shows: false, newLines: 0 }, ...checks },
    });
    const finalStep = result({
      hints: [
        final({ namesOperation: true }),
        final({ revealsAnswer: true, correctedStep: { shows: true, newLines: 1 } }),
        final({ namesOperation: false }),
      ],
    });
    const s = summarize([result({}), bad, finalStep], []);
    expect(s.rules.level1Question).toEqual({ ok: 1, total: 2 });
    expect(s.rules.noFinalAnswer).toEqual({ ok: 6, total: 8 });
    expect(s.rules.level3CorrectedOnly).toEqual({ ok: 2, total: 5 });
    expect(s.rules.language).toEqual({ ok: 7, total: 8 });
    expect(s.rules.latexIntact).toEqual({ ok: 7, total: 8 });
    expect(violations(finalStep.hints[1]!, 'en')).toEqual(['reveals the final answer']);
    expect(violations(finalStep.hints[2]!, 'en')).toEqual([
      'level 3 neither shows the step nor names the operation',
    ]);
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

describe('check-by-substitution metrics', () => {
  const checks = (over: Partial<CheckHintChecks> = {}): CheckHintChecks => ({
    statedNumbers: [],
    computedLines: [],
    language: 'en',
    latexIntact: true,
    ...over,
  });
  const result = (hints: CheckHintResult[]): CheckCaseResult => ({
    id: 'check-1',
    locale: 'en',
    side: 'right',
    operation: 'multiplication',
    hints,
  });

  it('counts each rule per hint, and level 3 only when it names operations without results', () => {
    const s = summarizeChecks(
      [
        result([
          { level: 1, message: 'q?', checks: checks({ question: true }) },
          { level: 2, message: 'm', checks: checks({ statedNumbers: ['14'] }) },
          { level: 3, message: 'm', checks: checks({ namesOperation: true }) },
        ]),
        result([
          { level: 1, message: 'm', checks: checks({ question: false }) },
          {
            level: 3,
            message: 'm',
            checks: checks({ namesOperation: true, computedLines: ['33 = 33'] }),
          },
        ]),
      ],
      [],
    );
    expect(s.level1Question).toEqual({ ok: 1, total: 2 });
    expect(s.noValue).toEqual({ ok: 4, total: 5 });
    expect(s.noComputedLine).toEqual({ ok: 4, total: 5 });
    expect(s.level3OperationsOnly).toEqual({ ok: 1, total: 2 });
  });

  it('names what a hint broke', () => {
    const h: CheckHintResult = {
      level: 3,
      message: 'm',
      checks: checks({ statedNumbers: ['33'], namesOperation: false }),
    };
    expect(checkViolations(h, 'en')).toEqual(['states 33', 'level 3 does not name the operations']);
  });
});
