import { z } from 'zod';
import { MATH_ERROR_CODES } from '../math/errors';

export const LOCALES = ['en', 'uk'] as const;
export const LocaleSchema = z.enum(LOCALES);
export type Locale = z.infer<typeof LocaleSchema>;

/**
 * Error taxonomy the tutor diagnoses. Typed (not free text) so mistakes can be
 * counted, tracked over time, and targeted by follow-up problems.
 */
export const ERROR_TYPES = [
  'DISTRIBUTION', // 3(x + 4) → 3x + 4
  'SIGN_TRANSFER', // moved a term across "=" without changing its sign
  'COMBINING_LIKE_TERMS', // 3x + 2x → 6x, or mixing x-terms with numbers
  'INVERSE_OPERATION', // divided instead of multiplied, subtracted instead of divided...
  'ONE_SIDE_ONLY', // applied an operation to one side / one term only
  'ARITHMETIC', // 19 - 12 = 8
  'OTHER',
] as const;
export const ErrorTypeSchema = z.enum(ERROR_TYPES);
export type ErrorType = z.infer<typeof ErrorTypeSchema>;

export const SKILLS = [
  'distribution',
  'transfer',
  'like_terms',
  'isolate_variable',
  'arithmetic',
] as const;
export type Skill = (typeof SKILLS)[number];

export const ERROR_TO_SKILL: Record<ErrorType, Skill> = {
  DISTRIBUTION: 'distribution',
  SIGN_TRANSFER: 'transfer',
  COMBINING_LIKE_TERMS: 'like_terms',
  INVERSE_OPERATION: 'isolate_variable',
  ONE_SIDE_ONLY: 'isolate_variable',
  ARITHMETIC: 'arithmetic',
  OTHER: 'arithmetic',
};

// --- Auth -------------------------------------------------------------------

export const RegisterSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(8).max(72),
  name: z.string().trim().min(1).max(50),
  locale: LocaleSchema.default('en'),
});
export type RegisterInput = z.infer<typeof RegisterSchema>;

