import { z } from 'zod';

const bool = z.enum(['true', 'false', '1', '0']).transform((v) => v === 'true' || v === '1');

/** Environment is validated once at boot: a misconfigured deploy fails fast and loudly. */
export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    /** 3100 in local dev (3000 is often taken by other projects); the Docker image sets 3000. */
    PORT: z.coerce.number().int().default(3100),
    DATABASE_URL: z.string().min(1),
    JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
    JWT_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
    COOKIE_SECURE: bool.default(false),

    LLM_PROVIDER: z.enum(['gemini', 'anthropic', 'mock']).default('gemini'),
    GEMINI_API_KEY: z.string().optional(),
    /** Comma-separated: the first is primary, the rest are fallbacks tried on retry. */
    GEMINI_MODEL: z.string().default('gemini-3.5-flash-lite,gemini-3.5-flash'),
    ANTHROPIC_API_KEY: z.string().optional(),
    ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),
    /** One model call (one try). */
    LLM_TIMEOUT_MS: z.coerce.number().int().min(1000).default(15000),
    /** All model calls of one student turn together (retries, follow-up, celebration). */
    LLM_TURN_BUDGET_MS: z.coerce.number().int().min(5000).default(25000),
    /** How long a turn may hold its attempt; default: the turn budget + 15 s. */
    TURN_LOCK_LEASE_MS: z.coerce.number().int().min(500).optional(),

    /** Protects the LLM budget/quota on a public demo. */
    LLM_DAILY_LIMIT_PER_USER: z.coerce.number().int().min(1).default(150),
    LLM_DAILY_LIMIT_GLOBAL: z.coerce.number().int().min(1).default(1000),
  })
  .superRefine((env, ctx) => {
    if (env.LLM_PROVIDER === 'gemini' && !env.GEMINI_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['GEMINI_API_KEY'],
        message: 'Required when LLM_PROVIDER=gemini',
      });
    }
    if (env.LLM_PROVIDER === 'anthropic' && !env.ANTHROPIC_API_KEY) {
      ctx.addIssue({
        code: 'custom',
        path: ['ANTHROPIC_API_KEY'],
        message: 'Required when LLM_PROVIDER=anthropic',
      });
    }
    if (env.NODE_ENV === 'production' && /change-me/i.test(env.JWT_SECRET)) {
      // The .env.example placeholder is long enough to pass the length check; anyone who
      // knows it could forge a session for any user.
      ctx.addIssue({
        code: 'custom',
        path: ['JWT_SECRET'],
        message: 'replace the .env.example placeholder (e.g. openssl rand -base64 48)',
      });
    }
    if (env.LLM_PROVIDER === 'mock' && env.NODE_ENV === 'production') {
      // The mock exists for automated tests only; production must use a real model.
      ctx.addIssue({
        code: 'custom',
        path: ['LLM_PROVIDER'],
        message: 'mock provider is not allowed in production',
      });
    }
  });

export type Env = z.infer<typeof EnvSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = EnvSchema.safeParse(raw);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
