import {
  describeSolution,
  evaluateSide,
  formatEquation,
  formatLinear,
  isFinalForm,
  parseEquation,
  sameSolutionSet,
  solve,
  type ParsedEquation,
  type SolutionSet,
} from './equation';

export interface StepCheckResult {
  /** The step keeps exactly the same solution set as the previous (verified) line. */
  equivalent: boolean;
  /** Equivalent AND written as "x = number": the problem is solved. */
  solved: boolean;
  /** Step is in final form ("x = n") — may still be wrong. */
  finalForm: boolean;
  previous: ParsedEquation;
  current: ParsedEquation;
  previousSolution: SolutionSet;
  currentSolution: SolutionSet;
  /**
   * Deterministic facts handed to the LLM so its diagnosis is grounded in math we
   * computed, not math it guessed. Written in plain English for the prompt.
   */
  facts: string[];
}

/**
 * Compares a student's new line with the last line we know is correct.
 * Two linear equations are equivalent iff they have the same solution set, which
 * we compute exactly. This is the source of truth for "is this step right?" —
 * the LLM is only asked *why* a wrong step is wrong.
 */
export function checkStep(previousRaw: string, currentRaw: string, variable = 'x'): StepCheckResult {
  const previous = parseEquation(previousRaw);
  const current = parseEquation(currentRaw, { variable });
  const previousSolution = solve(previous);
  const currentSolution = solve(current);
  const equivalent = sameSolutionSet(previousSolution, currentSolution);
  const finalForm = isFinalForm(current);

  const facts: string[] = [
    `Previous line, expanded and simplified per side: ${formatEquation(previous, variable)}`,
    `Student's line, expanded and simplified per side: ${formatEquation(current, variable)}`,
    `Solution of the previous line: ${describeSolution(previousSolution, variable)}`,
    `Solution of the student's line: ${describeSolution(currentSolution, variable)}`,
    equivalent
      ? 'The step is mathematically equivalent (same solution set).'
      : 'The step is NOT equivalent: the solution changed, so a reasoning error happened in this step.',
  ];

  if (!equivalent && previousSolution.kind === 'unique') {
    const v = previousSolution.value;
    const l = evaluateSide(current.left, v);
    const r = evaluateSide(current.right, v);
    facts.push(
      `Substituting the correct value ${variable} = ${v.toString()} into the student's line gives ` +
        `left side ${l.toString()} and right side ${r.toString()} (they should be equal).`,
    );
  }

  if (!equivalent) {
    // Side-by-side comparison helps spot distribution / sign errors. It is only a hint:
    // a legitimate rearrangement also changes sides, so the LLM is told to reason about it.
    facts.push(
      `Side comparison (previous → student): left ${formatLinear(previous.left, variable)} → ${formatLinear(current.left, variable)}; ` +
        `right ${formatLinear(previous.right, variable)} → ${formatLinear(current.right, variable)}.`,
    );
  }

  return {
    equivalent,
    solved: equivalent && finalForm,
    finalForm,
    previous,
    current,
    previousSolution,
    currentSolution,
    facts,
  };
}