export const LoginSchema = z.object({
  email: z
    .email()
    .max(254)
    .transform((v) => v.toLowerCase()),
  password: z.string().min(1).max(72),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const UpdateMeSchema = z.object({ locale: LocaleSchema });

/** POST /auth/demo — every call creates an isolated demo student. */
export const DemoSchema = z.object({ locale: LocaleSchema.default('en') });
export type DemoInput = z.infer<typeof DemoSchema>;

export interface UserView {
  id: string;
  name: string;
  email: string | null;
  isDemo: boolean;
  locale: Locale;
}

// --- Tutor ------------------------------------------------------------------

export const StartAttemptSchema = z
  .object({
    problemId: z.string().min(1).max(64).optional(),
    equation: z.string().trim().min(3).max(120).optional(),
    /** Start a fresh attempt even if this problem was already solved (otherwise the solved one opens). */
    restart: z.boolean().optional(),
  })
  .refine((v) => Boolean(v.problemId) !== Boolean(v.equation), {
    message: 'Provide either problemId or equation',
  });
export type StartAttemptInput = z.infer<typeof StartAttemptSchema>;

export const SubmitSchema = z.object({
  text: z.string().trim().min(1).max(400),
});
export type SubmitInput = z.infer<typeof SubmitSchema>;

export type AttemptStatus = 'IN_PROGRESS' | 'SOLVED' | 'ABANDONED';
/** SOLVING: working forward. REMEDIATION: a wrong step is being worked through. */
export type TutorMode = 'SOLVING' | 'REMEDIATION';

export interface StepView {
  id: string;
  input: string;
  latex: string;
  isCorrect: boolean;
  index: number;
}

export type MessageRole = 'STUDENT' | 'TUTOR' | 'SYSTEM';
export const MESSAGE_KINDS = [
  'STEP',
  'CHAT',
  'GREETING',
  'FEEDBACK',
  'HINT',
  'EXPLANATION',
  'CELEBRATION',
  'FOLLOW_UP',
  'NOTICE',
] as const;
export type MessageKind = (typeof MESSAGE_KINDS)[number];

/** Why the tutor answered without the model (shown as a notice, steps are still checked). */
export const AI_UNAVAILABLE_REASONS = [
  'quota_user',
  'quota_global',
  'rate_limited',
  'timeout',
  'invalid_output',
  'provider_error',
] as const;
export type AiUnavailableReason = (typeof AI_UNAVAILABLE_REASONS)[number];

const HintLevelSchema = z.number().int().min(1).max(3);

/**
 * What each kind of message carries besides its text. The API writes meta only through these
 * shapes; reading, a row that does not match (older or unexpected data) is shown with meta null.
 */
export const MESSAGE_META = {
  STEP: z.null(),
  GREETING: z.null(),
  /** A student's question, or the tutor's chat reply. */
  CHAT: z.object({ understood: z.literal(true) }).nullable(),
  FEEDBACK: z.object({ correct: z.literal(true), fixedErrorType: ErrorTypeSchema.nullable() }),
  HINT: z.object({
    hintLevel: HintLevelSchema,
    errorType: ErrorTypeSchema.optional(),
    correct: z.literal(false).optional(),
    requested: z.literal(true).optional(),
  }),
  CELEBRATION: z.object({ solved: z.literal(true) }),
  FOLLOW_UP: z.object({
    nextAttemptId: z.string(),
    equation: z.string(),
    errorType: ErrorTypeSchema,
    source: z.enum(['llm', 'template']),
  }),
  NOTICE: z
    .object({
      aiUnavailable: z.enum(AI_UNAVAILABLE_REASONS).optional(),
      correct: z.boolean().optional(),
      solved: z.literal(true).optional(),
      repeatedLine: z.literal(true).optional(),
      inputError: z.enum(MATH_ERROR_CODES).optional(),
    })
    .nullable(),
} satisfies Record<Exclude<MessageKind, 'EXPLANATION'>, z.ZodType>;

/** Level 3 of the hint ladder is an explanation; same meta as a hint. */
const metaSchemaOf = (kind: MessageKind) =>
  kind === 'EXPLANATION' ? MESSAGE_META.HINT : MESSAGE_META[kind];

export type MessageMeta<K extends MessageKind> = z.infer<
  K extends 'EXPLANATION'
    ? (typeof MESSAGE_META)['HINT']
    : (typeof MESSAGE_META)[Exclude<K, 'EXPLANATION'>]
>;
export type HintMeta = MessageMeta<'HINT'>;
export type FeedbackMeta = MessageMeta<'FEEDBACK'>;
export type FollowUpMeta = MessageMeta<'FOLLOW_UP'>;
export type NoticeMeta = NonNullable<MessageMeta<'NOTICE'>>;

/** Validates stored meta for a kind; null when it does not match. */
export function parseMessageMeta<K extends MessageKind>(
  kind: K,
  meta: unknown,
): { ok: true; meta: MessageMeta<K> | null } | { ok: false } {
  const parsed = metaSchemaOf(kind).safeParse(meta ?? null);
  return parsed.success ? { ok: true, meta: parsed.data as MessageMeta<K> } : { ok: false };
}

/** One message; `meta` is typed by `kind` (null when absent or unreadable). */
export type MessageView = {
  [K in MessageKind]: {
    id: string;
    role: MessageRole;
    kind: K;
    content: string;
    createdAt: string;
    meta: MessageMeta<K> | null;
  };
}[MessageKind];

export interface AttemptView {
  id: string;
  equation: string;
  latex: string;
  variable: string;
  title: string;
  status: AttemptStatus;
  mode: TutorMode;
  hintLevel: number;
  /** Last line known to be correct; the next step is checked against it. */
  currentLine: string;
  currentLatex: string;
  isFollowUp: boolean;
  targetErrorType: ErrorType | null;
  steps: StepView[];
  messages: MessageView[];
  nextAttemptId: string | null;
  /** Status of that practice problem, so the original attempt can show "lesson consolidated". */
  nextAttemptStatus: AttemptStatus | null;
  /** For a practice problem: the attempt whose mistake it targets. */
  parentAttemptId: string | null;
  /** The targeted mistake was not repeated on the practice problem (understanding verified). */
  understandingVerified: boolean;
  /** Curriculum problem this attempt belongs to (null for custom equations and follow-ups). */
  problemId: string | null;
}

export interface ProblemView {
  id: string;
  title: string;
  equation: string;
  latex: string;
  difficulty: number;
  skills: Skill[];
  order: number;
  solved: boolean;
  recommended: boolean;
  /** The test-scenario problem, pinned at the top of the list. */
  featured: boolean;
}

export interface MistakeView {
  id: string;
  errorType: ErrorType;
  description: string;
  stepInput: string;
  corrected: boolean;
  verified: boolean;
  createdAt: string;
}

export interface ProgressView {
  totals: {
    attempts: number;
    solved: number;
    steps: number;
    correctSteps: number;
    accuracy: number;
    mistakes: number;
    correctedMistakes: number;
    verifiedMistakes: number;
    followUpsPassed: number;
  };
  mistakesByType: { errorType: ErrorType; total: number; corrected: number; verified: number }[];
  skills: { skill: Skill; mastery: number; attempts: number }[];
  recentMistakes: MistakeView[];
  recentAttempts: AttemptSummary[];
  /** Solved problems per day, last 14 days. */
  activity: { date: string; solved: number; steps: number }[];
}

/** GET /attempts?kind=custom — only equations the student typed in themselves. */
export const ListAttemptsQuerySchema = z.object({ kind: z.enum(['custom']).optional() });
export type ListAttemptsQuery = z.infer<typeof ListAttemptsQuerySchema>;

/** One row of GET /attempts and of the progress page. */
export interface AttemptSummary {
  id: string;
  title: string;
  equation: string;
  status: AttemptStatus;
  isFollowUp: boolean;
  updatedAt: string;
}

/** Stable, machine-readable error codes; the web app translates them, `message` is a fallback. */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'JSON_REQUIRED',
  'UNAUTHORIZED',
  'INVALID_CREDENTIALS',
  'EMAIL_TAKEN',
  'NOT_FOUND',
  'ATTEMPT_NOT_FOUND',
  'PROBLEM_NOT_FOUND',
  'ATTEMPT_CLOSED',
  'BUSY',
  'INVALID_EQUATION',
  'NO_UNIQUE_SOLUTION',
  'RATE_LIMITED',
  'DB_DOWN',
  'INTERNAL_ERROR',
] as const;
export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export const isApiErrorCode = (code: string): code is ApiErrorCode =>
  (API_ERROR_CODES as readonly string[]).includes(code);

export interface ApiErrorBody {
  statusCode: number;
  code: ApiErrorCode | (string & {});
  message: string;
}
