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
import type { AttemptView, ProblemView, ProgressView } from '@tutor/shared';

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
  let agent: ReturnType<typeof request.agent>;

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
    agent = request.agent(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  const say = async (attemptId: string, text: string): Promise<AttemptView> => {
    const res = await agent.post(`/api/attempts/${attemptId}/messages`).send({ text });
    if (res.status !== 200) throw new Error(`${text}: ${res.status} ${JSON.stringify(res.body)}`);
    return res.body as AttemptView;
  };
  const lastTutor = (a: AttemptView) => [...a.messages].reverse().find((m) => m.role === 'TUTOR')!;

  it('rejects unauthenticated and non-JSON requests', async () => {
    await request(app.getHttpServer()).get('/api/progress').expect(401);
    await request(app.getHttpServer())
      .post('/api/auth/demo')
      .type('form')
      .send('locale=en')
      .expect(415);
  });

  it('creates an isolated demo student with seeded history', async () => {
    const res = await agent.post('/api/auth/demo').send({ locale: 'en' }).expect(200);
    expect(res.body.isDemo).toBe(true);
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
    const other = request.agent(app.getHttpServer());
    await other.post('/api/auth/demo').send({}).expect(200);
    await other.get(`/api/attempts/${mine.id}`).expect(404);
  });
});
