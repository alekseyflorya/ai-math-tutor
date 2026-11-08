/**
 * Calls the configured real model with the test-scenario prompts and prints the
 * structured output. Use it to check an API key / model id before deploying:
 *
 *   pnpm smoke:llm            (reads the repo-root .env)
 */
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';
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
import { validateFollowUp } from '../src/tutor/follow-up.service';

const envFile = join(__dirname, '..', '..', '..', '.env');
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split('\n')) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m && !process.env[m[1]!]) process.env[m[1]!] = m[2];
  }
}

const provider: LlmProvider =
  process.env.LLM_PROVIDER === 'anthropic'
    ? new AnthropicProvider(
        process.env.ANTHROPIC_API_KEY!,
        process.env.ANTHROPIC_MODEL ?? 'claude-haiku-5-5',
      )
    : new GeminiProvider(
        process.env.GEMINI_API_KEY!,
        process.env.GEMINI_MODEL ?? 'gemini-flash-latest',
      );

async function run<T>(req: LlmJsonRequest<T>): Promise<T> {
  const schema = z.toJSONSchema(req.schema);
  delete (schema as Record<string, unknown>).$schema;
  const started = Date.now();
  const raw = await provider.completeJson(req, schema, AbortSignal.timeout(30_000));
  const parsed = req.schema.parse(JSON.parse(raw));
  console.log(`\n[${req.purpose}] ${Date.now() - started} ms`);
  console.log(JSON.stringify(parsed, null, 2));
  return parsed;
}

async function main() {
  console.log(`Provider: ${provider.name} / ${provider.model}`);
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

main().catch((e) => {
  console.error('\nSmoke test failed:', e?.message ?? e);
  process.exit(1);
});
