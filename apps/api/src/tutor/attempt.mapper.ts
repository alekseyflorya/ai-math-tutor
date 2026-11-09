import { Logger } from '@nestjs/common';
import { parseEquation, parseMessageMeta, type AttemptView, type MessageView } from '@tutor/shared';
import type { Attempt, Message, Step } from '../db/schema';

const latexOf = (equation: string) => {
  try {
    return parseEquation(equation).latex;
  } catch {
    return equation;
  }
};

export function toAttemptView(
  a: Attempt,
  steps: Step[],
  messages: Message[],
  next: { id: string; status: Attempt['status'] } | null,
  understandingVerified: boolean,
): AttemptView {
  return {
    id: a.id,
    equation: a.equation,
    latex: latexOf(a.equation),
    variable: a.variable,
    title: a.title,
    status: a.status,
    mode: a.mode,
    hintLevel: a.hintLevel,
    currentLine: a.currentLine,
    currentLatex: latexOf(a.currentLine),
    isFollowUp: Boolean(a.parentAttemptId),
    targetErrorType: a.targetErrorType ?? null,
    steps: steps.map((s) => ({
      id: s.id,
      input: s.input,
      latex: s.latex,
      isCorrect: s.isCorrect,
      index: s.index,
    })),
    messages: messages.map(toMessageView),
    nextAttemptId: next?.id ?? null,
    nextAttemptStatus: next?.status ?? null,
    parentAttemptId: a.parentAttemptId ?? null,
    understandingVerified,
    problemId: a.problemId ?? null,
  };
}

const logger = new Logger('AttemptMapper');

/**
 * Meta is checked against the contract for its kind. A stored row that does not match (older
 * data, a bug) is shown with meta null and logged, instead of failing the whole page.
 */
export function toMessageView(m: Message): MessageView {
  const parsed = parseMessageMeta(m.kind, m.meta);
  if (!parsed.ok) logger.warn(`Message ${m.id} (${m.kind}) has unexpected meta; shown without it`);
  return {
    id: m.id,
    role: m.role,
    kind: m.kind,
    content: m.content,
    createdAt: m.createdAt.toISOString(),
    meta: parsed.ok ? parsed.meta : null,
  } as MessageView;
}
