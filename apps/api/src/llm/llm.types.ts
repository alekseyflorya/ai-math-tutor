import type { AiUnavailableReason } from '@tutor/shared';
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
  /** The default model list (for logs). */
  readonly model: string;
  /** The model list used for a purpose, when it differs by purpose (for logs). */
  modelFor?(purpose: LlmPurpose): string;
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
    readonly reason: AiUnavailableReason,
    message: string,
  ) {
    super(message);
    this.name = 'LlmUnavailableError';
  }
}
