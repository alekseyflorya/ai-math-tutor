import { z } from 'zod';
import type { AppConfig } from '../config/config.service';
import type { Db } from '../db/db.module';
import { LlmService } from './llm.service';
import { LlmUnavailableError, type LlmJsonRequest, type LlmProvider } from './llm.types';

/** Quota queries return `used`; log inserts are recorded. Enough of Drizzle for this service. */
function fakeDb(used = 0) {
  const logged: { ok: boolean; error: string | null }[] = [];
  const db = {
    select: () => ({ from: () => ({ where: () => Promise.resolve([{ n: used }]) }) }),
    insert: () => ({
      values: (row: { ok: boolean; error: string | null }) => {
        logged.push(row);
        return Promise.resolve();
      },
    }),
  };
  return { db: db as unknown as Db, logged };
}

const config = (overrides: Record<string, number> = {}) =>
  ({
    get: (key: string) =>
      ({
        LLM_TIMEOUT_MS: 200,
        LLM_DAILY_LIMIT_PER_USER: 10,
        LLM_DAILY_LIMIT_GLOBAL: 100,
        ...overrides,
      })[key],
  }) as unknown as AppConfig;

/** Each call takes the next answer: JSON text, an error to throw, or 'hang' (never answers). */
function provider(...answers: (string | Error)[]) {
  const calls: { prompt: string; attempt: number }[] = [];
  const p: LlmProvider = {
    name: 'fake',
    model: 'fake-1',
    completeJson: (req, _schema, signal, attempt = 0) => {
      calls.push({ prompt: req.prompt, attempt });
      const answer = answers[calls.length - 1] ?? answers.at(-1)!;
      if (answer === 'hang') {
        return new Promise((_, reject) =>
          signal.addEventListener('abort', () => reject(new Error('aborted'))),
        );
      }
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  };
  return { p, calls };
}

const request: LlmJsonRequest<{ message: string }> = {
  purpose: 'chat',
  system: 'system',
  prompt: 'prompt',
  schema: z.object({ message: z.string() }),
};

describe('LlmService', () => {
  it('returns validated output', async () => {
    const { db, logged } = fakeDb();
    const { p } = provider('{"message":"hi"}');
    await expect(new LlmService(p, db, config()).generate(request, 'u1')).resolves.toEqual({
      message: 'hi',
    });
    expect(logged).toEqual([expect.objectContaining({ ok: true })]);
  });

  it('retries once with the validation error, then falls back to the next model', async () => {
    const { db } = fakeDb();
    const { p, calls } = provider('{"msg":"wrong key"}', '{"message":"fixed"}');
    await expect(new LlmService(p, db, config()).generate(request, 'u1')).resolves.toEqual({
      message: 'fixed',
    });
    expect(calls[1]!.prompt).toContain('did not match the required JSON format');
    expect(calls.map((c) => c.attempt)).toEqual([0, 1]);
  });

  it('gives up with a typed error after two invalid answers', async () => {
    const { db, logged } = fakeDb();
    const { p } = provider('not json');
    await expect(new LlmService(p, db, config()).generate(request, 'u1')).rejects.toMatchObject({
      reason: 'invalid_output',
    });
    expect(logged.filter((l) => !l.ok)).toHaveLength(2);
  });

  it('turns a hanging provider into a timeout', async () => {
    const { db } = fakeDb();
    const { p, calls } = provider('hang');
    const error = await new LlmService(p, db, config())
      .generate(request, 'u1')
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmUnavailableError);
    expect(error).toMatchObject({ reason: 'timeout' });
    expect(calls).toHaveLength(2);
  });

  it('does not start a call when the turn deadline has (almost) passed', async () => {
    const { db } = fakeDb();
    const { p, calls } = provider('{"message":"too late"}');
    await expect(
      new LlmService(p, db, config()).generate({ ...request, deadline: Date.now() + 500 }, 'u1'),
    ).rejects.toMatchObject({ reason: 'timeout' });
    expect(calls).toHaveLength(0);
  });

  it('enforces the daily quota before calling the model', async () => {
    const { db } = fakeDb(10);
    const { p, calls } = provider('{"message":"hi"}');
    await expect(new LlmService(p, db, config()).generate(request, 'u1')).rejects.toMatchObject({
      reason: 'quota_user',
    });
    expect(calls).toHaveLength(0);
  });

  it('reports rate limiting as such', async () => {
    const { db } = fakeDb();
    const limited = Object.assign(new Error('Too many requests'), { status: 429 });
    const { p } = provider(limited);
    await expect(new LlmService(p, db, config()).generate(request, 'u1')).rejects.toMatchObject({
      reason: 'rate_limited',
    });
  });
});
