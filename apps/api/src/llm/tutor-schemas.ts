import { ErrorTypeSchema } from '@tutor/shared';
import { z } from 'zod';

const message = z
  .string()
  .min(1)
  .max(900)
  .describe('What the tutor says to the student. Short; math inline between $...$.');

export const DiagnosisSchema = z.object({
  errorType: ErrorTypeSchema.describe('The single best-fitting category for this mistake'),
  misconception: z
    .string()
    .min(5)
    .max(400)
    .describe(
      'Teacher-facing, one sentence: which transformation went wrong and the faulty belief behind it',
    ),
  message,
});
export type Diagnosis = z.infer<typeof DiagnosisSchema>;

/** A slip while checking the answer: always ARITHMETIC (the engine knows), so no category. */
export const CheckDiagnosisSchema = z.object({
  misconception: z
    .string()
    .min(5)
    .max(400)
    .describe('Teacher-facing, one sentence: which calculation of the check went wrong'),
  message,
});
export type CheckDiagnosis = z.infer<typeof CheckDiagnosisSchema>;

export const FeedbackSchema = z.object({ message });
export type Feedback = z.infer<typeof FeedbackSchema>;

export const ChatReplySchema = z.object({
  message,
  understood: z
    .boolean()
    .describe('True if the student’s words show they now understand the rule they broke'),
  escalate: z
    .boolean()
    .describe('True if this reply gives the NEXT hint level because the student is still stuck'),
});
export type ChatReply = z.infer<typeof ChatReplySchema>;

export const FollowUpSchema = z.object({
  equation: z
    .string()
    .min(3)
    .max(80)
    .describe('A linear equation in x in plain text, e.g. "5(x - 2) = 3x + 4"'),
  rationale: z.string().max(300).describe('Why this problem tests the same skill'),
});
export type FollowUp = z.infer<typeof FollowUpSchema>;
