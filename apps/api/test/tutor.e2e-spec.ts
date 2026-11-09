/**
 * End-to-end test of the assignment's test scenario against a real Postgres,
 * with the deterministic mock LLM (no network). It exercises the real state
 * machine: step checking, diagnosis, hint escalation, mistake tracking,
 * follow-up generation + validation, and progress.
 *
 *   DATABASE_URL_TEST=postgres://tutor:tutor@localhost:5433/tutor_test pnpm --filter @tutor/api test
 */
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ThrottlerStorage, ThrottlerStorageService } from '@nestjs/throttler';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import request from 'supertest';
import type { App } from 'supertest/types';
import type {
  ApiErrorBody,
  AttemptSummary,
  AttemptView,
  ProblemView,
  ProgressView,
  UserView,
} from '@tutor/shared';
import { evaluateSide, parseEquation, solve } from '@tutor/shared';
import { LLM_PROVIDER, type LlmProvider } from '../src/llm/llm.types';
import { DemoCleanupService } from '../src/auth/demo-cleanup.service';
import { AttemptLock } from '../src/tutor/attempt-lock';
import { AttemptRepository } from '../src/tutor/attempt.repository';

const DB_URL = process.env.DATABASE_URL_TEST ?? 'postgres://tutor:tutor@localhost:5433/tutor_test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: DB_URL,
  LLM_PROVIDER: 'mock',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  COOKIE_SECURE: 'false',
  // Short turn-lock lease, so the "expired lease" case runs in a second.
  TURN_LOCK_LEASE_MS: '1500',
});

/** The real in-memory rate-limit store, replaced by a fresh one before each test. */
class ResettableRateLimits {
  private store = new ThrottlerStorageService();
  increment(...args: Parameters<ThrottlerStorageService['increment']>) {
    return this.store.increment(...args);
  }
  reset() {
    this.store.onApplicationShutdown();
    this.store = new ThrottlerStorageService();
  }
  onApplicationShutdown() {
    this.store.onApplicationShutdown();
  }
}
const rateLimits = new ResettableRateLimits();

