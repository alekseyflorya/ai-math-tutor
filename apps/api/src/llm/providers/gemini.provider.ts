import {
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentResponse,
  type ThinkingConfig,
} from '@google/genai';
import type { LlmJsonRequest, LlmProvider } from '../llm.types';

/** The part of the SDK the provider uses; replaced by a fake in tests. */
export interface GenerateContentClient {
  generateContent: GoogleGenAI['models']['generateContent'];
}

/** When a 429 names no retry time. */
const DEFAULT_COOLDOWN_MS = 60_000;

interface Cooldown {
  until: number;
  daily: boolean;
}

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';
  private readonly client: GenerateContentClient;
  private readonly now: () => number;
  /** Primary model first, then fallbacks (free-tier models are often rate limited). */
  private readonly models: string[];
  /** Models that answered 429, until the time the API named. Per process, by design. */
  private readonly cooling = new Map<string, Cooldown>();

  constructor(
    apiKey: string,
    models: string,
    opts: { client?: GenerateContentClient; now?: () => number } = {},
  ) {
    // v1beta: structured output via responseJsonSchema and the newest models live there.
    this.client = opts.client ?? new GoogleGenAI({ apiKey, apiVersion: 'v1beta' }).models;
    this.now = opts.now ?? Date.now;
    this.models = models
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);
    if (this.models.length === 0) throw new Error('GEMINI_MODEL is empty');
  }

  get model(): string {
    return this.models.join(',');
  }

  /**
   * `attempt` picks the starting model, so a retry after a timeout or an invalid answer tries the
   * next one. A model that answers 429 is skipped until its quota frees up, and the next available
   * model is tried at once. When every model is cooling down, no request is sent at all.
   */
  async completeJson(
    req: LlmJsonRequest<unknown>,
    jsonSchema: object,
    signal: AbortSignal,
    attempt = 0,
  ): Promise<string> {
    const start = attempt % this.models.length;
    const order = [...this.models.slice(start), ...this.models.slice(0, start)];
    for (const model of order) {
      if (this.isCooling(model)) continue;
      try {
        return await this.generate(model, req, jsonSchema, signal);
      } catch (err) {
        if ((err as { status?: number })?.status !== 429) throw err;
        this.cooling.set(model, cooldownFrom(err, this.now()));
      }
    }
    throw this.allCoolingError();
  }

  private isCooling(model: string): boolean {
    const c = this.cooling.get(model);
    if (!c) return false;
    if (c.until > this.now()) return true;
    this.cooling.delete(model);
    return false;
  }

  private allCoolingError(): Error {
    const states = this.models.map((m) => this.cooling.get(m)!);
    const waitS = Math.ceil((Math.min(...states.map((c) => c.until)) - this.now()) / 1000);
    const daily = states.every((c) => c.daily);
    return Object.assign(
      new Error(
        `All Gemini models are rate limited (${this.model}); retry in ${waitS}s` +
          (daily ? ' (requests per day quota)' : ''),
      ),
      { status: 429, cooldown: true },
    );
  }

  private async generate(
    model: string,
    req: LlmJsonRequest<unknown>,
    jsonSchema: object,
    signal: AbortSignal,
  ): Promise<string> {
    const res: GenerateContentResponse = await this.client.generateContent({
      model,
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      config: {
        systemInstruction: req.system,
        responseMimeType: 'application/json',
        responseJsonSchema: jsonSchema,
        temperature: req.temperature ?? 0.4,
        maxOutputTokens: req.maxOutputTokens ?? 2048,
        thinkingConfig: thinkingFor(model),
        abortSignal: signal,
      },
    });
    const text = res.text;
    if (!text) throw new Error(`Empty response from ${model}`);
    return text;
  }
}

/**
 * How long a 429 lasts. Gemini puts a RetryInfo ("41s") and the quota id ("…PerDay…") in the
 * error body; older messages only say "Please retry in 20h5m48s". A daily quota without a retry
 * time lasts until it resets at midnight Pacific time.
 */
export function cooldownFrom(err: unknown, now: number): Cooldown {
  const message = (err as Error)?.message ?? '';
  let delayMs: number | null = null;
  let daily = /per ?day/i.test(message);
  try {
    const body = JSON.parse(message) as {
      error?: { details?: { retryDelay?: string; violations?: { quotaId?: string }[] }[] };
    };
    for (const d of body.error?.details ?? []) {
      if (d.retryDelay) delayMs = durationMs(d.retryDelay);
      if (d.violations?.some((v) => /PerDay/i.test(v.quotaId ?? ''))) daily = true;
    }
  } catch {
    /* not a JSON body */
  }
  delayMs ??= durationMs(/retry in ((?:\d+h)?(?:\d+m)?[\d.]+s)/i.exec(message)?.[1] ?? '');
  delayMs ??= daily ? msUntilPacificMidnight(now) : DEFAULT_COOLDOWN_MS;
  return { until: now + delayMs, daily };
}

/** "41s", "41.2s", "20h5m48.6s" → ms; null if unreadable. */
export function durationMs(text: string): number | null {
  const m = /^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/.exec(text.trim());
  if (!text.trim() || !m) return null;
  const [, h = '0', min = '0', s = '0'] = m;
  return Math.round(((Number(h) * 60 + Number(min)) * 60 + Number(s)) * 1000);
}

/** Gemini's daily quotas reset at midnight in America/Los_Angeles. */
export function msUntilPacificMidnight(now: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(now));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const elapsed = (get('hour') * 60 + get('minute')) * 60 + get('second');
  return (24 * 3600 - elapsed) * 1000;
}

/**
 * Tutor turns are short and the math is pre-computed by the engine, so long
 * "thinking" only adds latency. Gemini 3 models take a level; 2.5 models a budget.
 */
function thinkingFor(model: string): ThinkingConfig | undefined {
  if (/^gemini-3/.test(model)) return { thinkingLevel: ThinkingLevel.LOW };
  if (/^gemini-2\.5-flash/.test(model)) return { thinkingBudget: 0 };
  return undefined;
}
