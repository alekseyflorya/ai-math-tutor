import type { LlmJsonRequest, LlmProvider } from '../llm.types';

/**
 * Deterministic stand-in used ONLY by automated tests (env validation forbids it in
 * production). It lets e2e tests exercise the real state machine — routing, hint
 * escalation, mistake tracking, follow-up validation — without network calls.
 * Every message is prefixed with [mock] so it can never pass for real tutoring.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly model = 'mock-1';

  async completeJson(req: LlmJsonRequest<unknown>): Promise<string> {
    const p = req.prompt;
    switch (req.purpose) {
      case 'diagnose': {
        const lastLine = /Last line verified as correct \(math engine\): (.*)/.exec(p)?.[1] ?? '';
        const errorType = lastLine.includes('(') ? 'DISTRIBUTION' : 'SIGN_TRANSFER';
        return JSON.stringify({
          errorType,
          misconception:
            errorType === 'DISTRIBUTION'
              ? 'Multiplied only the first term inside the brackets by the coefficient.'
              : 'Moved a term across the equals sign without changing its sign.',
          message: '[mock] Look at the brackets: what happens to every term inside when you multiply?',
        });
      }
      case 'chat': {
        const understood = /understand|got it|both|each|розумію|кожен|обидва/i.test(
          /<student_input>([\s\S]*)<\/student_input>/.exec(p)?.[1] ?? '',
        );
        return JSON.stringify({
          message: understood ? '[mock] Exactly. Rewrite the step.' : '[mock] Here is the next hint.',
          understood,
          escalate: !understood && p.includes('Mistake being worked on'),
        });
      }
      case 'follow_up':
        return JSON.stringify(
          p.includes('DISTRIBUTION')
            ? { equation: '5(x - 2) = 3x + 4', rationale: 'Brackets with a coefficient again.' }
            : { equation: '7x - 4 = 3x + 12', rationale: 'x on both sides again.' },
        );
      default:
        return JSON.stringify({ message: `[mock] ${req.purpose}` });
    }
  }
}
