import { ERROR_TYPES, type ErrorType, type Locale } from '@tutor/shared';
import type { AttemptReport } from '../src/llm/structured-call';
import type { DetectedLanguage } from './checks';

/** Rule checks on one tutor message. */
export interface HintChecks {
  /** Level 1 only. */
  question?: boolean;
  revealsAnswer: boolean;
  /**
   * Level 3 when the corrected step is already the answer ("4x = 20 → x = 5"): then level 3 must not
   * show it, but name the operation and the line instead.
   */
  finalStep?: boolean;
  /** Level 3: names an operation ("divide both sides … by 4"). */
  namesOperation?: boolean;
  /** Level 3 only. */
  correctedStep?: { shows: boolean; newLines: number };
  /** Level 2 only: the student's numbers used outside a quote of their work. */
  level2StudentNumbers?: string[];
  language: DetectedLanguage;
  /** The model's LaTeX survived JSON escaping (checked before the repair). */
  latexIntact: boolean;
}

export interface HintResult {
  level: 1 | 2 | 3;
  message: string | null;
  /** Raw LaTeX check, recorded by the run (the stored message is already repaired). */
  latexIntact?: boolean;
  error?: string;
  checks?: HintChecks;
}

export interface CaseResult {
  id: string;
  locale: Locale;
  expected: ErrorType;
  /** null when the diagnosis call failed */
  predicted: ErrorType | null;
  misconception?: string;
  hints: HintResult[];
}

export interface CallRecord {
  /** Absent in reports written before --resume existed. */
  caseId?: string;
  purpose: 'diagnose' | 'hint';
  ok: boolean;
  attempts: AttemptReport[];
}

export interface Rate {
  ok: number;
  total: number;
}

export interface Summary {
  cases: number;
  accuracy: Rate;
  byType: Record<ErrorType, Rate>;
  byLocale: Record<Locale, Rate>;
  /** confusion[expected][predicted | 'FAILED'] */
  confusion: Record<ErrorType, Record<ErrorType | 'FAILED', number>>;
  /** Model attempts whose output failed JSON/zod validation, out of attempts that answered. */
  invalidJson: Rate;
  /** Calls that still failed after the retry (any reason), out of all calls. */
  failedCalls: Rate;
  latency: {
    p50: number;
    p95: number;
    byPurpose: Record<CallRecord['purpose'], { p50: number; p95: number }>;
  };
  rules: {
    level1Question: Rate;
    noFinalAnswer: Rate;
    level3CorrectedOnly: Rate;
    /** Level 2 illustrates on other numbers and states no value from the student's line. */
    level2OtherNumbers: Rate;
    language: Rate;
    latexIntact: Rate;
  };
}

export const rate = (ok: number, total: number): Rate => ({ ok, total });
export const pct = (r: Rate) => (r.total === 0 ? 'n/a' : `${((100 * r.ok) / r.total).toFixed(1)}%`);

/** Nearest-rank percentile; 0 for an empty list. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length, Math.max(1, rank)) - 1]!;
}

const count = <T>(xs: readonly T[], f: (x: T) => boolean): Rate =>
  rate(xs.filter(f).length, xs.length);

/** Level 3 passes when it shows the corrected step, nothing beyond it, and no answer. */
/**
 * Level 3 passes when it shows the corrected step and nothing beyond it, or, when that step is the
 * answer, names the operation to do. Either way it must not give the answer away.
 */
export function level3Passes(c: HintChecks): boolean {
  if (c.revealsAnswer) return false;
  const step = c.correctedStep;
  const showsStep = Boolean(step?.shows) && step!.newLines <= 1;
  return showsStep || (Boolean(c.finalStep) && Boolean(c.namesOperation));
}

