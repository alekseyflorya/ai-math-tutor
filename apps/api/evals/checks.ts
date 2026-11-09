import {
  formatEquation,
  formatLinear,
  isFinalForm,
  normalizeMathInput,
  parseEquation,
  sameSolutionSet,
  solve,
  type Fraction,
  type Linear,
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

/** A number that is not the start of a longer expression ("5" in "x = 5 + 3" is not an answer). */
const NUMBER = String.raw`([-−]?\s*\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?)(?![.,]\d)(?!\s*[-−+*/×·:^(x\d])`;
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
  // "x = 14/2" is not in final form for the engine but still gives the answer away. An expression
  // ("x = 10 - 5") is not counted: it is usually a worked example with other numbers.
  const num = String.raw`\(?-?\d+(?:\.\d+)?\)?(?:\s*\/\s*\(?-?\d+(?:\.\d+)?\)?)?`;
  const bareX = new RegExp(String.raw`^\s*x\s*=\s*${num}\s*$|^\s*${num}\s*=\s*x\s*$`);
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
  /** Shows the corrected line, or the corrected part of it ("3(x + 4) → 3x + 12"). */
  shows: boolean;
  /** Distinct new lines equivalent to the previous one (by per-side form). >1 = went further. */
  newLines: number;
}

export interface StepCase {
  problem: string;
  previousLine: string;
  wrongStep: string;
  correctStep: string;
}

const SIDES = ['left', 'right'] as const;
const sameLinear = (x: Linear, y: Linear) => x.a.equals(y.a) && x.b.equals(y.b);
const minus = (x: Linear, y: Linear): Linear => ({ a: x.a.sub(y.a), b: x.b.sub(y.b) });

/** Expressions written in math segments: each side of every equality, or the whole segment. */
function mathPieces(message: string): { text: string; value: Linear }[] {
  const out: { text: string; value: Linear }[] = [];
  for (const m of message.matchAll(MATH)) {
    for (const part of latexToPlain(m[1] ?? m[2] ?? m[3] ?? '').split(/;|=|,(?!\d)|(?<!\d),/)) {
      const text = part.trim();
      if (!text) continue;
      try {
        const eq = parseEquation(`${text} = 0`);
        if (eq.variable === null || eq.variable === 'x') out.push({ text, value: eq.left });
      } catch {
        /* not an expression */
      }
    }
  }
  return out;
}

/**
 * Level 3 shows the corrected version of THIS step: either a whole line equivalent to the previous
 * one, or the corrected part of a side. A part P counts when it equals the corrected side, or when
 * the student's version of it (P minus the correction) appears in the wrong step: for
 * 3(x + 4) = 2x + 19 → 3x + 4 = …, "3x + 12" counts because "3x + 4" is what the student wrote.
 * Quoting the previous line does not count, unless the fix IS the previous line (a miscopy).
 */
export function correctedStep(message: string, k: StepCase): CorrectedStepCheck {
  const prev = parseEquation(k.previousLine);
  const wrong = parseEquation(k.wrongStep);
  const correct = parseEquation(k.correctStep);
  const target = solve(prev);
  const copyFix = squash(k.correctStep) === squash(k.previousLine);
  const quoted = (text: string) =>
    !copyFix && [k.previousLine, k.problem].some((line) => squash(line).includes(squash(text)));

  const fresh = new Set<string>();
  for (const eq of extractEquations(message)) {
    if (!copyFix && [k.previousLine, k.problem].some((l) => squash(l) === squash(eq.normalized))) {
      continue;
    }
    if (sameSolutionSet(solve(eq), target)) fresh.add(formatEquation(eq));
  }

  const wrongText = wrong.normalized.split('=');
  const pieces = mathPieces(message).filter((p) => !quoted(p.text));
  const showsPart = SIDES.some((side, i) => {
    const fix = minus(correct[side], wrong[side]);
    if (fix.a.isZero() && fix.b.isZero()) return false; // this side was right
    return pieces.some((p) => {
      if (sameLinear(p.value, correct[side])) return true;
      const studentVersion = squash(formatLinear(minus(p.value, fix)));
      return squash(wrongText[i] ?? '').includes(studentVersion);
    });
  });
  return { shows: fresh.size > 0 || showsPart, newLines: fresh.size };
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
