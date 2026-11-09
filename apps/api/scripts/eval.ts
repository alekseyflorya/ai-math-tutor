/**
 * Offline eval of the AI part against a real model (no database, no API server):
 *
 *   pnpm eval [--model gemini-3.5-flash] [--limit 10] [--concurrency 2] [--only SIGN_TRANSFER]
 *   pnpm eval --rescore evals/reports/<file>.json   (re-apply the checks to saved answers, offline)
 *   pnpm eval --resume evals/reports/<file>.json    (finish a run cut short by the daily quota)
 *
 * For every case in evals/cases.ts: the diagnosis (= hint level 1) and hint levels 2 and 3, built
 * with the production prompt functions and zod schemas and sent through `callStructured` — the
 * same validation and retry the API uses. Writes evals/reports/<date>-<model>.md (+ .json).
 * Reads keys from the repo-root .env, like `pnpm smoke:llm`.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import {
  checkStep,
  ERROR_TYPES,
  isFinalForm,
  isLatexIntact,
  parseEquation,
  solve,
} from '@tutor/shared';
import { CASES, validateCases, type EvalCase } from '../evals/cases';
import { correctedStep, detectLanguage, isQuestion, revealsAnswer } from '../evals/checks';
import {
  summarize,
  violations,
  type CallRecord,
  type CaseResult,
  type HintChecks,
  type HintResult,
} from '../evals/metrics';
import { renderReport, type RunInfo } from '../evals/report';
import { LlmUnavailableError, type LlmJsonRequest, type LlmProvider } from '../src/llm/llm.types';
import { diagnosePrompt, hintPrompt, systemPrompt, type TutorContext } from '../src/llm/prompts';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';
import { callStructured, type AttemptReport } from '../src/llm/structured-call';
import { DiagnosisSchema, FeedbackSchema, type Diagnosis } from '../src/llm/tutor-schemas';
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
  const model = args.model ?? env('GEMINI_MODEL', 'gemini-3.5-flash-lite').split(',')[0]!.trim();
  return new GeminiProvider(key, model);
}

function selectCases(): EvalCase[] {
  let cases = CASES;
  if (args.only) {
    if (!(ERROR_TYPES as readonly string[]).includes(args.only)) {
      throw new Error(`--only must be one of ${ERROR_TYPES.join(', ')}`);
    }
    cases = cases.filter((k) => k.expectedErrorType === args.only);
  }
  if (args.limit) cases = cases.slice(0, Number(args.limit));
  return cases;
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
    // When the corrected step is "x = 5", level 3 cannot show it without the answer.
    answerAllowed: level === 3 && isFinalForm(parseEquation(k.correctStep)),
    language: detectLanguage(message),
    ...(level === 1 ? { question: isQuestion(message) } : {}),
    ...(level === 3 ? { correctedStep: correctedStep(message, k) } : {}),
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

function write(base: string, info: RunInfo, results: CaseResult[], calls: CallRecord[]) {
  const summary = summarize(results, calls);
  writeFileSync(`${base}.md`, renderReport(info, summary, results));
  writeFileSync(`${base}.json`, `${JSON.stringify({ info, summary, results, calls }, null, 2)}\n`);
  if (info.complete !== false) {
    console.log(
      `\nError type accuracy ${summary.accuracy.ok}/${summary.accuracy.total}. Report: ${base}.md`,
    );
  }
}

/** Re-scores saved answers with the current checks: no model calls. */
function rescore(file: string) {
  const saved = JSON.parse(readFileSync(file, 'utf8')) as {
    info: RunInfo;
    results: CaseResult[];
    calls?: CallRecord[];
  };
  if (!saved.calls) throw new Error(`${file} has no raw calls (written by an older version)`);
  const byId = new Map(CASES.map((k) => [k.id, k]));
  const results = saved.results.map((r) => {
    const k = byId.get(r.id);
    if (!k) throw new Error(`Case ${r.id} no longer exists`);
    return score(k, r);
  });
  write(file.replace(/\.json$/, ''), saved.info, results, saved.calls);
}

interface Saved {
  info: RunInfo;
  results: CaseResult[];
  calls: CallRecord[];
}

/** A case is done when the diagnosis and all three hint levels came back. */
const done = (r: CaseResult) =>
  r.predicted !== null && r.hints.length === 3 && r.hints.every((h) => h.message !== null);

async function main() {
  validateCases(CASES); // an invalid case is a bug in the eval, not a model failure
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
  const concurrency = Number(args.concurrency);
  console.log(
    `Eval: ${provider.name} / ${provider.model}, ${cases.length} cases to run` +
      `${kept.length ? ` (+${kept.length} done earlier)` : ''}, concurrency ${concurrency}`,
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
    : join(args.out, `${info.date}-${provider.model.replace(/[^\w.-]+/g, '_')}`);
  // Calls of cases that are re-run are dropped with them; the rest stay in the totals.
  const calls: CallRecord[] = saved
    ? saved.calls.filter((c) => !c.caseId || keptIds.has(c.caseId))
    : [];
  const fresh: CaseResult[] = [];
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
  } catch (e) {
    if (!(e instanceof DailyQuotaError)) throw e;
    snapshot(false);
    console.error(
      `\n${e.message}. Partial results saved; continue later with:\n  pnpm eval --resume ${base}.json`,
    );
    process.exit(2);
  }
  snapshot(all().every(done));
}

main().catch((e: unknown) => {
  console.error('\nEval failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