export function summarize(results: readonly CaseResult[], calls: readonly CallRecord[]): Summary {
  const zeroRow = () =>
    Object.fromEntries([...ERROR_TYPES, 'FAILED'].map((t) => [t, 0])) as Record<
      ErrorType | 'FAILED',
      number
    >;
  const confusion = Object.fromEntries(
    ERROR_TYPES.map((t) => [t, zeroRow()]),
  ) as Summary['confusion'];
  for (const r of results) confusion[r.expected][r.predicted ?? 'FAILED']++;

  const hit = (r: CaseResult) => r.predicted === r.expected;
  const byType = Object.fromEntries(
    ERROR_TYPES.map((t) => [
      t,
      count(
        results.filter((r) => r.expected === t),
        hit,
      ),
    ]),
  ) as Record<ErrorType, Rate>;
  const byLocale = Object.fromEntries(
    (['en', 'uk'] as const).map((l) => [
      l,
      count(
        results.filter((r) => r.locale === l),
        hit,
      ),
    ]),
  ) as Record<Locale, Rate>;

  const attempts = calls.flatMap((c) => c.attempts.map((a) => ({ ...a, purpose: c.purpose })));
  const answered = attempts.filter((a) => a.ok || a.reason === 'invalid_output');
  const okLatency = (purpose?: CallRecord['purpose']) =>
    attempts.filter((a) => a.ok && (!purpose || a.purpose === purpose)).map((a) => a.latencyMs);
  const pp = (xs: number[]) => ({ p50: percentile(xs, 50), p95: percentile(xs, 95) });

  const hints = results.flatMap((r) =>
    r.hints
      .filter((h) => h.checks)
      .map((h) => ({ level: h.level, checks: h.checks!, locale: r.locale })),
  );
  return {
    cases: results.length,
    accuracy: count(results, hit),
    byType,
    byLocale,
    confusion,
    invalidJson: count(answered, (a) => a.reason === 'invalid_output'),
    failedCalls: count(calls, (c) => !c.ok),
    latency: {
      ...pp(okLatency()),
      byPurpose: { diagnose: pp(okLatency('diagnose')), hint: pp(okLatency('hint')) },
    },
    rules: {
      level1Question: count(
        hints.filter((h) => h.level === 1),
        (h) => h.checks.question === true,
      ),
      noFinalAnswer: count(hints, (h) => !h.checks.revealsAnswer),
      level3CorrectedOnly: count(
        hints.filter((h) => h.level === 3),
        (h) => level3Passes(h.checks),
      ),
      level2OtherNumbers: count(
        hints.filter((h) => h.level === 2 && h.checks.level2StudentNumbers),
        (h) => h.checks.level2StudentNumbers!.length === 0,
      ),
      language: count(hints, (h) => h.checks.language === h.locale),
      latexIntact: count(hints, (h) => h.checks.latexIntact),
    },
  };
}

/** Which rules a message broke, for the report's failure list. */
export function violations(h: HintResult, locale: Locale): string[] {
  if (!h.checks) return h.error ? [`call failed: ${h.error}`] : [];
  const c = h.checks;
  const out: string[] = [];
  if (h.level === 1 && !c.question) out.push('level 1 is not a question');
  if (c.revealsAnswer) out.push('reveals the final answer');
  if (h.level === 3 && !c.revealsAnswer && !level3Passes(c)) {
    if (c.finalStep) out.push('level 3 neither shows the step nor names the operation');
    else if (!c.correctedStep?.shows) out.push('level 3 does not show the corrected step');
    else if (c.correctedStep.newLines > 1)
      out.push(`level 3 goes beyond the step (${c.correctedStep.newLines} new lines)`);
  }
  if (c.level2StudentNumbers?.length) {
    out.push(`level 2 uses the student's numbers: ${c.level2StudentNumbers.join(', ')}`);
  }
  if (c.language !== locale) out.push(`language ${c.language}, expected ${locale}`);
  if (!c.latexIntact) out.push('LaTeX broken by JSON escaping (repaired before use)');
  return out;
}

// --- Check by substitution ---------------------------------------------------------------------

/** Rule checks on one hint for a slip in the check. */
export interface CheckHintChecks {
  /** Level 1 only. */
  question?: boolean;
  /** Hidden numbers stated (value of a side, result of the slipped operation). */
  statedNumbers: string[];
  /** Values the API's guard forbids that the final message still states (0 by design). */
  guardLeaks?: string[];
  /**
   * The guard acted although every number it caught is written in the equation or the student's
   * lines: a false positive.
   */
  guardFalsePositive?: boolean;
  /** Right check lines computed for the student. */
  computedLines: string[];
  /** Level 3: names the operations to carry out. */
  namesOperation?: boolean;
  /** Level 2 only: the student's numbers used outside a quote of their work. */
  level2StudentNumbers?: string[];
  language: DetectedLanguage;
  latexIntact: boolean;
}

export interface CheckHintResult {
  level: 1 | 2 | 3;
  message: string | null;
  latexIntact?: boolean;
  error?: string;
  /** The API's guard: the model was asked again, or the fixed hint replaced it. */
  guard?: 'retried' | 'template' | null;
  /** What the model stated before the guard acted. */
  guardLeaked?: string[];
  checks?: CheckHintChecks;
}