describe('AI tutor — test scenario 3(x + 4) = 2x + 19', () => {
  let app: INestApplication;
  let server: App;
  let agent: ReturnType<typeof request.agent>;
  let provider: LlmProvider;

  beforeAll(async () => {
    // Fresh schema for every run.
    const pool = new Pool({ connectionString: DB_URL });
    await pool.query(
      'DROP SCHEMA IF EXISTS public CASCADE; DROP SCHEMA IF EXISTS drizzle CASCADE; CREATE SCHEMA public;',
    );
    await pool.end();

    const { AppModule } = await import('../src/app.module');
    const { configureApp } = await import('../src/app.setup');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(rateLimits)
      .compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    server = app.getHttpServer() as App;
    agent = request.agent(server);
    provider = app.get<LlmProvider>(LLM_PROVIDER);
  });

  // Every request here comes from one IP: start each test with fresh per-IP rate limits, so the
  // number of turns earlier tests made does not matter.
  beforeEach(() => rateLimits.reset());

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    await app?.close();
  });

  const say = async (attemptId: string, text: string): Promise<AttemptView> => {
    const res = await agent.post(`/api/attempts/${attemptId}/messages`).send({ text });
    if (res.status !== 200) throw new Error(`${text}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as AttemptView;
  };
  const lastTutor = (a: AttemptView) => [...a.messages].reverse().find((m) => m.role === 'TUTOR')!;
  const startCustom = async (equation: string) =>
    (await agent.post('/api/attempts').send({ equation }).expect(201)).body as AttemptView;
  const hint = async (attemptId: string) =>
    (await agent.post(`/api/attempts/${attemptId}/hint`).send({}).expect(200)).body as AttemptView;

  it('rejects unauthenticated and non-JSON requests', async () => {
    await request(server).get('/api/progress').expect(401);
    await request(server).post('/api/auth/demo').type('form').send('locale=en').expect(415);
  });

  it('creates an isolated demo student with seeded history', async () => {
    const res = await agent.post('/api/auth/demo').send({ locale: 'en' }).expect(200);
    expect((res.body as UserView).isDemo).toBe(true);
    expect(res.headers['set-cookie']?.[0]).toMatch(/tutor_session=.*HttpOnly/i);
    const progress = (await agent.get('/api/progress').expect(200)).body as ProgressView;
    expect(progress.totals.solved).toBe(4);
  });

  it('runs the full scenario: detect → guide → correct → solve → follow-up → verified', async () => {
    const problems = (await agent.get('/api/problems').expect(200)).body as ProblemView[];
    const featured = problems.find((p) => p.featured)!;
    expect(featured.equation).toBe('3(x + 4) = 2x + 19');

    let a = (await agent.post('/api/attempts').send({ problemId: featured.id }).expect(201))
      .body as AttemptView;
    expect(a.messages[0]!.kind).toBe('GREETING');
    // Until the student reaches it, the answer is nowhere in what the API returns.
    const noAnswer = (view: AttemptView) => {
      expect(view.solutionLatex).toBeNull();
      expect(JSON.stringify(view)).not.toMatch(/x\s*=\s*7(?![0-9])/);
    };
    noAnswer(a);

    // 1. The classic mistake: only the first term was multiplied.
    a = await say(a.id, '3x + 4 = 2x + 19');
    noAnswer(a);
    expect(a.steps.at(-1)!.isCorrect).toBe(false);
    expect(a.mode).toBe('REMEDIATION');
    expect(a.hintLevel).toBe(1);
    expect(lastTutor(a).kind).toBe('HINT');
    expect(lastTutor(a).meta).toMatchObject({ errorType: 'DISTRIBUTION', hintLevel: 1 });

    // 2. Student is stuck → the tutor climbs the hint ladder instead of revealing the answer.
    a = await say(a.id, "I don't get it");
    expect(a.hintLevel).toBe(2);
    expect(lastTutor(a).kind).toBe('HINT');

    // Re-typing the line before the mistake is not a correction.
    const stepsBefore = a.steps.length;
    a = await say(a.id, '3(x+4) = 2x + 19');
    expect(a.steps).toHaveLength(stepsBefore);
    expect(a.mode).toBe('REMEDIATION');
    expect(lastTutor(a)).toMatchObject({ kind: 'NOTICE', meta: { repeatedLine: true } });

    // 3. Corrected step.
    a = await say(a.id, '3x + 12 = 2x + 19');
    expect(a.steps.at(-1)!.isCorrect).toBe(true);
    expect(a.mode).toBe('SOLVING');
    expect(lastTutor(a).meta).toMatchObject({ correct: true, fixedErrorType: 'DISTRIBUTION' });

    // 4. Any equivalent path is accepted; the answer is reached.
    a = await say(a.id, '3x - 2x = 19 - 12');
    noAnswer(a);
    a = await say(a.id, 'x = 7');
    expect(a.status).toBe('IN_PROGRESS');
    expect(a.mode).toBe('CHECKING');
    expect(a.solutionLatex).toBe('x = 7');
    expect(lastTutor(a)).toMatchObject({ kind: 'FEEDBACK', meta: { checkRequested: true } });
    expect(a.messages.some((m) => m.kind === 'FOLLOW_UP')).toBe(false); // only once checked

    // 5. The check, as at school: substitute into the original equation, compute both sides.
    a = await say(a.id, '3(7 + 4) = 2·7 + 19');
    expect(a.mode).toBe('CHECKING');
    expect(a.steps.at(-1)).toMatchObject({ phase: 'CHECK', isCorrect: true });
    expect(lastTutor(a)).toMatchObject({ kind: 'FEEDBACK', meta: { checkStep: true } });
    a = await say(a.id, '33 = 33');
    expect(a.status).toBe('SOLVED');
    expect(a.check).toBe('DONE');
    expect(a.messages.find((m) => m.kind === 'CELEBRATION')!.meta).toMatchObject({
      checked: true,
    });
    const followUpMsg = a.messages.find((m) => m.kind === 'FOLLOW_UP')!;
    expect(followUpMsg.meta).toMatchObject({ errorType: 'DISTRIBUTION', source: 'llm' });
    expect(a.nextAttemptId).toBeTruthy();

    // Re-opening a solved problem shows the solution; "Solve again" starts a fresh attempt.
    const reopened = (
      await agent.post('/api/attempts').send({ problemId: featured.id }).expect(201)
    ).body as AttemptView;
    expect(reopened.id).toBe(a.id);
    const fresh = (
      await agent.post('/api/attempts').send({ problemId: featured.id, restart: true }).expect(201)
    ).body as AttemptView;
    expect(fresh.id).not.toBe(a.id);
    expect(fresh.status).toBe('IN_PROGRESS');

    // 6. Follow-up targets the same skill and was validated by the math engine.
    let f = (await agent.get(`/api/attempts/${a.nextAttemptId}`).expect(200)).body as AttemptView;
    expect(f.isFollowUp).toBe(true);
    expect(f.targetErrorType).toBe('DISTRIBUTION');
    expect(f.equation).toBe('5(x - 2) = 3x + 4');

    f = await say(f.id, '5x - 10 = 3x + 4');
    f = await say(f.id, '2x = 14');
    f = await say(f.id, 'x = 7');
    expect(f.mode).toBe('CHECKING'); // practice problems are checked too
    f = await say(f.id, '25 = 25'); // 5(7 - 2) = 3·7 + 4, computed mentally
    expect(f.status).toBe('SOLVED');

    expect(f.understandingVerified).toBe(true);
    expect(f.parentAttemptId).toBe(a.id);
    const original = (await agent.get(`/api/attempts/${a.id}`).expect(200)).body as AttemptView;
    expect(original.nextAttemptStatus).toBe('SOLVED');
    expect(original.understandingVerified).toBe(true);

    // 7. Progress: the distribution mistake is corrected AND verified.
    const progress = (await agent.get('/api/progress').expect(200)).body as ProgressView;
    const dist = progress.mistakesByType.find((m) => m.errorType === 'DISTRIBUTION')!;
    expect(dist).toEqual({ errorType: 'DISTRIBUTION', total: 1, corrected: 1, verified: 1 });
    expect(progress.skills.find((s) => s.skill === 'distribution')!.attempts).toBeGreaterThan(0);
    expect(progress.checks.done).toBeGreaterThanOrEqual(2);
  });

  it('checks the answer: a slip in the check climbs the hint ladder, lines that are not a substitution get a notice', async () => {
    let a = await startCustom('2(x + 3) = x + 10'); // x = 4, both sides 14
    a = await say(a.id, 'x = 4');
    expect(a.mode).toBe('CHECKING');

    // Not a substitution: still the unknown, or another equation altogether.
    a = await say(a.id, 'x = 4');
    expect(lastTutor(a)).toMatchObject({ kind: 'NOTICE', meta: { checkError: 'not_numeric' } });
    a = await say(a.id, '5 = 5');
    expect(lastTutor(a)).toMatchObject({
      kind: 'NOTICE',
      meta: { checkError: 'not_substitution' },
    });
    expect(a.steps.filter((s) => s.phase === 'CHECK')).toHaveLength(0);

    a = await say(a.id, '2(4 + 3) = 4 + 10');
    a = await say(a.id, '14 = 15');
    expect(a.mode).toBe('CHECKING');
    expect(a.hintLevel).toBe(1);
    expect(a.steps.at(-1)).toMatchObject({ phase: 'CHECK', isCorrect: false });
    expect(lastTutor(a)).toMatchObject({
      kind: 'HINT',
      meta: { hintLevel: 1, errorType: 'ARITHMETIC', correct: false },
    });

    a = await hint(a.id);
    expect(a.hintLevel).toBe(2);

    a = await say(a.id, '14 = 14');
    expect(a.status).toBe('SOLVED');
    expect(a.check).toBe('DONE');
    const progress = (await agent.get('/api/progress').expect(200)).body as ProgressView;
    const arithmetic = progress.recentMistakes.find((m) => m.stepInput === '14 = 15')!;
    expect(arithmetic).toMatchObject({ errorType: 'ARITHMETIC', corrected: true });
    // A slip in the check is not what practice targets: no follow-up for it.
    expect(a.nextAttemptId).toBeNull();
  });

  it('skips the check: solved without it, a pending slip stays uncorrected, practice still comes', async () => {
    let a = await startCustom('4(x + 1) = 3x + 7'); // x = 3, both sides 16

    // Only while checking.
    const early = await agent.post(`/api/attempts/${a.id}/skip-check`).send({});
    expect(early.status).toBe(409);
    expect((early.body as ApiErrorBody).code).toBe('NOT_CHECKING');

    a = await say(a.id, '4x + 1 = 3x + 7'); // DISTRIBUTION (mock)
    a = await say(a.id, '4x + 4 = 3x + 7');
    a = await say(a.id, 'x = 3');
    a = await say(a.id, '16 = 17'); // a slip in the check, then the student gives up on it
    expect(a.hintLevel).toBe(1);

    a = (await agent.post(`/api/attempts/${a.id}/skip-check`).send({}).expect(200))
      .body as AttemptView;
    expect(a.status).toBe('SOLVED');
    expect(a.check).toBe('SKIPPED');
    expect(a.hintLevel).toBe(0);
    expect(a.messages.some((m) => m.kind === 'NOTICE' && m.meta?.checkSkipped)).toBe(true);
    expect(a.messages.find((m) => m.kind === 'CELEBRATION')!.meta).toMatchObject({
      checked: false,
    });
    // The practice problem targets the solution's mistake, not the slip in the check.
    expect(a.messages.find((m) => m.kind === 'FOLLOW_UP')!.meta).toMatchObject({
      errorType: 'DISTRIBUTION',
    });

    const progress = (await agent.get('/api/progress').expect(200)).body as ProgressView;
    expect(progress.recentMistakes.find((m) => m.stepInput === '16 = 17')).toMatchObject({
      errorType: 'ARITHMETIC',
      corrected: false,
    });
    expect(progress.checks.skipped).toBeGreaterThanOrEqual(1);

    const again = await agent.post(`/api/attempts/${a.id}/skip-check`).send({});
    expect(again.status).toBe(409);
    expect((again.body as ApiErrorBody).code).toBe('ATTEMPT_CLOSED');
  });

  it('a slip while checking the practice problem does not undo "understood"', async () => {
    // The model diagnoses the first mistake as ARITHMETIC (the practice will target it).
    const real = provider.completeJson.bind(provider);
    jest.spyOn(provider, 'completeJson').mockImplementation(async (req, ...rest) => {
      if (req.purpose === 'diagnose' && req.prompt.includes('2x = 9')) {
        return JSON.stringify({
          errorType: 'ARITHMETIC',
          misconception: 'Subtracted 3 from 11 and got 9.',
          message: '[mock] Check 11 - 3 again?',
        });
      }
      return real(req, ...rest);
    });
    let a = await startCustom('2x + 3 = 11');
    a = await say(a.id, '2x = 9');
    expect(lastTutor(a).meta).toMatchObject({ errorType: 'ARITHMETIC' });
    a = await say(a.id, '2x = 8');
    a = await say(a.id, 'x = 4');
    a = await say(a.id, '11 = 11');
    expect(a.status).toBe('SOLVED');
    expect(a.nextAttemptId).toBeTruthy();

    // The practice problem: solved right, but an ARITHMETIC slip in its check.
    let f = (await agent.get(`/api/attempts/${a.nextAttemptId}`).expect(200)).body as AttemptView;
    expect(f.targetErrorType).toBe('ARITHMETIC');
    const eq = parseEquation(f.equation);
    const sol = solve(eq);
    if (sol.kind !== 'unique') throw new Error('practice problem without a unique root');
    const v = evaluateSide(eq.left, sol.value).toString();
    f = await say(f.id, `x = ${sol.value.toString()}`);
    expect(f.mode).toBe('CHECKING');
    f = await say(f.id, `${v} = ${v}1`);
    expect(lastTutor(f).meta).toMatchObject({ errorType: 'ARITHMETIC' });
    f = await say(f.id, `${v} = ${v}`);
    expect(f.status).toBe('SOLVED');
    expect(f.understandingVerified).toBe(true);
  });

  it('explains unreadable input instead of guessing', async () => {
    const a = (await agent.post('/api/attempts').send({ equation: '2x + 3 = 11' }).expect(201))
      .body as AttemptView;
    const after = await say(a.id, '2x + = 11');
    expect(lastTutor(after)).toMatchObject({ kind: 'NOTICE', meta: { inputError: 'SYNTAX' } });
    expect(after.steps).toHaveLength(0);
  });

  it('lists the student’s own equations and resumes an open one instead of duplicating it', async () => {
    const first = (await agent.post('/api/attempts').send({ equation: '4x - 3 = 9' }).expect(201))
      .body as AttemptView;
    const again = (await agent.post('/api/attempts').send({ equation: '4x-3=9' }).expect(201))
      .body as AttemptView;
    expect(again.id).toBe(first.id);
    const own = (await agent.get('/api/attempts?kind=custom').expect(200)).body as { id: string }[];
    expect(own.map((a) => a.id)).toContain(first.id);
    const all = (await agent.get('/api/attempts').expect(200)).body as { id: string }[];
    expect(own.length).toBeLessThan(all.length); // curriculum and practice attempts are excluded
  });

  it('rejects equations without a unique solution and other users’ attempts', async () => {
    await agent.post('/api/attempts').send({ equation: '2(x + 1) = 2x + 2' }).expect(400);
    const mine = (await agent.post('/api/attempts').send({ equation: 'x + 1 = 2' }).expect(201))
      .body as AttemptView;
    const other = request.agent(server);
    await other.post('/api/auth/demo').send({}).expect(200);
    await other.get(`/api/attempts/${mine.id}`).expect(404);
  });

  it('gives hints on request up to level 3 without revealing more', async () => {
    let a = await startCustom('2(x + 3) = 14');
    a = await say(a.id, '2x + 3 = 14');
    expect(a.hintLevel).toBe(1);

    a = await hint(a.id);
    expect(a.hintLevel).toBe(2);
    expect(lastTutor(a)).toMatchObject({ kind: 'HINT', meta: { hintLevel: 2, requested: true } });

    a = await hint(a.id);
    a = await hint(a.id);
    expect(a.hintLevel).toBe(3);
    expect(lastTutor(a)).toMatchObject({ kind: 'EXPLANATION', meta: { hintLevel: 3 } });
  });

  it('keeps checking every step when the AI is down', async () => {
    jest.spyOn(provider, 'completeJson').mockRejectedValue(new Error('provider is down'));
    let a = await startCustom('3x - 5 = 10');

    a = await say(a.id, '3x = 5');
    expect(a.steps.at(-1)!.isCorrect).toBe(false);
    expect(a.mode).toBe('REMEDIATION');
    expect(lastTutor(a)).toMatchObject({
      kind: 'NOTICE',
      meta: { correct: false, aiUnavailable: 'provider_error' },
    });

    // A failed hint request does not use up a level of the ladder.
    a = await hint(a.id);
    expect(a.hintLevel).toBe(1);

    a = await say(a.id, '3x = 15');
    expect(a.steps.at(-1)!.isCorrect).toBe(true);
    expect(lastTutor(a)).toMatchObject({ kind: 'NOTICE', meta: { correct: true } });

    a = await say(a.id, 'x = 5');
    expect(a.mode).toBe('CHECKING'); // the request to check is fixed copy: no model needed
    a = await say(a.id, '10 = 10');
    expect(a.status).toBe('SOLVED');
    expect(lastTutor(a)).toMatchObject({ kind: 'NOTICE', meta: { solved: true } });
  });

  it('writes a turn all or nothing: a failing write leaves the attempt as it was', async () => {
    const before = await startCustom('4(x + 1) = 2x + 10');
    // The mistake is written in the middle of the turn: after the student message and the
    // step, before the attempt update and the tutor's hint.
    const failing = jest
      .spyOn(AttemptRepository.prototype, 'insertMistake')
      .mockRejectedValue(new Error('disk full'));

    await agent
      .post(`/api/attempts/${before.id}/messages`)
      .send({ text: '4x + 1 = 2x + 10' })
      .expect(500);
    const after = (await agent.get(`/api/attempts/${before.id}`).expect(200)).body as AttemptView;
    expect(after).toEqual(before);

    // The turn lock was released, and the next turn works normally.
    failing.mockRestore();
    const next = await say(before.id, '4x + 1 = 2x + 10');
    expect(next.mode).toBe('REMEDIATION');
    expect(next.steps).toHaveLength(1);
  });

  it('opens one attempt per problem even when "start" is clicked several times at once', async () => {
    const student = request.agent(server);
    await student.post('/api/auth/demo').send({}).expect(200);
    const problems = (await student.get('/api/problems').expect(200)).body as ProblemView[];
    const featured = problems.find((p) => p.featured)!;

    const started = await Promise.all(
      Array.from({ length: 5 }, () =>
        student.post('/api/attempts').send({ problemId: featured.id }).expect(201),
      ),
    );
    const ids = new Set(started.map((r) => (r.body as AttemptView).id));
    expect(ids.size).toBe(1);
    const list = (await student.get('/api/attempts').expect(200)).body as AttemptSummary[];
    expect(
      list.filter((a) => a.equation === featured.equation && a.status === 'IN_PROGRESS'),
    ).toHaveLength(1);
    // Exactly one greeting: the losing requests wrote nothing.
    const view = started[0]!.body as AttemptView;
    expect(view.messages.filter((m) => m.kind === 'GREETING')).toHaveLength(1);
  });

  it('releases the turn lock: consecutive turns on one attempt both go through', async () => {
    const a = await startCustom('x + 4 = 9');
    await say(a.id, 'why?');
    await say(a.id, 'how?');
    const next = await say(a.id, 'x = 5');
    expect(next.mode).toBe('CHECKING');
  });

  it('lets a turn through once a stuck lease has expired', async () => {
    const a = await startCustom('x + 6 = 8');
    const lock = app.get(AttemptLock);
    const me = ((await agent.get('/api/auth/me').expect(200)).body as UserView).id;
    // Someone else cannot take the lock on this attempt (it does not exist for them).
    expect(await lock.acquire(randomUUID(), a.id)).toBe('missing');

    // An instance took the lock and died without releasing it.
    const held = await lock.acquire(me, a.id);
    expect(held).toHaveProperty('token');

    const blocked = await agent.post(`/api/attempts/${a.id}/messages`).send({ text: 'why?' });
    expect(blocked.status).toBe(409);
    expect((blocked.body as ApiErrorBody).code).toBe('BUSY');

    await new Promise((r) => setTimeout(r, 1700)); // lease is 1.5 s in tests
    await say(a.id, 'why?');
  });

  it('rejects overlapping turns and messages to a finished problem', async () => {
    const real = provider.completeJson.bind(provider);
    jest.spyOn(provider, 'completeJson').mockImplementation(async (...args) => {
      await new Promise((r) => setTimeout(r, 300));
      return real(...args);
    });
    const a = await startCustom('x + 2 = 5');
    const send = () => agent.post(`/api/attempts/${a.id}/messages`).send({ text: 'why?' });
    const [first, second] = await Promise.all([send(), send()]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    expect([first, second].map((r) => (r.body as ApiErrorBody).code)).toContain('BUSY');

    await say(a.id, 'x = 3');
    await say(a.id, '5 = 5');
    const closed = await agent.post(`/api/attempts/${a.id}/messages`).send({ text: 'x = 3' });
    expect(closed.status).toBe(409);
    expect((closed.body as ApiErrorBody).code).toBe('ATTEMPT_CLOSED');
  });

  it('deletes demo accounts older than a week, with everything they own', async () => {
    const pool = new Pool({ connectionString: DB_URL });
    try {
      const user = async (isDemo: boolean, daysOld: number) => {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO users (name, is_demo, created_at) VALUES ('t', $1, now() - $2 * interval '1 day') RETURNING id`,
          [isDemo, daysOld],
        );
        return rows[0]!.id;
      };
      const oldDemo = await user(true, 8);
      const newDemo = await user(true, 1);
      const oldRegular = await user(false, 30);
      await pool.query(
        `INSERT INTO attempts (user_id, title, equation, current_line) VALUES ($1, 't', 'x = 1', 'x = 1')`,
        [oldDemo],
      );

      // Older demo users from earlier tests (none) and this one: exactly one is due.
      expect(await app.get(DemoCleanupService).deleteExpired()).toBe(1);

      const left = await pool.query<{ id: string }>('SELECT id FROM users WHERE id = ANY($1)', [
        [oldDemo, newDemo, oldRegular],
      ]);
      expect(left.rows.map((r) => r.id).sort()).toEqual([newDemo, oldRegular].sort());
      const orphans = await pool.query('SELECT 1 FROM attempts WHERE user_id = $1', [oldDemo]);
      expect(orphans.rowCount).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('registers, logs out and logs in with email and password', async () => {
    const user = request.agent(server);
    const credentials = { email: 'Student@Example.com', password: 'correct-horse-1' };
    await user
      .post('/api/auth/register')
      .send({ ...credentials, name: 'Student', locale: 'uk' })
      .expect(201);
    expect((await user.get('/api/auth/me').expect(200)).body).toMatchObject({
      email: 'student@example.com',
      locale: 'uk',
    });

    const duplicate = await request(server)
      .post('/api/auth/register')
      .send({ ...credentials, name: 'Twin' })
      .expect(409);
    expect((duplicate.body as ApiErrorBody).code).toBe('EMAIL_TAKEN');

    await user.post('/api/auth/logout').send({}).expect(204);
    await user.get('/api/auth/me').expect(401);
    await user
      .post('/api/auth/login')
      .send({ ...credentials, password: 'wrong-pass' })
      .expect(401);
    await user.post('/api/auth/login').send(credentials).expect(200);
    await user.get('/api/auth/me').expect(200);
  });
});
