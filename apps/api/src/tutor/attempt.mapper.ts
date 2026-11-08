import { parseEquation, type AttemptView } from '@tutor/shared';
import type { Attempt, Message, Step } from '../db/schema';

const latexOf = (equation: string) => {
  try {
    return parseEquation(equation).latex;
  } catch {
    return equation;
  }
};

export function toAttemptView(a: Attempt, steps: Step[], messages: Message[], nextAttemptId: string | null): AttemptView {
  return {
    id: a.id,
    equation: a.equation,
    latex: latexOf(a.equation),
    title: a.title,
    status: a.status,
    mode: a.mode,
    hintLevel: a.hintLevel,
    currentLine: a.currentLine,
    currentLatex: latexOf(a.currentLine),
    isFollowUp: Boolean(a.parentAttemptId),
    targetErrorType: a.targetErrorType ?? null,
    steps: steps.map((s) => ({ id: s.id, input: s.input, latex: s.latex, isCorrect: s.isCorrect, index: s.index })),
    messages: messages.map((m) => ({
      id: m.id,
      role: m.role,
      kind: m.kind,
      content: m.content,
      createdAt: m.createdAt.toISOString(),
      meta: m.meta ?? null,
    })),
    nextAttemptId,
  };
}
