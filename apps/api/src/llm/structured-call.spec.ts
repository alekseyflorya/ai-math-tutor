import { z } from 'zod';
import type { LlmProvider } from './llm.types';
import { callStructured, type AttemptReport } from './structured-call';

const schema = z.object({ message: z.string() });
const req = { purpose: 'hint' as const, system: 's', prompt: 'p', schema };

function provider(...answers: string[]): LlmProvider {
  let i = 0;
  return {
    name: 'fake',
    model: 'fake-1',
    completeJson: () => Promise.resolve(answers[Math.min(i++, answers.length - 1)]!),
  };
}

describe('callStructured', () => {
  it('reports every attempt, including the invalid one before a successful retry', async () => {
    const reports: AttemptReport[] = [];
    const out = await callStructured(provider('not json', '{"message":"ok"}'), req, {
      timeoutMs: 1000,
      onAttempt: (r) => void reports.push(r),
    });
    expect(out).toEqual({ message: 'ok' });
    expect(reports.map((r) => [r.attempt, r.ok, r.reason])).toEqual([
      [1, false, 'invalid_output'],
      [2, true, null],
    ]);
  });

  it('works without a reporter', async () => {
    await expect(
      callStructured(provider('{"message":"hi"}'), req, { timeoutMs: 1000 }),
    ).resolves.toEqual({ message: 'hi' });
  });

  it('does not retry when the provider says every model is cooling down', async () => {
    let calls = 0;
    const cooling: LlmProvider = {
      name: 'fake',
      model: 'a,b',
      completeJson: () => {
        calls++;
        return Promise.reject(
          Object.assign(new Error('retry in 30s'), { status: 429, cooldown: true }),
        );
      },
    };
    const started = Date.now();
    await expect(callStructured(cooling, req, { timeoutMs: 1000 })).rejects.toMatchObject({
      reason: 'rate_limited',
    });
    expect(calls).toBe(1);
    expect(Date.now() - started).toBeLessThan(500); // no 1.5 s backoff
  });

  it('repairs LaTeX broken by JSON escaping in every string, and reports it', async () => {
    const reports: AttemptReport[] = [];
    // The model wrote "\times" and "\frac" with a single backslash: a tab and a form feed.
    const raw = '{"message":"$9 \\times 6$","nested":{"items":["$\\frac{1}{2}$"]}}';
    const schema = z.object({
      message: z.string(),
      nested: z.object({ items: z.array(z.string()) }),
    });
    const out = await callStructured(
      provider(raw),
      { ...req, schema },
      {
        timeoutMs: 1000,
        onAttempt: (r) => void reports.push(r),
      },
    );
    expect(out).toEqual({ message: '$9 \\times 6$', nested: { items: ['$\\frac{1}{2}$'] } });
    expect(reports[0]!.latexIntact).toBe(false);
  });
});
