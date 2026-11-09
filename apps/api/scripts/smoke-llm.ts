/**
 * Calls the configured real model with the test-scenario prompts and prints the
 * structured output. Use it to check an API key / model id before deploying:
 *
 *   pnpm smoke:llm            (reads the repo-root .env)
 */
import { GoogleGenAI } from '@google/genai';
import { checkStep } from '@tutor/shared';
import {
  diagnosePrompt,
  followUpPrompt,
  systemPrompt,
  type TutorContext,
} from '../src/llm/prompts';
import { DiagnosisSchema, FollowUpSchema } from '../src/llm/tutor-schemas';
import { GeminiProvider } from '../src/llm/providers/gemini.provider';
import { AnthropicProvider } from '../src/llm/providers/anthropic.provider';
import type { LlmJsonRequest, LlmProvider } from '../src/llm/llm.types';
import { callStructured } from '../src/llm/structured-call';
import { validateFollowUp } from '../src/tutor/follow-up.service';
import { DEFAULT_GEMINI_MODEL, DEFAULT_GEMINI_MODEL_DIAGNOSIS } from '../src/config/env';
import { geminiRouting } from '../src/llm/llm.module';
import { loadRootEnv } from './load-env';

loadRootEnv();

const provider: LlmProvider =
  process.env.LLM_PROVIDER === 'anthropic'
    ? new AnthropicProvider(
        process.env.ANTHROPIC_API_KEY!,
        process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5',
      )
    : new GeminiProvider(
        process.env.GEMINI_API_KEY!,
        process.env.GEMINI_MODEL ?? DEFAULT_GEMINI_MODEL,
        {
          byPurpose: geminiRouting(
            process.env.GEMINI_MODEL_DIAGNOSIS ?? DEFAULT_GEMINI_MODEL_DIAGNOSIS,
          ),
        },
      );

async function run<T>(req: LlmJsonRequest<T>): Promise<T> {
  const started = Date.now();
  let parsed: T;
  try {
    // The same validation + self-correcting retry as the API.
    parsed = await callStructured(provider, req, {
      timeoutMs: 60_000,
      onAttempt: (a) => {
        if (!a.ok) console.warn(`[${req.purpose}] attempt ${a.attempt} failed: ${a.error}`);
      },
    });
  } catch (e) {
    throw new Error(
      `[${req.purpose}] failed after ${Date.now() - started} ms: ${(e as Error).message}`,
      { cause: e },
    );
  }
  console.log(`\n[${req.purpose}] ${Date.now() - started} ms`);
  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

/** Plain-text round trip: separates network/key/model problems from structured-output ones. */
async function ping() {
  if (process.env.LLM_PROVIDER === 'anthropic') return;
  const started = Date.now();
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY!, apiVersion: 'v1beta' });
  const res = await ai.models.generateContent({
    model: provider.model.split(',')[0]!.trim(),
    contents: 'Reply with the single word OK.',
    config: { abortSignal: AbortSignal.timeout(60_000) },
  });
  console.log(`[ping] ${Date.now() - started} ms → ${res.text?.trim()}`);
}

async function main() {
  console.log(`Provider: ${provider.name} / ${provider.model}`);
  await ping();
  const problem = '3(x + 4) = 2x + 19';
  const step = '3x + 4 = 2x + 19';
  const check = checkStep(problem, step);
  for (const locale of ['en', 'uk'] as const) {
    const ctx: TutorContext = {
      locale,
      problem,
      currentLine: problem,
      steps: [{ input: step, isCorrect: false }],
      mode: 'SOLVING',
      hintLevel: 1,
      activeMistake: null,
      recentDialogue: [],
      isFollowUp: false,
      history: {
        solvedProblems: 3,
        mistakes: [{ errorType: 'DISTRIBUTION', total: 1, verified: 0 }],
      },
    };
    await run({
      purpose: 'diagnose',
      system: systemPrompt(locale),
      prompt: diagnosePrompt(ctx, step, check.facts),
      schema: DiagnosisSchema,
    });
  }
  const fu = await run({
    purpose: 'follow_up',
    system: systemPrompt('en'),
    prompt: followUpPrompt(
      problem,
      'DISTRIBUTION',
      'Multiplied only the first term in the bracket.',
      [],
    ),
    schema: FollowUpSchema,
    temperature: 0.9,
  });
  console.log(
    `\nMath engine verdict on follow-up: ${validateFollowUp(fu.equation, 'DISTRIBUTION', [problem]) ?? 'accepted'}`,
  );
}

main().catch((e: unknown) => {
  console.error('\nSmoke test failed:', e instanceof Error ? e.message : e);
  process.exit(1);
});
