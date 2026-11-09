import { z } from 'zod';
import type { GenerateContentResponse } from '@google/genai';
import {
  cooldownFrom,
  durationMs,
  GeminiProvider,
  msUntilPacificMidnight,
  withPropertyOrdering,
  type GenerateContentClient,
} from './gemini.provider';
import { geminiRouting } from '../llm.module';
import type { LlmPurpose } from '../llm.types';

const req = { purpose: 'hint' as const, system: 's', prompt: 'p', schema: z.object({}) };
const signal = new AbortController().signal;

/** The body Gemini sends with a 429, as the SDK puts it into `message`. */
function quota429(opts: { retryDelay?: string; quotaId?: string } = {}) {
  const details: object[] = [];
  if (opts.quotaId) {
    details.push({
      '@type': 'type.googleapis.com/google.rpc.QuotaFailure',
      violations: [{ quotaId: opts.quotaId }],
    });
  }
  if (opts.retryDelay) {
    details.push({
      '@type': 'type.googleapis.com/google.rpc.RetryInfo',
      retryDelay: opts.retryDelay,
    });
  }
  const body = { error: { code: 429, message: 'You exceeded your current quota.', details } };
  return Object.assign(new Error(JSON.stringify(body)), { status: 429 });
}

/** Each model answers from its own script: text, or an error to throw. Calls are recorded. */
function fakeClient(script: Record<string, (string | Error)[]>) {
  const calls: string[] = [];
  const client: GenerateContentClient = {
    generateContent: (params) => {
      calls.push(params.model);
      const next = script[params.model]?.shift() ?? `{"from":"${params.model}"}`;
      return next instanceof Error
        ? Promise.reject(next)
        : Promise.resolve({ text: next } as GenerateContentResponse);
    },
  };
  return { client, calls };
}

function provider(script: Record<string, (string | Error)[]>, start = 1_000_000) {
  let now = start;
  const fake = fakeClient(script);
  const p = new GeminiProvider('key', 'lite,flash', { client: fake.client, now: () => now });
  return { p, calls: fake.calls, advance: (ms: number) => (now += ms) };
}

describe('GeminiProvider rate-limit cooldown', () => {
  it('moves to the next model at once after a 429, and skips the limited one until it frees up', async () => {
    const { p, calls, advance } = provider({ lite: [quota429({ retryDelay: '30s' })] });

    await expect(p.completeJson(req, {}, signal)).resolves.toBe('{"from":"flash"}');
    expect(calls).toEqual(['lite', 'flash']);

    advance(29_000);
    await p.completeJson(req, {}, signal);
    expect(calls.slice(2)).toEqual(['flash']); // lite still cooling, not even asked

    advance(2_000);
    await p.completeJson(req, {}, signal);
    expect(calls.slice(3)).toEqual(['lite']);
  });

  it('fails without calling the API while every model is cooling down', async () => {
    const { p, calls } = provider({
      lite: [quota429({ retryDelay: '30s' })],
      flash: [quota429({ retryDelay: '10s' })],
    });
    await expect(p.completeJson(req, {}, signal)).rejects.toMatchObject({
      status: 429,
      cooldown: true,
      message: expect.stringContaining('retry in 10s') as unknown,
    });
    expect(calls).toEqual(['lite', 'flash']);

    await expect(p.completeJson(req, {}, signal)).rejects.toMatchObject({ cooldown: true });
    expect(calls).toHaveLength(2);
  });

  it('says so when every model is out of its daily quota', async () => {
    const daily = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
    const { p } = provider({
      lite: [quota429({ quotaId: daily })],
      flash: [quota429({ quotaId: daily })],
    });
    await expect(p.completeJson(req, {}, signal)).rejects.toThrow(/per day/);
  });

  it('starts a retry from the next model, falling back to the first', async () => {
    const { p, calls } = provider({});
    await p.completeJson(req, {}, signal, 1);
    expect(calls).toEqual(['flash']);
  });

  it('does not cool a model down for other errors', async () => {
    const { p, calls } = provider({ lite: [new Error('boom')] });
    await expect(p.completeJson(req, {}, signal)).rejects.toThrow('boom');
    await p.completeJson(req, {}, signal);
    expect(calls).toEqual(['lite', 'lite']);
  });
});