export interface CheckCaseResult {
  id: string;
  locale: Locale;
  side: 'left' | 'right';
  operation: 'multiplication' | 'addition';
  /** The equation itself shows the value of the sides (x + 5 = 12). */
  equationShowsValue?: boolean;
  misconception?: string;
  hints: CheckHintResult[];
}

export interface CheckSummary {
  cases: number;
  level1Question: Rate;
  /** No level states the value of a side or the slipped operation's result. */
  noValue: Rate;
  /** No level shows a computed check line. */
  noComputedLine: Rate;
  /** Level 3 lists the operations, with no results. */
  level3OperationsOnly: Rate;
  /** Level 2 illustrates on other numbers and states no value from the student's line. */
  level2OtherNumbers: Rate;
  language: Rate;
  latexIntact: Rate;
  invalidJson: Rate;
  failedCalls: Rate;
  latency: { p50: number; p95: number };
  /** Hints where the guard acted, and how. */
  guard: { retried: number; template: number; hints: number };
  /** Final messages free of every value the guard forbids. */
  noLeakAfterGuard: Rate;
  /** Guard triggers that caught only numbers written in the equation or the student's lines. */
  guardFalsePositives: Rate;
}

export const checkLevel3Passes = (c: CheckHintChecks) =>
  Boolean(c.namesOperation) && c.statedNumbers.length === 0 && c.computedLines.length === 0;

export function summarizeChecks(
  results: readonly CheckCaseResult[],
  calls: readonly CallRecord[],
): CheckSummary {
  const hints = results.flatMap((r) =>
    r.hints
      .filter((h) => h.checks)
      .map((h) => ({ level: h.level, checks: h.checks!, locale: r.locale })),
  );
  const attempts = calls.flatMap((c) => c.attempts);
  const answered = attempts.filter((a) => a.ok || a.reason === 'invalid_output');
  const latencies = attempts.filter((a) => a.ok).map((a) => a.latencyMs);
  return {
    cases: results.length,
    level1Question: count(
      hints.filter((h) => h.level === 1),
      (h) => h.checks.question === true,
    ),
    noValue: count(hints, (h) => h.checks.statedNumbers.length === 0),
    noComputedLine: count(hints, (h) => h.checks.computedLines.length === 0),
    level3OperationsOnly: count(
      hints.filter((h) => h.level === 3),
      (h) => checkLevel3Passes(h.checks),
    ),
    level2OtherNumbers: count(
      hints.filter((h) => h.level === 2 && h.checks.level2StudentNumbers),
      (h) => h.checks.level2StudentNumbers!.length === 0,
    ),
    language: count(hints, (h) => h.checks.language === h.locale),
    latexIntact: count(hints, (h) => h.checks.latexIntact),
    invalidJson: count(answered, (a) => a.reason === 'invalid_output'),
    failedCalls: count(calls, (c) => !c.ok),
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    guard: {
      retried: results.flatMap((r) => r.hints).filter((h) => h.guard === 'retried').length,
      template: results.flatMap((r) => r.hints).filter((h) => h.guard === 'template').length,
      hints: hints.length,
    },
    noLeakAfterGuard: count(hints, (h) => (h.checks.guardLeaks ?? []).length === 0),
    guardFalsePositives: count(
      results.flatMap((r) => r.hints).filter((h) => h.guard && h.checks),
      (h) => h.checks!.guardFalsePositive === true,
    ),
  };
}

/** Which rules a hint for a slip in the check broke. */
export function checkViolations(h: CheckHintResult, locale: Locale): string[] {
  if (!h.checks) return h.error ? [`call failed: ${h.error}`] : [];
  const c = h.checks;
  const out: string[] = [];
  if (h.level === 1 && !c.question) out.push('level 1 is not a question');
  if (c.statedNumbers.length) out.push(`states ${c.statedNumbers.join(', ')}`);
  if (c.guardLeaks?.length) out.push(`leaks past the guard: ${c.guardLeaks.join(', ')}`);
  if (c.guardFalsePositive) {
    out.push(`guard false positive: ${(h.guardLeaked ?? []).join(', ')} is written already`);
  }
  if (c.computedLines.length) out.push(`shows a computed line: ${c.computedLines.join('; ')}`);
  if (h.level === 3 && !c.namesOperation) out.push('level 3 does not name the operations');
  if (c.level2StudentNumbers?.length) {
    out.push(`level 2 uses the student's numbers: ${c.level2StudentNumbers.join(', ')}`);
  }
  if (c.language !== locale) out.push(`language ${c.language}, expected ${locale}`);
  if (!c.latexIntact) out.push('LaTeX broken by JSON escaping (repaired before use)');
  return out;
}
