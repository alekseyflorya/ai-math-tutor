import type { ZodType } from 'zod';

export type LlmPurpose = 'diagnose' | 'step_feedback' | 'chat' | 'hint' | 'celebrate' | 'follow_up';

export interface LlmJsonRequest<T> {
  purpose: LlmPurpose;
  system: string;
  prompt: string;
  /** Output contract. Sent to the model as JSON Schema and enforced again with zod. */
  schema: ZodType<T>;
  temperature?: number;
  maxOutputTokens?: number;
  /**
   * Epoch ms by which the whole call, retries included, must finish. Set per student turn so
   * one HTTP request never waits for several full timeouts in a row.
   */
  deadline?: number;
}

/**
 * Thin provider port. The tutor never imports an SDK directly, so switching
 * Gemini ↔ Claude (or adding a local model) is a config change.
 */
export interface LlmProvider {
  readonly name: string;
  readonly model: string;
  /**
   * Returns the raw JSON text produced by the model. `attempt` (0-based) lets a provider
   * fall back to another model when the previous attempt timed out or was rejected.
   */
  completeJson(
    req: LlmJsonRequest<unknown>,
    jsonSchema: object,
    signal: AbortSignal,
    attempt?: number,
  ): Promise<string>;
}

export const LLM_PROVIDER = Symbol('LLM_PROVIDER');

export class LlmUnavailableError extends Error {
  constructor(
    readonly reason:
      | 'quota_user'
      | 'quota_global'
      | 'rate_limited'
      | 'timeout'
      | 'invalid_output'
      | 'provider_error',
    message: string,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}
