import type { ErrorType, Locale, MathErrorCode } from '@tutor/shared';

/**
 * Fixed interface copy (greeting, input-format errors, outage fallbacks).
 * None of this is teaching: diagnosis, hints, explanations and follow-up problems
 * always come from the model. These strings exist so the app degrades gracefully —
 * if the model is down, the math engine still tells the student whether a step is right.
 */
type Dict = Record<Locale, string>;
const t = (d: Dict, locale: Locale) => d[locale];

export const notices = {
  greeting: (locale: Locale, latex: string, isFollowUp: boolean) =>
    t(
      isFollowUp
        ? {
            en: `Practice problem to check your understanding: $${latex}$. Solve it step by step; write one transformation per line.`,
            uk: `Задача для перевірки розуміння: $${latex}$. Розв'язуй крок за кроком, одне перетворення в рядку.`,
          }
        : {
            en: `Let's solve $${latex}$. Write your first step as an equation, one transformation per line. You can also ask me a question at any time.`,
            uk: `Розв'яжемо $${latex}$. Запиши перший крок у вигляді рівняння, одне перетворення в рядку. Можеш будь-коли поставити мені запитання.`,
          },
      locale,
    ),

  parseError: (locale: Locale, code: MathErrorCode) => {
    const reasons: Record<MathErrorCode, Dict> = {
      EMPTY: { en: 'the step is empty', uk: 'крок порожній' },
      TOO_LONG: {
        en: 'it is too long or the numbers are too large',
        uk: 'він задовгий або числа завеликі',
      },
      NOT_AN_EQUATION: { en: 'it has no "=" sign', uk: 'у ньому немає знака "="' },
      MULTIPLE_EQUALS: {
        en: 'it has more than one "=" sign',
        uk: 'у ньому більше одного знака "="',
      },
      SYNTAX: {
        en: 'some symbols are missing or misplaced',
        uk: 'бракує символів або вони не на своєму місці',
      },
      UNSUPPORTED: {
        en: 'it uses symbols I do not support here',
        uk: 'у ньому є символи, які тут не підтримуються',
      },
      MULTIPLE_VARIABLES: {
        en: 'it has more than one unknown',
        uk: 'у ньому більше одного невідомого',
      },
      WRONG_VARIABLE: {
        en: 'it uses a different letter for the unknown',
        uk: 'невідоме позначене іншою літерою',
      },
      NONLINEAR: { en: 'it is no longer a linear equation', uk: 'це вже не лінійне рівняння' },
      DIVISION_BY_ZERO: { en: 'it divides by zero', uk: 'у ньому ділення на нуль' },
    };
    return t(
      {
        en: `I couldn't read that step: ${reasons[code].en}. Write it like \`3x + 12 = 2x + 19\`.`,
        uk: `Не вдалося прочитати цей крок: ${reasons[code].uk}. Запиши його так: \`3x + 12 = 2x + 19\`.`,
      },
      locale,
    );
  },

  /** The student re-typed the last correct line: no progress, and not a correction. */
  sameLine: (locale: Locale, afterMistake: boolean) =>
    t(
      afterMistake
        ? {
            en: 'This is the line you had before the mistake. Rewriting it does not fix the step: transform it again, carefully this time.',
            uk: 'Це рядок, який був до помилки. Якщо його переписати, крок не виправиться: перетвори його ще раз, цього разу уважно.',
          }
        : {
            en: 'This is the same line as before. Write the next transformation.',
            uk: 'Це той самий рядок, що й раніше. Запиши наступне перетворення.',
          },
      locale,
    ),

  stepCorrectNoAi: (locale: Locale) =>
    t(
      {
        en: 'Correct step ✓. (The AI tutor is temporarily unavailable, but every step is still checked.) Continue.',
        uk: 'Правильний крок ✓. (AI-тьютор тимчасово недоступний, але кожен крок і далі перевіряється.) Продовжуй.',
      },
      locale,
    ),

  stepWrongNoAi: (locale: Locale) =>
    t(
      {
        en: 'This step changes the solution of the equation, so something went wrong in it. Compare it with the previous line, term by term. (The AI tutor is temporarily unavailable.)',
        uk: "Цей крок змінює розв'язок рівняння, отже в ньому помилка. Порівняй його з попереднім рядком доданок за доданком. (AI-тьютор тимчасово недоступний.)",
      },
      locale,
    ),

  /** Stored as the mistake's description when the model could not diagnose it. */
  notDiagnosed: (locale: Locale) =>
    t(
      {
        en: 'Not diagnosed: the AI tutor was unavailable',
        uk: 'Не діагностовано: AI-тьютор був недоступний',
      },
      locale,
    ),

  aiUnavailable: (locale: Locale) =>
    t(
      {
        en: 'The AI tutor is temporarily unavailable. You can keep solving: every step is still checked automatically.',
        uk: "AI-тьютор тимчасово недоступний. Можеш розв'язувати далі: кожен крок і далі перевіряється автоматично.",
      },
      locale,
    ),

  solvedNoAi: (locale: Locale, solution: string) =>
    t({ en: `Solved: $${solution}$ ✓`, uk: `Розв'язано: $${solution}$ ✓` }, locale),

  followUpReady: (locale: Locale, latex: string, title: string) =>
    t(
      {
        en: `${title}. A similar problem to check the lesson stuck: $${latex}$`,
        uk: `${title}. Схожа задача, щоб перевірити, що урок засвоєно: $${latex}$`,
      },
      locale,
    ),

  followUpTitle: (locale: Locale, errorType: ErrorType) => {
    const names: Record<ErrorType, Dict> = {
      DISTRIBUTION: { en: 'opening brackets', uk: 'розкриття дужок' },
      SIGN_TRANSFER: { en: 'moving terms', uk: 'перенесення доданків' },
      COMBINING_LIKE_TERMS: { en: 'like terms', uk: 'подібні доданки' },
      INVERSE_OPERATION: { en: 'isolating x', uk: 'вираження x' },
      ONE_SIDE_ONLY: { en: 'both sides', uk: 'обидві частини' },
      ARITHMETIC: { en: 'calculation', uk: 'обчислення' },
      OTHER: { en: 'practice', uk: 'практика' },
    };
    return t(
      { en: `Practice: ${names[errorType].en}`, uk: `Закріплення: ${names[errorType].uk}` },
      locale,
    );
  },

  customTitle: (locale: Locale) => t({ en: 'Your equation', uk: 'Твоє рівняння' }, locale),

  // --- Checking the answer by substitution (fixed copy: the engine decides, no model call) ---

  checkRequest: (locale: Locale, solutionLatex: string, equationLatex: string) =>
    t(
      {
        en: `That's the answer: $${solutionLatex}$ ✓. Now check it, the way it is done in class: substitute it into the original equation $${equationLatex}$ and compute both sides.`,
        uk: `Це відповідь: $${solutionLatex}$ ✓. Тепер зроби перевірку, як у школі: підстав її в початкове рівняння $${equationLatex}$ і обчисли обидві частини.`,
      },
      locale,
    ),

  checkSkipped: (locale: Locale) =>
    t({ en: 'The check was skipped.', uk: 'Перевірку пропущено.' }, locale),

  checkStepOk: (locale: Locale) =>
    t(
      {
        en: 'Right ✓ Keep computing until each side is a single number.',
        uk: 'Правильно ✓ Обчислюй далі, доки в кожній частині не залишиться одне число.',
      },
      locale,
    ),

  checkNotNumeric: (locale: Locale, solutionLatex: string) =>
    t(
      {
        en: `In the check there is no unknown any more: write the original equation with the number in place of the variable ($${solutionLatex}$), then compute.`,
        uk: `У перевірці невідомого вже немає: запиши початкове рівняння, підставивши число замість змінної ($${solutionLatex}$), і обчисли.`,
      },
      locale,
    ),

  /**
   * A hint on a slip in the check with no number in it, for when the model twice stated a value
   * the student must compute. Level 1 asks, level 2 gives the rule, level 3 lists the order.
   */
  checkHintTemplate: (locale: Locale, level: 1 | 2 | 3, wrongSides: ('left' | 'right')[]) => {
    const both = wrongSides.length > 1;
    const side = {
      en: both ? 'both sides' : `the ${wrongSides[0] ?? 'left'} side`,
      uk: both ? 'обидві частини' : wrongSides[0] === 'right' ? 'праву частину' : 'ліву частину',
    };
    const text: Record<1 | 2 | 3, Dict> = {
      1: {
        en: `Look again at ${side.en} of your check line: which operation there did you compute differently?`,
        uk: `Подивись ще раз на ${side.uk} рядка перевірки: яку дію там ти обчислив інакше?`,
      },
      2: {
        en: `Compute in order: brackets first, then multiplication and division, then addition and subtraction. Redo ${side.en} one operation at a time.`,
        uk: `Обчислюй по порядку: спершу дужки, потім множення й ділення, потім додавання й віднімання. Перерахуй ${side.uk} по одній дії.`,
      },
      3: {
        en: `Go through ${side.en} operation by operation: brackets, then multiplication and division, then addition and subtraction. Write the result of each one, then rewrite the check line.`,
        uk: `Пройди ${side.uk} дія за дією: дужки, потім множення й ділення, потім додавання й віднімання. Запиши результат кожної дії, а тоді перепиши рядок перевірки.`,
      },
    };
    return t(text[level], locale);
  },

  checkNotSubstitution: (locale: Locale, solutionLatex: string, equationLatex: string) =>
    t(
      {
        en: `This doesn't look like $${solutionLatex}$ substituted into the original equation $${equationLatex}$. Start from that equation and replace every unknown with the number.`,
        uk: `Це не схоже на підстановку $${solutionLatex}$ у початкове рівняння $${equationLatex}$. Почни з нього і заміни кожне невідоме числом.`,
      },
      locale,
    ),
};