describe('cooldownFrom', () => {
  const now = Date.parse('2026-11-09T20:00:00Z'); // 12:00 in Los Angeles (PST)

  it('reads RetryInfo and the daily quota id', () => {
    expect(cooldownFrom(quota429({ retryDelay: '41.5s' }), now)).toEqual({
      until: now + 41_500,
      daily: false,
    });
    expect(cooldownFrom(quota429({ quotaId: 'X-PerDay-FreeTier' }), now)).toEqual({
      until: now + 12 * 3600_000,
      daily: true,
    });
  });

  it('keeps a daily quota cooling until the Pacific reset, even with a short retryDelay', () => {
    const daily = 'GenerateRequestsPerDayPerProjectPerModel-FreeTier';
    expect(cooldownFrom(quota429({ quotaId: daily, retryDelay: '41s' }), now)).toEqual({
      until: now + 12 * 3600_000,
      daily: true,
    });
    // a longer retryDelay than the reset still wins
    expect(cooldownFrom(quota429({ quotaId: daily, retryDelay: '50000s' }), now).until).toBe(
      now + 50_000_000,
    );
    expect(cooldownFrom(new Error('requests per day limit; Please retry in 30s.'), now).until).toBe(
      now + 12 * 3600_000,
    );
  });

  it('falls back to "retry in …" text and then to a minute', () => {
    expect(cooldownFrom(new Error('Please retry in 20h5m48s.'), now).until).toBe(
      now + (20 * 3600 + 5 * 60 + 48) * 1000,
    );
    expect(cooldownFrom(new Error('Too many requests'), now)).toEqual({
      until: now + 60_000,
      daily: false,
    });
  });

  it('parses durations', () => {
    expect(durationMs('41s')).toBe(41_000);
    expect(durationMs('1m2.5s')).toBe(62_500);
    expect(durationMs('2h')).toBe(7_200_000);
    expect(durationMs('')).toBeNull();
    expect(durationMs('soon')).toBeNull();
  });

  it('knows when the Pacific day ends', () => {
    expect(msUntilPacificMidnight(now)).toBe(12 * 3600_000);
    expect(msUntilPacificMidnight(Date.parse('2026-07-01T06:59:00Z'))).toBe(60_000); // PDT
  });
});

describe('field order', () => {
  it('asks Gemini to write the fields in the order of the schema, message last', () => {
    const schema = z.toJSONSchema(
      z.object({
        understood: z.boolean(),
        nested: z.object({ b: z.string(), a: z.string() }),
        message: z.string(),
      }),
    );
    const ordered = withPropertyOrdering(schema) as {
      propertyOrdering: string[];
      properties: { nested: { propertyOrdering: string[] } };
    };
    expect(ordered.propertyOrdering).toEqual(['understood', 'nested', 'message']);
    expect(ordered.properties.nested.propertyOrdering).toEqual(['b', 'a']);
  });
});

describe('model by purpose', () => {
  function routed(script: Record<string, (string | Error)[]>) {
    const fake = fakeClient(script);
    const p = new GeminiProvider('key', 'lite,flash', {
      client: fake.client,
      now: () => 1_000_000,
      byPurpose: geminiRouting('flash,lite'),
    });
    return { p, calls: fake.calls };
  }
  const as = (purpose: LlmPurpose) => ({ ...req, purpose });

  it('sends diagnosis and hints to the diagnosis models, everything else to GEMINI_MODEL', async () => {
    const { p, calls } = routed({});
    for (const purpose of ['diagnose', 'hint'] as const) {
      await p.completeJson(as(purpose), {}, signal);
    }
    for (const purpose of ['step_feedback', 'chat', 'celebrate', 'follow_up'] as const) {
      await p.completeJson(as(purpose), {}, signal);
    }
    expect(calls).toEqual(['flash', 'flash', 'lite', 'lite', 'lite', 'lite']);
    expect(p.modelFor('hint')).toBe('flash,lite');
    expect(p.modelFor('chat')).toBe('lite,flash');
  });

  it('a retry moves to the next model of the same list', async () => {
    const { p, calls } = routed({});
    await p.completeJson(as('diagnose'), {}, signal, 1);
    expect(calls).toEqual(['lite']);
  });

  it('shares the cooldown of a model across purposes', async () => {
    const { p, calls } = routed({ flash: [quota429({ retryDelay: '30s' })] });
    await expect(p.completeJson(as('diagnose'), {}, signal)).resolves.toBe('{"from":"lite"}');
    expect(calls).toEqual(['flash', 'lite']);

    await p.completeJson(as('hint'), {}, signal); // flash is still cooling: not even asked
    await p.completeJson(as('chat'), {}, signal, 1); // the chat's fallback is flash: skipped too
    expect(calls.slice(2)).toEqual(['lite', 'lite']);
  });
});
