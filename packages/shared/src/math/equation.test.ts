import { describe, expect, it } from 'vitest';
import {
  classifyInput,
  formatEquation,
  isFinalForm,
  MathInputError,
  normalizeMathInput,
  parseEquation,
  solve,
} from './equation';
import { checkStep } from './step-check';

const solution = (s: string) => {
  const r = solve(parseEquation(s));
  return r.kind === 'unique' ? r.value.toString() : r.kind;
};

describe('parseEquation', () => {
  it('expands brackets and handles implicit multiplication', () => {
    const eq = parseEquation('3(x + 4) = 2x + 19');
    expect(formatEquation(eq)).toBe('3x + 12 = 2x + 19');
    expect(eq.features.hasDistribution).toBe(true);
    expect(eq.features.variableOnBothSides).toBe(true);
  });

  it('solves exactly with fractions', () => {
    expect(solution('3(x + 4) = 2x + 19')).toBe('7');
    expect(solution('3x + 4 = 2x + 19')).toBe('15');
    expect(solution('2x = 3')).toBe('3/2');
    expect(solution('0.1x + 0.2 = 0.3')).toBe('1');
    expect(solution('x/3 + 1 = 2')).toBe('3');
    expect(solution('2(x + 1) = 2x + 2')).toBe('all');
    expect(solution('2(x + 1) = 2x + 5')).toBe('none');
  });

  it('accepts notation students actually type', () => {
    expect(normalizeMathInput('3 · (x − 4) = 2,5x')).toBe('3 * (x - 4) = 2.5x');
    expect(solution('6x : 2 = 9')).toBe('3');
    expect(solution('−2x = 8')).toBe('-4');
    expect(solution('x(2) = 10')).toBe('5');
    expect(solution('X + 1 = 3')).toBe('2');
  });

  it('rejects anything that is not a linear equation in one variable', () => {
    const code = (s: string) => {
      try {
        parseEquation(s);
        return 'ok';
      } catch (e) {
        return (e as MathInputError).code;
      }
    };
    expect(code('3x + 4')).toBe('NOT_AN_EQUATION');
    expect(code('x = 1 = 2')).toBe('MULTIPLE_EQUALS');
    expect(code('x^2 = 4')).toBe('NONLINEAR');
    expect(code('x * x = 4')).toBe('NONLINEAR');
    expect(code('1/x = 4')).toBe('NONLINEAR');
    expect(code('x + y = 4')).toBe('MULTIPLE_VARIABLES');
    expect(code('x / 0 = 1')).toBe('DIVISION_BY_ZERO');
    expect(code('3x + = 4')).toBe('SYNTAX');
    // No mathjs functions or evaluation: closes injection via the expression parser.
    expect(code('sqrt(4) = x')).toBe('UNSUPPORTED');
    expect(code('import(x) = 1')).toBe('UNSUPPORTED');
    expect(code('"a" = x')).toBe('UNSUPPORTED');
    expect(code('x'.padEnd(200, '+1') + '=1')).toBe('TOO_LONG');
  });

  it('detects the final answer form', () => {
    expect(isFinalForm(parseEquation('x = 7'))).toBe(true);
    expect(isFinalForm(parseEquation('7 = x'))).toBe(true);
    expect(isFinalForm(parseEquation('2x = 14'))).toBe(false);
    // A reducible fraction is not an answer yet (regression: "x = 18/3" was accepted).
    expect(isFinalForm(parseEquation('x = 18/3'))).toBe(false);
    expect(isFinalForm(parseEquation('x = 4/2'))).toBe(false);
    expect(isFinalForm(parseEquation('x = 6/1'))).toBe(false);
    expect(isFinalForm(parseEquation('x = 1.5/3'))).toBe(false);
    expect(isFinalForm(parseEquation('x = 2.5'))).toBe(true);
    expect(isFinalForm(parseEquation('-4/3 = x'))).toBe(true);
    expect(isFinalForm(parseEquation('x = 3 + 4'))).toBe(false);
    expect(isFinalForm(parseEquation('3x - 2x = 19 - 12'))).toBe(false);
    expect(isFinalForm(parseEquation('x = -3/2'))).toBe(true);
  });
});

describe('classifyInput', () => {
  it('separates steps from chat messages', () => {
    expect(classifyInput('3x + 12 = 2x + 19')).toBe('step');
    expect(classifyInput('x=7')).toBe('step');
    expect(classifyInput('3x + = 2')).toBe('step');
    expect(classifyInput('why is it 12?')).toBe('message');
    expect(classifyInput('is it x = 7')).toBe('message');
    expect(classifyInput('я думаю x = 7')).toBe('message');
    expect(classifyInput('multiply both terms')).toBe('message');
  });
});

describe('checkStep — the test scenario', () => {
  it('flags 3(x+4)=2x+19 → 3x+4=2x+19 as a reasoning error and explains it with facts', () => {
    const r = checkStep('3(x + 4) = 2x + 19', '3x + 4 = 2x + 19');
    expect(r.equivalent).toBe(false);
    expect(r.solved).toBe(false);
    expect(r.facts.join('\n')).toContain('3x + 12 = 2x + 19');
    expect(r.facts.join('\n')).toContain('x = 15');
    expect(r.facts.join('\n')).toContain('left side 25 and right side 33');
  });

  it('accepts any equivalent rearrangement, not one canonical path', () => {
    const prev = '3(x + 4) = 2x + 19';
    for (const step of [
      '3x + 12 = 2x + 19',
      '3x - 2x = 19 - 12',
      'x + 12 = 19',
      '12 + 3x = 19 + 2x',
      '6x + 24 = 4x + 38',
    ]) {
      expect(checkStep(prev, step).equivalent, step).toBe(true);
    }
    expect(checkStep(prev, 'x = 7').solved).toBe(true);
    expect(checkStep('3x = 18', 'x = 18/3').solved).toBe(false);
    expect(checkStep('3x = 18', 'x = 18/3').equivalent).toBe(true);
  });

  it('catches a sign error when moving terms', () => {
    const r = checkStep('3x + 12 = 2x + 19', '3x - 2x = 19 + 12');
    expect(r.equivalent).toBe(false);
  });

  it('a wrong final answer is final form but not solved', () => {
    const r = checkStep('x + 12 = 19', 'x = 31');
    expect(r.finalForm).toBe(true);
    expect(r.solved).toBe(false);
  });
});
