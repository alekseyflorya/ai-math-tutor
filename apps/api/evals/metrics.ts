import { ERROR_TYPES, type ErrorType, type Locale } from '@tutor/shared';
import type { AttemptReport } from '../src/llm/structured-call';
import type { DetectedLanguage } from './checks';

/** Rule checks on one tutor message. */
export interface HintChecks {
  /** Level 1 only. */
  question?: boolean;
  revealsAnswer: boolean;
  /** Level 3 when the corrected step IS the final line: showing "x = 7" is then the step itself. */
  answerAllowed: boolean;
  /** Level 3 only. */
  correctedStep?: { shows: boolean; newLines: number };
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
export function level3Passes(c: HintChecks): boolean {
  const step = c.correctedStep;
  return Boolean(step?.shows) && step!.newLines <= 1 && (!c.revealsAnswer || c.answerAllowed);
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
      noFinalAnswer: count(hints, (h) => !h.checks.revealsAnswer || h.checks.answerAllowed),
      level3CorrectedOnly: count(
        hints.filter((h) => h.level === 3),
        (h) => level3Passes(h.checks),
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
  if (c.revealsAnswer && !c.answerAllowed) out.push('reveals the final answer');
  if (h.level === 3 && !level3Passes(c)) {
    if (!c.correctedStep?.shows) out.push('level 3 does not show the corrected step');
    else if (c.correctedStep.newLines > 1)
      out.push(`level 3 goes beyond the step (${c.correctedStep.newLines} new lines)`);
  }
  if (c.language !== locale) out.push(`language ${c.language}, expected ${locale}`);
  if (!c.latexIntact) out.push('LaTeX broken by JSON escaping (repaired before use)');
  return out;
}
