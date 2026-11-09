/**
 * Offline eval of the AI part against a real model (no database, no API server):
 *
 *   pnpm eval [--model gemini-3.5-flash] [--limit 10] [--concurrency 2] [--only SIGN_TRANSFER | CHECK]
 *   pnpm eval --rescore evals/reports/<file>.json   (re-apply the checks to saved answers, offline)
 *   pnpm eval --resume evals/reports/<file>.json    (finish a run cut short by the daily quota)
 *
 * For every case in evals/cases.ts: the diagnosis (= hint level 1) and hint levels 2 and 3, built
 * with the production prompt functions and zod schemas and sent through `callStructured` — the
 * same validation and retry the API uses. Then every case in evals/check-cases.ts: a slip while
 * checking the answer by substitution, with its three hint levels. Writes
 * evals/reports/<date>-<model>.md (+ .json).
 * Reads keys from the repo-root .env, like `pnpm smoke:llm`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  checkStep,
  checkSubstitution,
  ERROR_TYPES,
  isFinalForm,
  isLatexIntact,
  parseEquation,
  solve,
} from '@tutor/shared';
import { CASES, validateCases, type EvalCase } from '../evals/cases';
import {
  CHECK_CASES,
  checkFacts,
  hiddenNumbers,
  validateCheckCases,
  type CheckCase,
} from '../evals/check-cases';
import {
  computedCheckLines,
  correctedStep,
  detectLanguage,
  isQuestion,
  namesOperation,
  revealsAnswer,
  statedNumbers,
} from '../evals/checks';
import {
  checkViolations,
  summarize,
  summarizeChecks,
  violations,
  type CallRecord,
  type CaseResult,
  type CheckCaseResult,
  type CheckHintResult,
  type HintChecks,
  type HintResult,
} from '../evals/metrics';
import { renderReport, type RunInfo } from '../evals/report';
import { LlmUnavailableError, type LlmJsonRequest, type LlmProvider } from '../src/llm/llm.types';
import {
  checkDiagnosePrompt,
  diagnosePrompt,
  hintPrompt,
  systemPrompt,
  type TutorContext,
} from '../src/llm/prompts';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';
import { callStructured, type AttemptReport } from '../src/llm/structured-call';
import {
  CheckDiagnosisSchema,
  DiagnosisSchema,
  FeedbackSchema,
  type Diagnosis,
} from '../src/llm/tutor-schemas';
import { notices } from '../src/tutor/notices';
import { DEFAULT_GEMINI_MODEL_DIAGNOSIS } from '../src/config/env';
import { loadRootEnv } from './load-env';

loadRootEnv();

const { values: args } = parseArgs({
  args: process.argv.slice(2).filter((a) => a !== '--'),
  options: {
    model: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '2' },
    only: { type: 'string' },
    out: { type: 'string', default: join(__dirname, '..', 'evals', 'reports') },
    rescore: { type: 'string' },
    resume: { type: 'string' },
  },
});

const env = (key: string, fallback: string) => process.env[key] ?? fallback;
const TIMEOUT_MS = Number(env('LLM_TIMEOUT_MS', '15000'));
const TURN_BUDGET_MS = Number(env('LLM_TURN_BUDGET_MS', '25000'));
const MAX_RATE_LIMIT_RETRIES = 6;

function makeProvider(): LlmProvider {
  if (env('LLM_PROVIDER', 'gemini') === 'anthropic') {
    const key = process.env.ANTHROPIC_API_KEY;
    if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
    return new AnthropicProvider(key, args.model ?? env('ANTHROPIC_MODEL', 'claude-haiku-5-5'));
  }
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY is not set');
  // One model only: the retry must not fall back to another model, or we would measure a mix.
  // The eval makes diagnosis and hint calls only, so by default it measures the primary model of
  // GEMINI_MODEL_DIAGNOSIS, as in production.
  const model =
    args.model ??
    env('GEMINI_MODEL_DIAGNOSIS', DEFAULT_GEMINI_MODEL_DIAGNOSIS).split(',')[0]!.trim();
  return new GeminiProvider(key, model);
}

function selectCases(): EvalCase[] {
  let cases = CASES;
  if (args.only === 'CHECK') return [];
  if (args.only) {
    if (!(ERROR_TYPES as readonly string[]).includes(args.only)) {
      throw new Error(`--only must be one of ${ERROR_TYPES.join(', ')}, CHECK`);
    }
    cases = cases.filter((k) => k.expectedErrorType === args.only);
  }
  if (args.limit) cases = cases.slice(0, Number(args.limit));
  return cases;
}

/** The check-by-substitution cases: all of them, unless --only names an error type. */
function selectCheckCases(): CheckCase[] {
  if (args.only && args.only !== 'CHECK') return [];
  return args.limit ? CHECK_CASES.slice(0, Number(args.limit)) : CHECK_CASES;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The free tier allows ~20 requests per model per day: no point retrying, stop the run. */
class DailyQuotaError extends Error {}

/**
 * One production-equivalent call. The free tier rate-limits hard, so a 429 that survives
 * callStructured's own short retry is retried here with exponential backoff.
 */
async function call<T>(
  provider: LlmProvider,
  calls: CallRecord[],
  caseId: string,
  purpose: CallRecord['purpose'],
  req: Omit<LlmJsonRequest<T>, 'deadline'>,
): Promise<{ value: T; latexIntact: boolean }> {
  const attempts: AttemptReport[] = [];
  const record = (ok: boolean) => calls.push({ caseId, purpose, ok, attempts });
  for (let retry = 0; ; retry++) {
    try {
      const out = await callStructured(
        provider,
        { ...req, deadline: Date.now() + TURN_BUDGET_MS },
        { timeoutMs: TIMEOUT_MS, onAttempt: (a) => void attempts.push(a) },
      );
      record(true);
      // Measured on the raw answer, before callStructured repairs it.
      return { value: out, latexIntact: attempts.at(-1)?.latexIntact ?? true };
    } catch (e) {
      const limited = e instanceof LlmUnavailableError && e.reason === 'rate_limited';
      if (limited && /per ?day/i.test(e.message)) {
        throw new DailyQuotaError(`Daily quota of ${provider.model} is used up`, { cause: e });
      }
      if (!limited || retry >= MAX_RATE_LIMIT_RETRIES) {
        record(false);
        throw e;
      }
      // Gemini says how long to wait ("Please retry in 41.2s"); otherwise back off exponentially.
      const hinted = /retry in ([\d.]+)\s*s/i.exec((e as Error).message)?.[1];
      const wait =
        (hinted ? Number(hinted) * 1000 : Math.min(60_000, 5000 * 2 ** retry)) +
        Math.random() * 1000;
      console.warn(`  429 — waiting ${(wait / 1000).toFixed(0)} s`);
      await sleep(wait);
    }
  }
}

function checkMessage(
  k: EvalCase,
  level: 1 | 2 | 3,
  message: string,
): Omit<HintChecks, 'latexIntact'> {
  const sol = solve(parseEquation(k.problem));
  if (sol.kind !== 'unique') throw new Error(`${k.id}: the problem has no unique solution`);
  return {
    revealsAnswer: revealsAnswer(message, sol.value),

    language: detectLanguage(message),
    ...(level === 1 ? { question: isQuestion(message) } : {}),
    ...(level === 3
      ? {
          correctedStep: correctedStep(message, k),
          // "4x = 20 → x = 5": level 3 names the operation instead of showing the answer.
          finalStep: isFinalForm(parseEquation(k.correctStep)),
          namesOperation: namesOperation(message),
        }
      : {}),
  };
}

/** (Re)applies the rule checks to the messages of a case. */
function score(k: EvalCase, r: CaseResult): CaseResult {
  return {
    ...r,
    hints: r.hints.map(({ checks: _old, ...h }) =>
      h.message === null
        ? h
        : {
            ...h,
            checks: {
              ...checkMessage(k, h.level, h.message),
              // Raw flag from the run; reports from before the repair stored raw messages.
              latexIntact: h.latexIntact ?? isLatexIntact(h.message),
            },
          },
    ),
  };
}

async function runCase(
  provider: LlmProvider,
  k: EvalCase,
  calls: CallRecord[],
): Promise<CaseResult> {
  const check = checkStep(k.previousLine, k.wrongStep);
  const system = systemPrompt(k.locale);

  // What the API builds on a wrong step: the step is in the history and the dialogue.
  const base: TutorContext = {
    locale: k.locale,
    problem: k.problem,
    currentLine: k.previousLine,
    steps: [
      ...(k.previousLine !== k.problem ? [{ input: k.previousLine, isCorrect: true }] : []),
      { input: k.wrongStep, isCorrect: false },
    ],
    mode: 'SOLVING',
    hintLevel: 1,
    activeMistake: null,
    recentDialogue: [{ role: 'Student', content: k.wrongStep }],
    isFollowUp: false,
    history: { solvedProblems: 0, mistakes: [] },
  };

  const result: CaseResult = {
    id: k.id,
    locale: k.locale,
    expected: k.expectedErrorType,
    predicted: null,
    hints: [],
  };

  let diagnosis: Diagnosis;
  let diagnosisLatexIntact: boolean;
  try {
    ({ value: diagnosis, latexIntact: diagnosisLatexIntact } = await call(
      provider,
      calls,
      k.id,
      'diagnose',
      {
        purpose: 'diagnose',
        system,
        prompt: diagnosePrompt(base, k.wrongStep, check.facts, 1),
        schema: DiagnosisSchema,
        temperature: 0.3,
      },
    ));
  } catch (e) {
    if (e instanceof DailyQuotaError) throw e;
    result.hints.push({ level: 1, message: null, error: (e as Error).message });
    return score(k, result);
  }
  result.predicted = diagnosis.errorType;
  result.misconception = diagnosis.misconception;
  const hint = (level: 1 | 2 | 3, message: string, latexIntact: boolean): HintResult => ({
    level,
    message,
    latexIntact,
  });
  result.hints.push(hint(1, diagnosis.message, diagnosisLatexIntact));

  // "Hint" pressed twice while fixing the mistake: levels 2 and 3, as TutorService.hint builds them.
  const dialogue: TutorContext['recentDialogue'] = [
    ...base.recentDialogue,
    { role: 'Tutor', content: diagnosis.message },
  ];
  for (const level of [2, 3] as const) {
    const ctx: TutorContext = {
      ...base,
      mode: 'REMEDIATION',
      hintLevel: level,
      activeMistake: {
        errorType: diagnosis.errorType,
        description: diagnosis.misconception,
        stepInput: k.wrongStep,
        previousLine: k.previousLine,
      },
      recentDialogue: [...dialogue],
    };
    try {
      const { value: out, latexIntact } = await call(provider, calls, k.id, 'hint', {
        purpose: 'hint',
        system,
        prompt: hintPrompt(ctx, level),
        schema: FeedbackSchema,
      });
      result.hints.push(hint(level, out.message, latexIntact));
      dialogue.push({ role: 'Tutor', content: out.message });
    } catch (e) {
      if (e instanceof DailyQuotaError) throw e;
      result.hints.push({ level, message: null, error: (e as Error).message });
    }
  }
  return score(k, result);
}

function checkMessageRules(
  k: CheckCase,
  level: 1 | 2 | 3,
  message: string,
): Omit<CheckHintResult['checks'] & object, 'latexIntact'> {
  return {
    statedNumbers: statedNumbers(message, hiddenNumbers(k)),
    computedLines: computedCheckLines(message, k),
    language: detectLanguage(message),
    ...(level === 1 ? { question: isQuestion(message) } : {}),
    ...(level === 3 ? { namesOperation: namesOperation(message) } : {}),
  };
}

function scoreCheck(k: CheckCase, r: CheckCaseResult): CheckCaseResult {
  return {
    ...r,
    hints: r.hints.map(({ checks: _old, ...h }) =>
      h.message === null
        ? h
        : {
            ...h,
            checks: {
              ...checkMessageRules(k, h.level, h.message),
              latexIntact: h.latexIntact ?? isLatexIntact(h.message),
            },
          },
    ),
  };
}

/**
 * A slip in the check, as the API handles it: the diagnosis (`checkDiagnosePrompt`, level 1) in
 * CHECKING, then "Hint" twice with the slip as the mistake being worked on (the check's ladder).
 */
async function runCheckCase(
  provider: LlmProvider,
  k: CheckCase,
  calls: CallRecord[],
): Promise<CheckCaseResult> {
  const { root } = checkFacts(k);
  const solution = `x = ${root}`;
  const { facts } = checkSubstitution(k.problem, k.slip, { afterCheckLine: true });
  const system = systemPrompt(k.locale);
  const base: TutorContext = {
    locale: k.locale,
    problem: k.problem,
    currentLine: solution,
    steps: [
      { input: solution, isCorrect: true, phase: 'SOLUTION' },
      { input: k.substituted, isCorrect: true, phase: 'CHECK' },
      { input: k.slip, isCorrect: false, phase: 'CHECK' },
    ],
    mode: 'CHECKING',
    hintLevel: 1,
    activeMistake: null,
    recentDialogue: [
      { role: 'Student', content: k.substituted },
      { role: 'Tutor', content: notices.checkStepOk(k.locale) },
      { role: 'Student', content: k.slip },
    ],
    isFollowUp: false,
    checking: { solution },
    history: { solvedProblems: 0, mistakes: [] },
  };
  const result: CheckCaseResult = {
    id: k.id,
    locale: k.locale,
    side: k.side,
    operation: k.operation,
    hints: [],
  };

  let misconception: string;
  try {
    const { value, latexIntact } = await call(provider, calls, k.id, 'diagnose', {
      purpose: 'diagnose',
      system,
      prompt: checkDiagnosePrompt(base, k.slip, facts, 1),
      schema: CheckDiagnosisSchema,
      temperature: 0.3,
    });
    misconception = value.misconception;
    result.misconception = misconception;
    result.hints.push({ level: 1, message: value.message, latexIntact });
  } catch (e) {
    if (e instanceof DailyQuotaError) throw e;
    result.hints.push({ level: 1, message: null, error: (e as Error).message });
    return scoreCheck(k, result);
  }

  const dialogue = [
    ...base.recentDialogue,
    { role: 'Tutor' as const, content: result.hints[0]!.message! },
  ];
  for (const level of [2, 3] as const) {
    const ctx: TutorContext = {
      ...base,
      hintLevel: level,
      activeMistake: {
        errorType: 'ARITHMETIC',
        description: misconception,
        stepInput: k.slip,
        previousLine: k.substituted,
        phase: 'CHECK',
      },
      recentDialogue: [...dialogue],
    };
    try {
      const { value, latexIntact } = await call(provider, calls, k.id, 'hint', {
        purpose: 'hint',
        system,
        prompt: hintPrompt(ctx, level),
        schema: FeedbackSchema,
      });
      result.hints.push({ level, message: value.message, latexIntact });
      dialogue.push({ role: 'Tutor', content: value.message });
    } catch (e) {
      if (e instanceof DailyQuotaError) throw e;
      result.hints.push({ level, message: null, error: (e as Error).message });
    }
  }
  return scoreCheck(k, result);
}

async function pool<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, size) }, worker));
  return out;
}

