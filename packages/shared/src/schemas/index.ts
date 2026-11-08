import { z } from 'zod';

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
export type MessageKind =
  | 'STEP'
  | 'CHAT'
  | 'GREETING'
  | 'FEEDBACK'
  | 'HINT'
  | 'EXPLANATION'
  | 'CELEBRATION'
  | 'FOLLOW_UP'
  | 'NOTICE';

export interface MessageView {
  id: string;
  role: MessageRole;
  kind: MessageKind;
  content: string;
  createdAt: string;
  /** e.g. { hintLevel: 2, errorType: 'DISTRIBUTION', nextAttemptId: '...' } */
  meta: Record<string, unknown> | null;
}

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
  recentAttempts: {
    id: string;
    title: string;
    equation: string;
    status: AttemptStatus;
    isFollowUp: boolean;
    updatedAt: string;
  }[];
  /** Solved problems per day, last 14 days. */
  activity: { date: string; solved: number; steps: number }[];
}

export interface ApiErrorBody {
  statusCode: number;
  code: string;
  message: string;
}
