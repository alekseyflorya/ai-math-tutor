import { Fraction } from '@tutor/shared';
import {
  computedCheckLines,
  statedNumbers,
  studentNumbersUsed,
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

describe('hints for a slip in the check', () => {
  const k = {
    problem: '3(x + 4) = 2x + 19',
    substituted: '3(7 + 4) = 2·7 + 19',
    slip: '3·11 = 12 + 19',
  };

  it('finds a value the student should compute themselves', () => {
    expect(statedNumbers('First multiply $2 \\cdot 7$, then add $19$.', ['14', '33'])).toEqual([]);
    expect(statedNumbers('Recompute $2 \\cdot 7 = 14$.', ['14', '33'])).toEqual(['14']);
    expect(statedNumbers('Both sides should give 33.', ['14', '33'])).toEqual(['33']);
  });

  it('finds a computed check line, but not the lines the student wrote', () => {
    expect(computedCheckLines('So $3 \\cdot 11 = 14 + 19$.', k)).toEqual(['3 * 11 = 14 + 19']);
    expect(computedCheckLines('Now $33 = 33$!', k)).toEqual(['33 = 33']);
    expect(
      computedCheckLines('You wrote $3 \\cdot 11 = 12 + 19$. Look at $2 \\cdot 7$.', k),
    ).toEqual([]);
    expect(computedCheckLines('We substituted: $3(7 + 4) = 2 \\cdot 7 + 19$.', k)).toEqual([]);
    // A wrong numeric line is not "computed for them" (and an example with other numbers is fine).
    expect(computedCheckLines('For example, $2 \\cdot 3 + 5 = 11$.', k)).toEqual([]);
  });
});

describe('level 2: an example on other numbers', () => {
  const check = ['3(x + 4) = 2x + 19', '3(7 + 4) = 2·7 + 19', '3·11 = 12 + 19'];
  const step = ['3(x + 4) = 2x + 19', '3x + 4 = 2x + 19'];

  it('lets the tutor point at what the student wrote', () => {
    expect(studentNumbersUsed('Apply it to $2(7) + 19$ on the right.', check)).toEqual([]);
    expect(studentNumbersUsed('Look again at $3x + 4$.', step)).toEqual([]);
    expect(studentNumbersUsed('Go back to $3x + 4 = 2x + 19$.', step)).toEqual([]);
    expect(studentNumbersUsed('What happens to $+4$ and to $19$?', step)).toEqual(['19']);
    expect(studentNumbersUsed('Recompute $11 : 3$.', ['33 = 11 : 3'])).toEqual([]);
    expect(studentNumbersUsed('Re-check $19 - 12$.', ['x + 12 = 19', 'x = 8'])).toEqual([]);
    expect(
      studentNumbersUsed('Multiply first: in $5 \\cdot 6 + 8$ we get $30$, then $38$.', check),
    ).toEqual([]);
  });

  it('flags a value from their line, a contrast and an example on their numbers', () => {
    expect(studentNumbersUsed('For example, $2 \\cdot 6 = 12$, not $14$.', check)).toEqual([
      '2',
      '12',
    ]);
    expect(studentNumbersUsed('You got $12$ for this product.', check)).toEqual(['12']);
    expect(studentNumbersUsed('E.g. $2(x + 5) = 2x + 10$.', step)).toEqual(['2']);
    expect(studentNumbersUsed('Multiply each term by 3.', step)).toEqual(['3']);
  });
});