function today(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

interface CheckPart {
  results: CheckCaseResult[];
  calls: CallRecord[];
}

function write(
  base: string,
  info: RunInfo,
  results: CaseResult[],
  calls: CallRecord[],
  check: CheckPart = { results: [], calls: [] },
) {
  const summary = summarize(results, calls);
  const checkSummary = summarizeChecks(check.results, check.calls);
  writeFileSync(
    `${base}.md`,
    renderReport(info, summary, results, { summary: checkSummary, results: check.results }),
  );
  const json = {
    info,
    summary,
    results,
    calls,
    checkSummary,
    checkResults: check.results,
    checkCalls: check.calls,
  };
  writeFileSync(`${base}.json`, `${JSON.stringify(json, null, 2)}\n`);
  if (info.complete !== false) {
    console.log(
      `\nError type accuracy ${summary.accuracy.ok}/${summary.accuracy.total}; check hints: ` +
        `L3 ${checkSummary.level3OperationsOnly.ok}/${checkSummary.level3OperationsOnly.total}, ` +
        `no value ${checkSummary.noValue.ok}/${checkSummary.noValue.total}. Report: ${base}.md`,
    );
  }
}

/** "<date>-<model>", or "-2", "-3"… when a report of that day already exists. */
function freshBase(base: string): string {
  let candidate = base;
  for (let n = 2; existsSync(`${candidate}.json`); n++) candidate = `${base}-${n}`;
  return candidate;
}

/** Re-scores saved answers with the current checks: no model calls. */
function rescore(file: string) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as {
    info: RunInfo;
    results: CaseResult[];
    calls?: CallRecord[];
    checkResults?: CheckCaseResult[];
    checkCalls?: CallRecord[];
  };
  if (!saved.calls) throw new Error(`${file} has no raw calls (written by an older version)`);
  const byId = new Map(CASES.map((k) => [k.id, k]));
  const results = saved.results.map((r) => {
    const k = byId.get(r.id);
    if (!k) throw new Error(`Case ${r.id} no longer exists`);
    return score(k, r);
  });
  const checkById = new Map(CHECK_CASES.map((k) => [k.id, k]));
  const checkResults = (saved.checkResults ?? []).map((r) => {
    const k = checkById.get(r.id);
    if (!k) throw new Error(`Check case ${r.id} no longer exists`);
    return scoreCheck(k, r);
  });
  // Next to the original, which stays as it was measured.
  write(`${file.replace(/(-rescored)?\.json$/, '')}-rescored`, saved.info, results, saved.calls, {
    results: checkResults,
    calls: saved.checkCalls ?? [],
  });
}

