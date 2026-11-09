import { EnvSchema } from './env';

const base = {
  DATABASE_URL: 'postgres://localhost/db',
  LLM_PROVIDER: 'gemini',
  GEMINI_API_KEY: 'key',
};

describe('environment validation', () => {
  it('refuses the .env.example JWT placeholder in production', () => {
    const placeholder = 'change-me-to-a-long-random-string-at-least-32-chars';
    expect(
      EnvSchema.safeParse({ ...base, NODE_ENV: 'production', JWT_SECRET: placeholder }).success,
    ).toBe(false);
    expect(
      EnvSchema.safeParse({ ...base, NODE_ENV: 'development', JWT_SECRET: placeholder }).success,
    ).toBe(true);
  });

  it('accepts a real secret in production and refuses the mock model there', () => {
    const secret = 'q7Vb2xN9pLr4Tz8sWm3Kc6Hd1Yf5Jg0E';
    expect(
      EnvSchema.safeParse({ ...base, NODE_ENV: 'production', JWT_SECRET: secret }).success,
    ).toBe(true);
    expect(
      EnvSchema.safeParse({
        ...base,
        NODE_ENV: 'production',
        JWT_SECRET: secret,
        LLM_PROVIDER: 'mock',
      }).success,
    ).toBe(false);
  });

  it('sends diagnosis and hints to gemini-3.6-flash by default, the rest to lite first', () => {
    const env = EnvSchema.parse({ ...base, JWT_SECRET: 'q7Vb2xN9pLr4Tz8sWm3Kc6Hd1Yf5Jg0E' });
    expect(env.GEMINI_MODEL).toBe('gemini-3.5-flash-lite,gemini-3.6-flash');
    expect(env.GEMINI_MODEL_DIAGNOSIS).toBe('gemini-3.6-flash,gemini-3.5-flash-lite');
  });
});
