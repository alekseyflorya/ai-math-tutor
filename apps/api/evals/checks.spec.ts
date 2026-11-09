import { Fraction } from '@tutor/shared';
import {
  correctedStep,
  detectLanguage,
  extractEquations,
  isQuestion,
  latexToPlain,
  revealsAnswer,
} from './checks';

const seven = new Fraction(7n);
const eqs = (m: string) => extractEquations(m).map((e) => e.normalized);

describe('latexToPlain / extractEquations', () => {
  it('reads LaTeX the tutor writes', () => {
    expect(latexToPlain(String.raw`3 \cdot \left(x + 4\right) = \frac{x}{2}`)).toBe(
      '3 * (x + 4) = (x)/(2)',
    );
    expect(latexToPlain(String.raw`2{,}5x \Rightarrow x`)).toBe('2,5x  ;  x');
  });

  it('finds equations in math segments and plain text, skipping numeric ones', () => {
    expect(eqs('Look at $3(x+4) = 2x + 19$: what is $3 \\cdot 4 = 12$?')).toEqual([
      '3(x+4) = 2x + 19',
    ]);
    expect(eqs('So 3x + 12 = 2x + 19. Next?')).toEqual(['3x + 12 = 2x + 19']);
    expect(eqs('$3x + 12 = 2x + 19 \\Rightarrow x + 12 = 19$')).toHaveLength(2);
    expect(eqs('$x = 7 = 7$')).toEqual(['x = 7']);
  });
});

describe('isQuestion', () => {
  it('looks for a question mark in the words', () => {
    expect(isQuestion('What happens to the $4$ when you multiply $3(x+4)$?')).toBe(true);
    expect(isQuestion('Multiply each term by $3$.')).toBe(false);
  });
});

describe('revealsAnswer', () => {
  it('catches the answer in any form', () => {
    for (const m of [
      'So $x = 7$.',
      'We get $7 = x$.',
      'That gives $x = \\frac{14}{2}$.',
      'Then x equals 7.',
      'Отже, х дорівнює 7.',
      'The answer is 7.',
      'Відповідь: 7',
    ]) {
      expect([m, revealsAnswer(m, seven)]).toEqual([m, true]);
    }
  });

  it('does not fire on other values or on lines that are not the answer', () => {
    for (const m of [
      'You got $x = 15$, check it by substitution.',
      'Look at $2x = 14$ again.',
      'If $-x = 7$, what is x?',
      'Multiply $7$ by $3$.',
      'Is $3x + x = 7$ right?',
    ]) {
      expect([m, revealsAnswer(m, seven)]).toEqual([m, false]);
    }
  });
});

describe('correctedStep', () => {
  const prev = '3(x + 4) = 2x + 19';
  it('finds the corrected version of the step, ignoring repeats of the previous line', () => {
    expect(
      correctedStep('From $3(x + 4) = 2x + 19$ we get $3x + 12 = 2x + 19$.', prev, prev),
    ).toEqual({ shows: true, newLines: 1 });
    // the same line written twice counts once
    expect(
      correctedStep('$3 \\cdot x + 3 \\cdot 4 = 2x + 19$, i.e. $3x + 12 = 2x + 19$', prev, prev),
    ).toEqual({ shows: true, newLines: 1 });
  });

  it('counts steps beyond the current one and ignores wrong lines', () => {
    expect(correctedStep('$3x + 12 = 2x + 19$, then $x = 7$', prev, prev).newLines).toBe(2);
    expect(correctedStep('Not $3x + 4 = 2x + 19$. Try again.', prev, prev).shows).toBe(false);
  });
});

describe('detectLanguage', () => {
  it('tells English, Ukrainian, Russian and mixed text apart, ignoring math', () => {
    expect(detectLanguage('What happens to $4$ when you open $3(x+4)$?')).toBe('en');
    expect(detectLanguage('Що відбувається з $4$, коли ти розкриваєш дужки?')).toBe('uk');
    expect(detectLanguage('Что происходит с числом, когда ты раскрываешь скобки? Это ты?')).toBe(
      'ru',
    );
    expect(detectLanguage('Подумай: what happens to the number in the bracket?')).toBe('mixed');
    expect(detectLanguage('$x = 7$')).toBe('unknown');
  });
});