interface Saved {
  info: RunInfo;
  results: CaseResult[];
  calls: CallRecord[];
  checkResults?: CheckCaseResult[];
  checkCalls?: CallRecord[];
}

/** A case is done when the diagnosis and all three hint levels came back. */
const done = (r: CaseResult) =>
  r.predicted !== null && r.hints.length === 3 && r.hints.every((h) => h.message !== null);
const checkDone = (r: CheckCaseResult) =>
  r.hints.length === 3 && r.hints.every((h) => h.message !== null);

async function main() {
  validateCases(CASES); // an invalid case is a bug in the eval, not a model failure
  validateCheckCases(CHECK_CASES);
  if (args.rescore) return rescore(args.rescore);

  let saved: Saved | null = null;
  if (args.resume) {
    if (!existsSync(args.resume)) throw new Error(`${args.resume} does not exist`);
    saved = JSON.parse(readFileSync(args.resume, 'utf8')) as Saved;
    args.model = saved.info.model;
  }
  const provider = makeProvider();
  const kept = (saved?.results ?? []).filter(done);
  const keptIds = new Set(kept.map((r) => r.id));
  const cases = selectCases().filter((k) => !keptIds.has(k.id));
  const keptChecks = (saved?.checkResults ?? []).filter(checkDone);
  const keptCheckIds = new Set(keptChecks.map((r) => r.id));
  const checkCases = selectCheckCases().filter((k) => !keptCheckIds.has(k.id));
  const concurrency = Number(args.concurrency);
  console.log(
    `Eval: ${provider.name} / ${provider.model}, ${cases.length} cases + ${checkCases.length} check cases to run` +
      `${kept.length + keptChecks.length ? ` (+${kept.length + keptChecks.length} done earlier)` : ''}, concurrency ${concurrency}`,
  );

  const info: RunInfo = saved?.info ?? {
    date: today(),
    provider: provider.name,
    model: provider.model,
    concurrency,
    durationMs: 0,
    filter: args.only,
  };
  mkdirSync(args.out, { recursive: true });
  const base = args.resume
    ? args.resume.replace(/\.json$/, '')
    : freshBase(join(args.out, `${info.date}-${provider.model.replace(/[^\w.-]+/g, '_')}`));
  // Calls of cases that are re-run are dropped with them; the rest stay in the totals.
  const calls: CallRecord[] = saved
    ? saved.calls.filter((c) => !c.caseId || keptIds.has(c.caseId))
    : [];
  const fresh: CaseResult[] = [];
  const checkCalls: CallRecord[] = saved
    ? (saved.checkCalls ?? []).filter((c) => !c.caseId || keptCheckIds.has(c.caseId))
    : [];
  const freshChecks: CheckCaseResult[] = [];
  const checkOrder = new Map(CHECK_CASES.map((k, i) => [k.id, i]));
  const allChecks = () =>
    [...keptChecks, ...freshChecks].sort(
      (a, b) => (checkOrder.get(a.id) ?? 0) - (checkOrder.get(b.id) ?? 0),
    );
  const started = Date.now();
  const order = new Map(CASES.map((k, i) => [k.id, i]));
  const all = () =>
    [...kept, ...fresh].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  const snapshot = (complete: boolean) =>
    write(
      base,
      { ...info, durationMs: info.durationMs + Date.now() - started, complete },
      all(),
      calls,
      { results: allChecks(), calls: checkCalls },
    );

  try {
    await pool(cases, concurrency, async (k) => {
      const r = await runCase(provider, k, calls);
      fresh.push(r);
      const broken = r.hints.flatMap((h) =>
        violations(h, r.locale).map((v) => `L${h.level}: ${v}`),
      );
      const mark = r.predicted === r.expected ? '✓' : '✗';
      console.log(
        `${mark} ${r.id.padEnd(9)} ${r.expected} → ${r.predicted ?? 'failed'}${broken.length ? `  [${broken.join('; ')}]` : ''}`,
      );
      snapshot(false); // checkpoint: a quota stop loses at most the cases in flight
    });
    await pool(checkCases, concurrency, async (k) => {
      const r = await runCheckCase(provider, k, checkCalls);
      freshChecks.push(r);
      const broken = r.hints.flatMap((h) =>
        checkViolations(h, r.locale).map((v) => `L${h.level}: ${v}`),
      );
      console.log(
        `${broken.length ? '✗' : '✓'} ${r.id.padEnd(9)} ${r.side}/${r.operation}${broken.length ? `  [${broken.join('; ')}]` : ''}`,
      );
      snapshot(false);
    });
  } catch (e) {
    if (!(e instanceof DailyQuotaError)) throw e;
    snapshot(false);
    console.error(
      `\n${e.message}. Partial results saved; continue later with:\n  pnpm eval --resume ${base}.json`,
    );
    process.exit(2);
  }
  snapshot(all().every(done) && allChecks().every(checkDone));
}

main().catch((e: unknown) => {
  console.error('\nEval failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
