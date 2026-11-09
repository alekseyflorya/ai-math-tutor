import { describe, expect, it } from 'vitest';
import { classifyInput, MathInputError } from './equation';
import { checkSubstitution } from './substitution';

const EQ = '3(x + 4) = 2x + 19'; // x = 7, both sides 33
const verdict = (line: string, afterCheckLine = false) =>
  checkSubstitution(EQ, line, { afterCheckLine }).verdict;

describe('checkSubstitution', () => {
  it('accepts the substitution into the original equation, in any notation', () => {
    expect(verdict('3(7 + 4) = 2·7 + 19')).toEqual({ kind: 'correct', done: false });
    expect(verdict('3 × (7 + 4) = 2 * 7 + 19')).toEqual({ kind: 'correct', done: false });
  });

  it('accepts swapped sides and intermediate simplification', () => {
    expect(verdict('2·7 + 19 = 3(7 + 4)')).toEqual({ kind: 'correct', done: false });
    expect(verdict('3·11 = 14 + 19', true)).toEqual({ kind: 'correct', done: false });
    expect(verdict('33 = 14 + 19', true)).toEqual({ kind: 'correct', done: false });
  });

  it('is done when both sides are the same plain number', () => {
    expect(verdict('33 = 33', true)).toEqual({ kind: 'correct', done: true });
    expect(verdict('33 = 66/2', true)).toEqual({ kind: 'correct', done: false });
    // Computed mentally: accepted as a complete check right away.
    expect(verdict('33 = 33')).toEqual({ kind: 'correct', done: true });
  });

  it('reports an arithmetic slip and which side it is on', () => {
    const c = checkSubstitution(EQ, '33 = 32', { afterCheckLine: true });
    expect(c.verdict).toMatchObject({ kind: 'arithmetic', wrongSides: ['right'] });
    expect(c.facts.join('\n')).toContain('right side was computed wrongly: 32 instead of 33');
    expect(verdict('3(7 + 4) = 2·7 + 91')).toMatchObject({
      kind: 'arithmetic',
      wrongSides: ['right'],
    });
    // Both sides wrong while simplifying a correct line: still arithmetic.
    expect(verdict('34 = 32', true)).toMatchObject({
      kind: 'arithmetic',
      wrongSides: ['left', 'right'],
    });
  });

  it('tells a line that is not this substitution apart', () => {
    expect(verdict('5 = 5')).toMatchObject({ kind: 'not_substitution' });
    // A different value substituted (8 instead of 7): 36 = 35.
    const wrongValue = checkSubstitution(EQ, '3(8 + 4) = 2·8 + 19', { afterCheckLine: false });
    expect(wrongValue.verdict).toMatchObject({ kind: 'not_substitution' });
    expect(wrongValue.facts.join('\n')).toContain('not x = 7 substituted');
  });

  it('asks for a number when the line still has the variable', () => {
    expect(verdict('x = 7')).toEqual({ kind: 'not_numeric' });
    expect(verdict('3x + 12 = 2x + 19')).toEqual({ kind: 'not_numeric' });
  });

  it('works with a fractional root, exactly', () => {
    // 2x + 1 = 4 → x = 3/2, both sides 4
    const c = (line: string) => checkSubstitution('2x + 1 = 4', line, { afterCheckLine: false });
    expect(c('2·(3/2) + 1 = 4').verdict).toEqual({ kind: 'correct', done: false });
    expect(c('2·1,5 + 1 = 4').verdict).toEqual({ kind: 'correct', done: false });
    expect(c('4 = 4').verdict).toEqual({ kind: 'correct', done: true });
    expect(c('2·1.4 + 1 = 4').verdict).toMatchObject({ kind: 'arithmetic', wrongSides: ['left'] });
  });

  it('throws an input error for unreadable lines, like any step', () => {
    expect(() => verdict('33 = = 33')).toThrow(MathInputError);
    expect(() => verdict('3(7 + = 33')).toThrow(MathInputError);
  });
});

describe('classifyInput while checking', () => {
  const mode = 'CHECKING' as const;
  it('routes numeric equalities and lines with x as steps, questions as messages', () => {
    expect(classifyInput('3(7 + 4) = 2·7 + 19', { mode })).toBe('step');
    expect(classifyInput('33 = 33', { mode })).toBe('step');
    expect(classifyInput('x = 7', { mode })).toBe('step');
    expect(classifyInput('чому 33?', { mode })).toBe('message');
    expect(classifyInput('is 33 = 33 right?', { mode })).toBe('message');
    expect(classifyInput('how do I check', { mode })).toBe('message');
  });
});
