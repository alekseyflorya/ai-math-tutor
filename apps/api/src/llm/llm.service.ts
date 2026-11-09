import { Inject, Injectable, Logger } from '@nestjs/common';
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
import { callStructured } from './structured-call';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The only door to the model. Adds quotas and a log row per attempt around `callStructured`
 * (timeout, structured-output validation with one self-correcting retry).
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
    return callStructured(this.provider, req, {
      timeoutMs: this.config.get('LLM_TIMEOUT_MS'),
      onAttempt: async (a) => {
        await this.log(req.purpose, userId, a.ok, a.latencyMs, a.error);
        if (!a.ok) this.logger.warn(`LLM ${req.purpose} attempt ${a.attempt} failed: ${a.error}`);
      },
    });
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
    purpose: LlmJsonRequest<unknown>['purpose'],
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
        model: this.provider.modelFor?.(purpose) ?? this.provider.model,
      })
      .catch((e: unknown) => this.logger.error(`Failed to log LLM call: ${String(e)}`));
  }
}
