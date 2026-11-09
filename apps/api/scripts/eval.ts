/**
 * Offline eval of the AI part against a real model (no database, no API server):
 *
 *   pnpm eval [--model gemini-3.5-flash] [--limit 10] [--concurrency 2] [--only SIGN_TRANSFER]
 *   pnpm eval --rescore evals/reports/<file>.json   (re-apply the checks to saved answers, offline)
 *
 * For every case in evals/cases.ts: the diagnosis (= hint level 1) and hint levels 2 and 3, built
 * with the production prompt functions and zod schemas and sent through `callStructured` — the
 * same validation and retry the API uses. Writes evals/reports/<date>-<model>.md (+ .json).
 * Reads keys from the repo-root .env, like `pnpm smoke:llm`.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { checkStep, ERROR_TYPES, isFinalForm, parseEquation, solve } from '@tutor/shared';
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
  const model = args.model ?? env('GEMINI_MODEL', 'gemini-3.5-flash').split(',')[0]!.trim();
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
let consecutiveRateLimited = 0;

/**
 * One production-equivalent call. The free tier rate-limits hard, so a 429 that survives
 * callStructured's own short retry is retried here with exponential backoff.
 */
async function call<T>(
  provider: LlmProvider,
  calls: CallRecord[],
  purpose: CallRecord['purpose'],
  req: Omit<LlmJsonRequest<T>, 'deadline'>,
): Promise<T> {
  const attempts: AttemptReport[] = [];
  const record = (ok: boolean) => calls.push({ purpose, ok, attempts });
  for (let retry = 0; ; retry++) {
    try {
      const out = await callStructured(
        provider,
        { ...req, deadline: Date.now() + TURN_BUDGET_MS },
        { timeoutMs: TIMEOUT_MS, onAttempt: (a) => void attempts.push(a) },
      );
      consecutiveRateLimited = 0;
      record(true);
      return out;
    } catch (e) {
      const limited = e instanceof LlmUnavailableError && e.reason === 'rate_limited';
      if (!limited || retry >= MAX_RATE_LIMIT_RETRIES) {
        if (limited && ++consecutiveRateLimited >= 3) {
          throw new Error(
            'Rate limited on three calls in a row: the daily quota is likely used up',
            { cause: e },
          );
        }
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

function checkMessage(k: EvalCase, level: 1 | 2 | 3, message: string): HintChecks {
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
      h.message === null ? h : { ...h, checks: checkMessage(k, h.level, h.message) },
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
  try {
    diagnosis = await call(provider, calls, 'diagnose', {
      purpose: 'diagnose',
      system,
      prompt: diagnosePrompt(base, k.wrongStep, check.facts, 1),
      schema: DiagnosisSchema,
      temperature: 0.3,
    });
  } catch (e) {
    result.hints.push({ level: 1, message: null, error: (e as Error).message });
    return score(k, result);
  }
  result.predicted = diagnosis.errorType;
  result.misconception = diagnosis.misconception;
  const hint = (level: 1 | 2 | 3, message: string): HintResult => ({ level, message });
  result.hints.push(hint(1, diagnosis.message));

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
      const out = await call(provider, calls, 'hint', {
        purpose: 'hint',
        system,
        prompt: hintPrompt(ctx, level),
        schema: FeedbackSchema,
      });
      result.hints.push(hint(level, out.message));
      dialogue.push({ role: 'Tutor', content: out.message });
    } catch (e) {
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
  console.log(
    `\nError type accuracy ${summary.accuracy.ok}/${summary.accuracy.total}. Report: ${base}.md`,
  );
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

async function main() {
  validateCases(CASES); // an invalid case is a bug in the eval, not a model failure
  if (args.rescore) return rescore(args.rescore);
  const provider = makeProvider();
  const cases = selectCases();
  const concurrency = Number(args.concurrency);
  console.log(
    `Eval: ${provider.name} / ${provider.model}, ${cases.length} cases, concurrency ${concurrency}`,
  );

  const calls: CallRecord[] = [];
  const started = Date.now();
  const results = await pool(cases, concurrency, async (k) => {
    const r = await runCase(provider, k, calls);
    const broken = r.hints.flatMap((h) => violations(h, r.locale).map((v) => `L${h.level}: ${v}`));
    const mark = r.predicted === r.expected ? '✓' : '✗';
    console.log(
      `${mark} ${r.id.padEnd(9)} ${r.expected} → ${r.predicted ?? 'failed'}${broken.length ? `  [${broken.join('; ')}]` : ''}`,
    );
    return r;
  });

  const info: RunInfo = {
    date: today(),
    provider: provider.name,
    model: provider.model,
    concurrency,
    durationMs: Date.now() - started,
    filter: args.only,
  };
  mkdirSync(args.out, { recursive: true });
  write(
    join(args.out, `${info.date}-${provider.model.replace(/[^\w.-]+/g, '_')}`),
    info,
    results,
    calls,
  );
}

main().catch((e: unknown) => {
  console.error('\nEval failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
