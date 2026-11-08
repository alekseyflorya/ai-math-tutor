import { Injectable, Logger } from '@nestjs/common';
import {
  MathInputError,
  normalizeMathInput,
  parseEquation,
  solve,
  type ErrorType,
  type ParsedEquation,
} from '@tutor/shared';
import { LlmService } from '../llm/llm.service';
import { LlmUnavailableError } from '../llm/llm.types';
import { followUpPrompt, systemPrompt } from '../llm/prompts';
import { FollowUpSchema } from '../llm/tutor-schemas';

export interface GeneratedProblem {
  equation: string;
  source: 'llm' | 'template';
}

const MAX_LLM_TRIES = 2;

/**
 * Personalised practice: the model invents a problem aimed at the exact mistake,
 * and the math engine acts as a referee — the problem must parse, be linear, have
 * one whole-number solution, be new, and actually contain the trap being tested.
 * A rejected proposal goes back to the model with the reason.
 */
@Injectable()
export class FollowUpService {
  private readonly logger = new Logger(FollowUpService.name);

  constructor(private readonly llm: LlmService) {}

  async generate(params: {
    userId: string;
    source: string;
    errorType: ErrorType;
    misconception: string;
    avoid: string[];
    /** Epoch ms; when it passes, the verified template is used instead. */
    deadline: number;
  }): Promise<GeneratedProblem> {
    let rejection: string | undefined;
    for (let i = 0; i < MAX_LLM_TRIES; i++) {
      try {
        const out = await this.llm.generate(
          {
            purpose: 'follow_up',
            system: systemPrompt('en'),
            prompt: followUpPrompt(
              params.source,
              params.errorType,
              params.misconception,
              params.avoid,
              rejection,
            ),
            schema: FollowUpSchema,
            temperature: 0.9,
            deadline: params.deadline,
          },
          params.userId,
        );
        rejection = validateFollowUp(out.equation, params.errorType, [
          params.source,
          ...params.avoid,
        ]);
        if (!rejection) return { equation: out.equation.trim(), source: 'llm' };
        this.logger.warn(`Follow-up "${out.equation}" rejected: ${rejection}`);
      } catch (e) {
        if (!(e instanceof LlmUnavailableError)) throw e;
        break; // timeout, quota or outage: don't spend the turn on more tries
      }
    }
    // The model is down or kept missing the constraints: fall back to a verified template.
    return { equation: templateProblem(params.errorType), source: 'template' };
  }
}

/** Returns a rejection reason, or undefined when the problem is acceptable. */
export function validateFollowUp(
  equation: string,
  errorType: ErrorType,
  avoid: string[],
): string | undefined {
  let eq: ParsedEquation;
  try {
    eq = parseEquation(equation);
  } catch (e) {
    return e instanceof MathInputError ? `cannot be parsed (${e.message})` : 'cannot be parsed';
  }
  if (eq.variable !== 'x') return 'the unknown must be x';
  const s = solve(eq);
  if (s.kind !== 'unique') return 'it must have exactly one solution';
  if (!s.value.isInteger() || !s.value.fitsWithin(20))
    return 'the solution must be a whole number between -20 and 20';
  const norm = normalizeMathInput(equation).replace(/\s/g, '');
  if (avoid.some((a) => normalizeMathInput(a).replace(/\s/g, '') === norm))
    return 'it repeats an earlier problem';
  if (errorType === 'DISTRIBUTION' && !eq.features.hasDistribution) {
    return 'it must contain a bracket with x multiplied by a number, e.g. 4(x - 3)';
  }
  if (
    (errorType === 'SIGN_TRANSFER' || errorType === 'COMBINING_LIKE_TERMS') &&
    !eq.features.variableOnBothSides
  ) {
    return 'x must appear on both sides of the equation';
  }
  return undefined;
}

const rand = (min: number, max: number) => min + Math.floor(Math.random() * (max - min + 1));
const signed = (n: number) => (n < 0 ? `- ${-n}` : `+ ${n}`);

/** Parametrised templates that always produce an integer solution (and are re-validated). */
export function templateProblem(errorType: ErrorType): string {
  for (;;) {
    const x = rand(-6, 12);
    let eq: string;
    if (errorType === 'DISTRIBUTION') {
      const a = rand(2, 6);
      const b = rand(1, 9) * (Math.random() < 0.5 ? -1 : 1);
      const c = rand(1, a - 1);
      const d = a * (x + b) - c * x;
      eq = `${a}(x ${signed(b)}) = ${c === 1 ? '' : c}x ${signed(d)}`;
    } else if (errorType === 'SIGN_TRANSFER' || errorType === 'COMBINING_LIKE_TERMS') {
      const a = rand(4, 9);
      const c = rand(1, a - 1);
      const b = rand(-9, 9) || 3;
      const d = (a - c) * x + b;
      eq = `${a}x ${signed(b)} = ${c === 1 ? '' : c}x ${signed(d)}`;
    } else {
      const a = rand(2, 9);
      const b = rand(-9, 9) || 4;
      eq = `${a}x ${signed(b)} = ${a * x + b}`;
    }
    if (!validateFollowUp(eq, errorType, [])) return eq;
  }
}
