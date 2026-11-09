import { Fraction } from '@tutor/shared';
import {
  correctedStep,
  detectLanguage,
  extractEquations,
  isQuestion,
  namesOperation,
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
      // a worked example with other numbers, even when its value happens to match
      'For example, if $x - 3 = 5$, then $x = 5 + 3$.',
      'In $x + 3 = 10$ moving $3$ gives $x = 10 - 3$.',
    ]) {
      expect([m, revealsAnswer(m, seven)]).toEqual([m, false]);
    }
  });
});

describe('correctedStep', () => {
  const dist = {
    problem: '3(x + 4) = 2x + 19',
    previousLine: '3(x + 4) = 2x + 19',
    wrongStep: '3x + 4 = 2x + 19',
    correctStep: '3x + 12 = 2x + 19',
  };

  it('finds the corrected line, ignoring repeats of the previous line', () => {
    expect(correctedStep('From $3(x + 4) = 2x + 19$ we get $3x + 12 = 2x + 19$.', dist)).toEqual({
      shows: true,
      newLines: 1,
    });
    // the same line written twice counts once
    expect(
      correctedStep('$3 \\cdot x + 3 \\cdot 4 = 2x + 19$, i.e. $3x + 12 = 2x + 19$', dist),
    ).toEqual({ shows: true, newLines: 1 });
  });

  it('accepts the corrected part of a side, not a quote of the original', () => {
    expect(
      correctedStep('By the distributive law, $3(x + 4)$ expands to $3x + 12$.', dist).shows,
    ).toBe(true);
    expect(correctedStep('Look again at $3(x + 4)$.', dist).shows).toBe(false);
    const sub = {
      problem: '7 - 3(x + 2) = 4',
      previousLine: '7 - 3(x + 2) = 4',
      wrongStep: '7 - 3x + 6 = 4',
      correctStep: '7 - 3x - 6 = 4',
    };
    expect(correctedStep('So $-3(x + 2) = -3x - 6$.', sub).shows).toBe(true);
    const comb = {
      problem: '4x + 3 - x = 12',
      previousLine: '4x + 3 - x = 12',
      wrongStep: '5x + 3 = 12',
      correctStep: '3x + 3 = 12',
    };
    expect(correctedStep('Since $-x$ is $-1x$, $4x - 1x$ equals $3x$.', comb).shows).toBe(true);
  });

  it('accepts restating the previous line when the mistake was a miscopy', () => {
    const copy = {
      problem: '3(x + 4) = 2x + 19',
      previousLine: '3(x + 4) = 2x + 19',
      wrongStep: '3(x + 4) = 2x + 91',
      correctStep: '3(x + 4) = 2x + 19',
    };
    expect(correctedStep('The line is $3(x + 4) = 2x + 19$, not $91$.', copy).shows).toBe(true);
  });

  it('counts steps beyond the current one and ignores wrong lines', () => {
    expect(correctedStep('$3x + 12 = 2x + 19$, then $x = 7$', dist).newLines).toBe(2);
    expect(correctedStep('Not $3x + 4 = 2x + 19$. Try again.', dist).shows).toBe(false);
    const inv = {
      problem: '4x + 3 = 23',
      previousLine: '4x = 20',
      wrongStep: 'x = 16',
      correctStep: 'x = 5',
    };
    expect(correctedStep('Divide both sides of $4x = 20$ by $4$. What is $x$?', inv).shows).toBe(
      false,
    );
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

describe('namesOperation', () => {
  it('finds the operation in words, in English and Ukrainian', () => {
    expect(namesOperation('Divide both sides of $4x = 20$ by $4$. What do you get?')).toBe(true);
    expect(namesOperation('Помнож обидві частини рівняння $x/3 = 4$ на $3$.')).toBe(true);
    expect(namesOperation('Поділи обидві частини на $-3$ і запиши результат.')).toBe(true);
    expect(namesOperation('What does $x$ equal now?')).toBe(false);
    expect(namesOperation('Look at $4x \\div 4$ again.')).toBe(false); // math only
  });
});
