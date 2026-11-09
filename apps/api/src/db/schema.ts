import { sql } from 'drizzle-orm';
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  real,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { ERROR_TYPES } from '@tutor/shared';

export const attemptStatus = pgEnum('attempt_status', ['IN_PROGRESS', 'SOLVED', 'ABANDONED']);
export const tutorMode = pgEnum('tutor_mode', ['SOLVING', 'REMEDIATION']);
export const messageRole = pgEnum('message_role', ['STUDENT', 'TUTOR', 'SYSTEM']);
export const messageKind = pgEnum('message_kind', [
  'STEP',
  'CHAT',
  'GREETING',
  'FEEDBACK',
  'HINT',
  'EXPLANATION',
  'CELEBRATION',
  'FOLLOW_UP',
  'NOTICE',
]);
export const errorType = pgEnum('error_type', ERROR_TYPES);

const id = () => uuid('id').primaryKey().defaultRandom();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();

export const users = pgTable('users', {
  id: id(),
  email: text('email').unique(),
  passwordHash: text('password_hash'),
  name: text('name').notNull(),
  isDemo: boolean('is_demo').notNull().default(false),
  locale: text('locale').notNull().default('en'),
  createdAt: createdAt(),
});

/** Curriculum problem. Synced from code on boot; ordered "simple → complex". */
export const problems = pgTable('problems', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  titleUk: text('title_uk').notNull(),
  equation: text('equation').notNull(),
  difficulty: integer('difficulty').notNull(),
  skills: text('skills')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  order: integer('order').notNull(),
  featured: boolean('featured').notNull().default(false),
});

export const attempts = pgTable(
  'attempts',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    problemId: text('problem_id').references(() => problems.id),
    title: text('title').notNull(),
    equation: text('equation').notNull(),
    variable: text('variable').notNull().default('x'),
    status: attemptStatus('status').notNull().default('IN_PROGRESS'),
    mode: tutorMode('mode').notNull().default('SOLVING'),
    hintLevel: integer('hint_level').notNull().default(0),
    /** Last line verified as correct; each new step is checked against it. */
    currentLine: text('current_line').notNull(),
    /** Mistake being remediated while mode = REMEDIATION. */
    activeMistakeId: uuid('active_mistake_id').references((): AnyPgColumn => mistakes.id, {
      onDelete: 'set null',
    }),
    /** Follow-up practice: the attempt it came from and the error it verifies. */
    parentAttemptId: uuid('parent_attempt_id').references((): AnyPgColumn => attempts.id, {
      onDelete: 'set null',
    }),
    targetErrorType: errorType('target_error_type'),
    sourceMistakeId: uuid('source_mistake_id').references((): AnyPgColumn => mistakes.id, {
      onDelete: 'set null',
    }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    solvedAt: timestamp('solved_at', { withTimezone: true }),
    /** Turn lock (lease): set while a turn runs; see AttemptLock. */
    busyUntil: timestamp('busy_until', { withTimezone: true }),
    /** Who holds the lease: released only by the holder's token. */
    busyToken: uuid('busy_token'),
  },
  (t) => [
    index('attempts_user_updated_idx').on(t.userId, t.updatedAt),
    index('attempts_parent_idx').on(t.parentAttemptId),
    // One open attempt per student and curriculum problem: a double click cannot create two.
    uniqueIndex('attempts_one_open_per_problem_idx')
      .on(t.userId, t.problemId)
      .where(sql`${t.status} = 'IN_PROGRESS'`),
  ],
);

export const steps = pgTable(
  'steps',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    index: integer('index').notNull(),
    input: text('input').notNull(),
    latex: text('latex').notNull(),
    isCorrect: boolean('is_correct').notNull(),
    createdAt: createdAt(),
  },
  (t) => [index('steps_attempt_idx').on(t.attemptId, t.index)],
);

export const messages = pgTable(
  'messages',
  {
    id: id(),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    /** Strict insertion order (timestamps can tie). */
    seq: serial('seq').notNull(),
    role: messageRole('role').notNull(),
    kind: messageKind('kind').notNull(),
    content: text('content').notNull(),
    meta: jsonb('meta').$type<Record<string, unknown> | null>(),
    createdAt: createdAt(),
  },
  (t) => [index('messages_attempt_idx').on(t.attemptId, t.seq)],
);

export const mistakes = pgTable(
  'mistakes',
  {
    id: id(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    attemptId: uuid('attempt_id')
      .notNull()
      .references(() => attempts.id, { onDelete: 'cascade' }),
    errorType: errorType('error_type').notNull(),
    /** Teacher-facing diagnosis of the misconception, written by the LLM. */
    description: text('description').notNull(),
    previousLine: text('previous_line').notNull(),
    stepInput: text('step_input').notNull(),
    hintsUsed: integer('hints_used').notNull().default(0),
    corrected: boolean('corrected').notNull().default(false),
    correctedAt: timestamp('corrected_at', { withTimezone: true }),
    /** Set when a targeted follow-up is solved without repeating this error. */
    verified: boolean('verified').notNull().default(false),
    verifiedAt: timestamp('verified_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('mistakes_user_created_idx').on(t.userId, t.createdAt),
    index('mistakes_attempt_idx').on(t.attemptId),
  ],
);

export const skillStats = pgTable(
  'skill_stats',
  {
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    skill: text('skill').notNull(),
    /** 0..1 exponential moving average of outcomes on this skill. */
    mastery: real('mastery').notNull().default(0.5),
    attempts: integer('attempts').notNull().default(0),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.skill] })],
);

/** Every model call: drives daily quotas and gives basic observability. */
export const llmCalls = pgTable(
  'llm_calls',
  {
    id: id(),
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    purpose: text('purpose').notNull(),
    provider: text('provider').notNull(),
    model: text('model').notNull(),
    ok: boolean('ok').notNull(),
    latencyMs: integer('latency_ms').notNull(),
    error: text('error'),
    createdAt: createdAt(),
  },
  (t) => [
    index('llm_calls_created_idx').on(t.createdAt),
    index('llm_calls_user_created_idx').on(t.userId, t.createdAt),
  ],
);

export type User = typeof users.$inferSelect;
export type Problem = typeof problems.$inferSelect;
export type Attempt = typeof attempts.$inferSelect;
export type Step = typeof steps.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Mistake = typeof mistakes.$inferSelect;
