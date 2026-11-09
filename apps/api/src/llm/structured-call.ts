import { z } from 'zod';
import { LlmUnavailableError, type LlmJsonRequest, type LlmProvider } from './llm.types';

export const MAX_ATTEMPTS = 2;
/** Not worth starting a model call with less time than this left before the deadline. */
const MIN_USEFUL_MS = 2000;
const RATE_LIMIT_BACKOFF_MS = 1500;

/** What happened on one model attempt; reported for logging and evals. */
export interface AttemptReport {
  attempt: number;
  ok: boolean;
  latencyMs: number;
  /** null when ok */
  reason: LlmUnavailableError['reason'] | null;
  error: string | null;
}

export interface StructuredCallOptions {
  /** Per-attempt timeout; also capped by `req.deadline`. */
  timeoutMs: number;
  onAttempt?: (report: AttemptReport) => void | Promise<void>;
}

/**
 * One structured model call: JSON Schema sent to the provider, the answer validated with zod,
 * and one self-correcting retry that tells the model what was wrong. No I/O besides the
 * provider, so the API (`LlmService`) and the offline eval share exactly the same behaviour.
 */
export async function callStructured<T>(
  provider: LlmProvider,
  req: LlmJsonRequest<T>,
  opts: StructuredCallOptions,
): Promise<T> {
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
    const timeoutMs = Math.min(opts.timeoutMs, left);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const started = Date.now();

    try {
      const raw = await provider.completeJson(
        { ...req, prompt },
        jsonSchema,
        controller.signal,
        attempt - 1,
      );
      const parsed = req.schema.safeParse(safeJson(raw));
      if (parsed.success) {
        await opts.onAttempt?.({
          attempt,
          ok: true,
          latencyMs: Date.now() - started,
          reason: null,
          error: null,
        });
        return parsed.data;
      }
      const errorText = `invalid output: ${parsed.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`;
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
    } finally {
      clearTimeout(timer);
    }

    await opts.onAttempt?.({
      attempt,
      ok: false,
      latencyMs: Date.now() - started,
      reason: lastError.reason,
      error: lastError.message,
    });
  }
  throw lastError ?? new LlmUnavailableError('provider_error', 'Unknown LLM failure');
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
