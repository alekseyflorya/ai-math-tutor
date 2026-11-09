import {
  formatEquation,
  isFinalForm,
  normalizeMathInput,
  parseEquation,
  sameSolutionSet,
  solve,
  type Fraction,
  type Locale,
  type ParsedEquation,
} from '@tutor/shared';

/**
 * Rule checks on tutor messages. Correctness of a line is decided by the math engine here too:
 * equations are pulled out of the message (LaTeX or plain text) and compared by solution set.
 */

// --- Text plumbing ----------------------------------------------------------------------------

const MATH = /\$\$([\s\S]+?)\$\$|\$([^$]+)\$|\\\(([\s\S]+?)\\\)/g;
/** Cyrillic "х" used as the variable in Ukrainian prose. */
const CYRILLIC_X = /(?<![Ѐ-ӿ])х(?![Ѐ-ӿ])/g;

/** "3 \cdot \left(x + 4\right) = \frac{x}{2}" → "3 * (x + 4) = (x)/(2)"; separators become ";". */
export function latexToPlain(math: string): string {
  let s = math.replace(/\\left|\\right/g, '');
  const frac = /\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/;
  while (frac.test(s)) s = s.replace(frac, '($1)/($2)');
  return s
    .replace(/\{,\}/g, ',')
    .replace(/\\(cdot|times|ast)(?![a-zA-Z])/g, '*')
    .replace(/\\div(?![a-zA-Z])/g, '/')
    .replace(
      /\\(Rightarrow|Longrightarrow|rightarrow|implies|iff|to|quad|qquad|text\{[^}]*\})/g,
      ' ; ',
    )
    .replace(/\\(neq|ne|geq|leq|ge|le|approx|pm)(?![a-zA-Z])/g, ' ; ')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\[a-zA-Z]+/g, ' ')
    .replace(/[{}]/g, '');
}

/** Message text without math segments: what the student reads as words. */
export function prose(message: string): string {
  return message.replace(MATH, ' ');
}

/** Whole message as plain text, math segments converted from LaTeX. */
export function plainText(message: string): string {
  return message
    .replace(
      MATH,
      (_m, a?: string, b?: string, c?: string) => ` ${latexToPlain(a ?? b ?? c ?? '')} ; `,
    )
    .replace(CYRILLIC_X, 'x');
}

const EQUATION_RUN = /[0-9x+\-−–*·×/().,:= ]*=[0-9x+\-−–*·×/().,:= ]*/g;

function tryParse(text: string): ParsedEquation | null {
  const candidates = [text, text.replace(/^[(\s]+|[)\s]+$/g, '')];
  for (const t of candidates) {
    try {
      const eq = parseEquation(t);
      if (eq.variable === 'x') return eq;
    } catch {
      /* not an equation in x */
    }
  }
  return null;
}

/**
 * Every linear equation in x the message shows, in order. Chains "a = b = c" give "a = b" and
 * "b = c"; numeric equalities ("3 * 4 = 12") are skipped.
 */
export function extractEquations(message: string): ParsedEquation[] {
  const out: ParsedEquation[] = [];
  for (const segment of plainText(message).split(/;|,(?!\d)|(?<!\d),/)) {
    for (const run of segment.match(EQUATION_RUN) ?? []) {
      const sides = run
        .trim()
        .replace(/^[.,:]+|[.,:]+$/g, '')
        .split('=');
      for (let i = 0; i + 1 < sides.length; i++) {
        const eq = tryParse(`${sides[i]!.trim()} = ${sides[i + 1]!.trim()}`);
        if (eq) out.push(eq);
      }
    }
  }
  return out;
}

const squash = (s: string) => normalizeMathInput(s).replace(/\s+/g, '');

// --- Rules ------------------------------------------------------------------------------------

/** Level 1 must be a question. */
export function isQuestion(message: string): boolean {
  return /[?？]/.test(prose(message));
}

function numberValue(text: string): Fraction | null {
  try {
    const s = solve(parseEquation(`x = ${text.replace(/−/g, '-')}`));
    return s.kind === 'unique' ? s.value : null;
  } catch {
    return null;
  }
}

const NUMBER = String.raw`([-−]?\s*\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)`;
const IN_WORDS = [
  new RegExp(
    String.raw`(?<![\wа-яіїєґ])(?<![\-−+*/=(]\s*)x\s*(?:=|equals|is equal to|is|дорівнює|рівний|рівне|буде)\s*` +
      NUMBER,
    'giu',
  ),
  new RegExp(String.raw`(?:answer|відповідь)\s*(?:is|:|—|-|–|дорівнює|буде)?\s*` + NUMBER, 'giu'),
];

/**
 * Does the message give away the final answer, in any form: "x = 7", "7 = x", "x = 14/2",
 * "x equals 7", "х дорівнює 7", "the answer is 7"?
 */
export function revealsAnswer(message: string, solution: Fraction): boolean {
  const solvedTo = (eq: ParsedEquation) => {
    const s = solve(eq);
    return s.kind === 'unique' && s.value.equals(solution);
  };
  // "x = 14/2" is not in final form for the engine but still gives the answer away.
  const bareX = /^\s*x\s*=|=\s*x\s*$/;
  if (
    extractEquations(message).some(
      (eq) => solvedTo(eq) && (isFinalForm(eq) || bareX.test(eq.normalized)),
    )
  ) {
    return true;
  }
  const text = plainText(message).toLowerCase();
  return IN_WORDS.some((re) =>
    [...text.matchAll(re)].some((m) => numberValue(m[1]!)?.equals(solution) ?? false),
  );
}

export interface CorrectedStepCheck {
  /** Shows at least one new line equivalent to the previous verified line. */
  shows: boolean;
  /** Distinct new equivalent lines (by per-side simplified form). 1 = only the current step. */
  newLines: number;
}

/**
 * Level 3 shows the corrected version of THIS step. Lines that merely repeat the previous line or
 * the problem do not count; rewrites of the same line ("3·x + 3·4" and "3x + 12") count once.
 */
export function correctedStep(
  message: string,
  previousLine: string,
  problem: string,
): CorrectedStepCheck {
  const target = solve(parseEquation(previousLine));
  const known = new Set([squash(previousLine), squash(problem)]);
  const fresh = new Set<string>();
  for (const eq of extractEquations(message)) {
    if (known.has(squash(eq.normalized))) continue;
    if (sameSolutionSet(solve(eq), target)) fresh.add(formatEquation(eq));
  }
  return { shows: fresh.size > 0, newLines: fresh.size };
}

export type DetectedLanguage = Locale | 'ru' | 'mixed' | 'unknown';

/** Language of the words (math removed). Russian-only letters mark Russian, not Ukrainian. */
export function detectLanguage(message: string): DetectedLanguage {
  const words = prose(message).replace(/(?<![a-z])x(?![a-z])/gi, ' ');
  const cyr = (words.match(/[Ѐ-ӿ]/g) ?? []).length;
  const lat = (words.match(/[a-z]/gi) ?? []).length;
  if (cyr + lat === 0) return 'unknown';
  const share = cyr / (cyr + lat);
  if (share >= 0.85) return /[ыэъё]/i.test(words) ? 'ru' : 'uk';
  if (share <= 0.05) return 'en';
  return 'mixed';
}
