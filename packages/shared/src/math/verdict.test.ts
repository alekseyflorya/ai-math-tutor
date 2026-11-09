import { describe, expect, it } from 'vitest';
import { judgeLine, type LineContext } from './verdict';

const solving: LineContext = {
  mode: 'SOLVING',
  equation: '3(x + 4) = 2x + 19',
  currentLine: '3(x + 4) = 2x + 19',
  variable: 'x',
  lastCheckLine: null,
};
const checking: LineContext = { ...solving, mode: 'CHECKING', currentLine: 'x = 7' };

describe('judgeLine: one verdict for the server and the browser', () => {
  it('routes a question to the tutor', () => {
    expect(judgeLine('why is it 12?', solving)).toEqual({ kind: 'message' });
  });

  it('judges a step against the last correct line', () => {
    expect(judgeLine('3x + 12 = 2x + 19', solving)).toMatchObject({
      kind: 'step',
      isCorrect: true,
    });
    const wrong = judgeLine('3x + 4 = 2x + 19', solving);
    expect(wrong).toMatchObject({ kind: 'step', isCorrect: false });
    if (wrong.kind === 'step') expect(wrong.latex).toBe(wrong.result.current.latex);
  });

  it('does not record the last correct line typed again, or a line it cannot read', () => {
    expect(judgeLine('3(x+4)=2x+19', solving)).toEqual({ kind: 'repeated' });
    expect(judgeLine('3x + = 2', solving)).toMatchObject({ kind: 'unreadable' });
  });

  it('judges a check line by substitution while CHECKING', () => {
    expect(judgeLine('3(7 + 4) = 2*7 + 19', checking)).toMatchObject({
      kind: 'check',
      isCorrect: true,
    });
    expect(judgeLine('33 = 32', checking)).toMatchObject({ kind: 'check', isCorrect: false });
    expect(judgeLine('x = 7', checking)).toEqual({ kind: 'not_check', reason: 'not_numeric' });
    expect(judgeLine('5 = 5', checking)).toEqual({ kind: 'not_check', reason: 'not_substitution' });
  });

  it('after a check line, both sides wrong is a slip, and the same line again is a repeat', () => {
    const after = { ...checking, lastCheckLine: '3(7 + 4) = 2*7 + 19' };
    expect(judgeLine('5 = 5', after)).toMatchObject({ kind: 'check', isCorrect: false });
    expect(judgeLine('3(7+4) = 2*7+19', after)).toEqual({ kind: 'repeated' });
  });
});
