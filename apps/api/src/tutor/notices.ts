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
      TOO_LONG: { en: 'it is too long', uk: 'він задовгий' },
      NOT_AN_EQUATION: { en: 'it has no "=" sign', uk: 'у ньому немає знака "="' },
      MULTIPLE_EQUALS: { en: 'it has more than one "=" sign', uk: 'у ньому більше одного знака "="' },
      SYNTAX: { en: 'some symbols are missing or misplaced', uk: 'бракує символів або вони не на своєму місці' },
      UNSUPPORTED: { en: 'it uses symbols I do not support here', uk: 'у ньому є символи, які тут не підтримуються' },
      MULTIPLE_VARIABLES: { en: 'it has more than one unknown', uk: 'у ньому більше одного невідомого' },
      WRONG_VARIABLE: { en: 'it uses a different letter for the unknown', uk: 'невідоме позначене іншою літерою' },
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
        uk: 'Цей крок змінює розв\'язок рівняння, отже в ньому помилка. Порівняй його з попереднім рядком доданок за доданком. (AI-тьютор тимчасово недоступний.)',
      },
      locale,
    ),

  aiUnavailable: (locale: Locale) =>
    t(
      {
        en: 'The AI tutor is temporarily unavailable. You can keep solving: every step is still checked automatically.',
        uk: 'AI-тьютор тимчасово недоступний. Можеш розв\'язувати далі: кожен крок і далі перевіряється автоматично.',
      },
      locale,
    ),

  solvedNoAi: (locale: Locale, solution: string) =>
    t({ en: `Solved: $${solution}$ ✓`, uk: `Розв'язано: $${solution}$ ✓` }, locale),

  followUpReady: (locale: Locale, latex: string) =>
    t(
      {
        en: `Your follow-up problem is ready: $${latex}$`,
        uk: `Задача для перевірки готова: $${latex}$`,
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
    return t({ en: `Follow-up: ${names[errorType].en}`, uk: `Перевірка: ${names[errorType].uk}` }, locale);
  },

  customTitle: (locale: Locale) => t({ en: 'Your equation', uk: 'Твоє рівняння' }, locale),
};
