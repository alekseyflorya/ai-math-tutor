import { Inject, Injectable, Logger } from '@nestjs/common';
import { z } from 'zod';
import { AppConfig } from '../config/config.service';
import { and, count, eq, gte } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module';
import { llmCalls } from '../db/schema';
import {
  LLM_PROVIDER,
  LlmUnavailableError,
  type LlmJsonRequest,
  type LlmProvider,
} from './llm.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ATTEMPTS = 2;
/** Not worth starting a model call with less time than this left before the deadline. */
const MIN_USEFUL_MS = 2000;
const RATE_LIMIT_BACKOFF_MS = 1500;

/**
 * The only door to the model. Adds what every call needs: quotas, timeout,
 * structured-output validation with one self-correcting retry, and a log row.
 */
@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);

  constructor(
    @Inject(LLM_PROVIDER) private readonly provider: LlmProvider,
    @Inject(DB) private readonly db: Db,
    private readonly config: AppConfig,
  ) {}

  get providerName() {
    return this.provider.name;
  }

  async generate<T>(req: LlmJsonRequest<T>, userId: string | null): Promise<T> {
    await this.enforceQuota(userId);
    const jsonSchema = z.toJSONSchema(req.schema);
    delete (jsonSchema as Record<string, unknown>).$schema;

    let prompt = req.prompt;
    let lastError: LlmUnavailableError | null = null;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const left = timeLeft(req.deadline);
      if (left < MIN_USEFUL_MS) {
        lastError ??= new LlmUnavailableError('timeout', 'No time left for this turn');
        break;
      }
      const timeoutMs = Math.min(this.config.get('LLM_TIMEOUT_MS'), left);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = Date.now();
      let errorText: string;

      try {
        const raw = await this.provider.completeJson(
          { ...req, prompt },
          jsonSchema,
          controller.signal,
          attempt - 1,
        );
        const parsed = req.schema.safeParse(safeJson(raw));
        if (parsed.success) {
          await this.log(req.purpose, userId, true, Date.now() - started, null);
          return parsed.data;
        }
        errorText = `invalid output: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
        lastError = new LlmUnavailableError('invalid_output', errorText);
        // Tell the model exactly what was wrong; models fix schema slips reliably on a second try.
        prompt = `${req.prompt}\n\nYour previous answer did not match the required JSON format (${errorText}). Answer again with valid JSON only.`;
      } catch (err) {
        const status = (err as { status?: number })?.status;
        if (controller.signal.aborted) {
          lastError = new LlmUnavailableError('timeout', 'The model did not answer in time');
        } else if (status === 429) {
          lastError = new LlmUnavailableError(
            'rate_limited',
            'The model provider is rate limiting requests',
          );
          if (attempt < MAX_ATTEMPTS) await sleep(RATE_LIMIT_BACKOFF_MS);
        } else {
          lastError = new LlmUnavailableError(
            'provider_error',
            (err as Error)?.message ?? 'Provider error',
          );
        }
        errorText = lastError.message;
      } finally {
        clearTimeout(timer);
      }

      await this.log(req.purpose, userId, false, Date.now() - started, errorText);
      this.logger.warn(`LLM ${req.purpose} attempt ${attempt} failed: ${errorText}`);
    }
    throw lastError ?? new LlmUnavailableError('provider_error', 'Unknown LLM failure');
  }

  private async enforceQuota(userId: string | null) {
    const since = new Date(Date.now() - DAY_MS);
    const countSince = async (userFilter?: string) => {
      const [row] = await this.db
        .select({ n: count() })
        .from(llmCalls)
        .where(
          userFilter
            ? and(eq(llmCalls.userId, userFilter), gte(llmCalls.createdAt, since))
            : gte(llmCalls.createdAt, since),
        );
      return row?.n ?? 0;
    };
    const [global, perUser] = await Promise.all([
      countSince(),
      userId ? countSince(userId) : Promise.resolve(0),
    ]);
    if (global >= this.config.get('LLM_DAILY_LIMIT_GLOBAL')) {
      throw new LlmUnavailableError('quota_global', 'Daily AI budget for the demo is used up');
    }
    if (perUser >= this.config.get('LLM_DAILY_LIMIT_PER_USER')) {
      throw new LlmUnavailableError('quota_user', 'Daily AI limit for this account is reached');
    }
  }

  private async log(
    purpose: string,
    userId: string | null,
    ok: boolean,
    latencyMs: number,
    error: string | null,
  ) {
    await this.db
      .insert(llmCalls)
      .values({
        purpose,
        userId,
        ok,
        latencyMs,
        error: error?.slice(0, 500) ?? null,
        provider: this.provider.name,
        model: this.provider.model,
      })
      .catch((e: unknown) => this.logger.error(`Failed to log LLM call: ${String(e)}`));
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

const timeLeft = (deadline?: number) =>
  deadline === undefined ? Number.POSITIVE_INFINITY : deadline - Date.now();

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
