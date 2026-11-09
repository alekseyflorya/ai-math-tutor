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
import type { NestExpressApplication } from '@nestjs/platform-express';
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
import { LLM_PROVIDER, type LlmProvider } from '../src/llm/llm.types';
import { AttemptRepository } from '../src/tutor/attempt.repository';

const DB_URL = process.env.DATABASE_URL_TEST ?? 'postgres://tutor:tutor@localhost:5433/tutor_test';

Object.assign(process.env, {
  NODE_ENV: 'test',
  DATABASE_URL: DB_URL,
  LLM_PROVIDER: 'mock',
  JWT_SECRET: 'test-secret-test-secret-test-secret-123',
  COOKIE_SECURE: 'false',
});

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
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    configureApp(app as NestExpressApplication);
    await app.init();
    server = app.getHttpServer() as App;
    agent = request.agent(server);
    provider = app.get<LlmProvider>(LLM_PROVIDER);
  });

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

    // 1. The classic mistake: only the first term was multiplied.
    a = await say(a.id, '3x + 4 = 2x + 19');
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

    // 4. Any equivalent path is accepted; finish.
    a = await say(a.id, '3x - 2x = 19 - 12');
    a = await say(a.id, 'x = 7');
    expect(a.status).toBe('SOLVED');
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

    // 5. Follow-up targets the same skill and was validated by the math engine.
    let f = (await agent.get(`/api/attempts/${a.nextAttemptId}`).expect(200)).body as AttemptView;
    expect(f.isFollowUp).toBe(true);
    expect(f.targetErrorType).toBe('DISTRIBUTION');
    expect(f.equation).toBe('5(x - 2) = 3x + 4');

    f = await say(f.id, '5x - 10 = 3x + 4');
    f = await say(f.id, '2x = 14');
    f = await say(f.id, 'x = 7');
    expect(f.status).toBe('SOLVED');

    expect(f.understandingVerified).toBe(true);
    expect(f.parentAttemptId).toBe(a.id);
    const original = (await agent.get(`/api/attempts/${a.id}`).expect(200)).body as AttemptView;
    expect(original.nextAttemptStatus).toBe('SOLVED');
    expect(original.understandingVerified).toBe(true);

    // 6. Progress: the distribution mistake is corrected AND verified.
    const progress = (await agent.get('/api/progress').expect(200)).body as ProgressView;
    const dist = progress.mistakesByType.find((m) => m.errorType === 'DISTRIBUTION')!;
    expect(dist).toEqual({ errorType: 'DISTRIBUTION', total: 1, corrected: 1, verified: 1 });
    expect(progress.skills.find((s) => s.skill === 'distribution')!.attempts).toBeGreaterThan(0);
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
    const closed = await agent.post(`/api/attempts/${a.id}/messages`).send({ text: 'x = 3' });
    expect(closed.status).toBe(409);
    expect((closed.body as ApiErrorBody).code).toBe('ATTEMPT_CLOSED');
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
