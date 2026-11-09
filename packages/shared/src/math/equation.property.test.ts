/**
 * Property-based tests for the math engine.
 *
 * Equations are generated as a small AST of our own (signed terms: k·x, constants, m(p·x + q)),
 * printed to the text a student would type, and solved by an independent oracle: exact bigint
 * rationals computed straight from the generator's parameters. The engine (mathjs parse →
 * Fraction) is never used to compute an expected value.
 *
 * On failure fast-check prints `seed` and `path`; replay with
 * `fc.assert(property, { seed, path, endOnFailure: true })`.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  classifyInput,
  isFinalForm,
  MAX_INPUT_LENGTH,
  MathInputError,
  parseEquation,
  solve,
  type ParsedEquation,
} from './equation';
import { checkStep } from './step-check';

const NUM_RUNS = 300;
fc.configureGlobal({ numRuns: NUM_RUNS });

// --- Oracle: exact rationals on bigint, independent of ./fraction -------------------------------

interface Q {
  readonly n: bigint;
  readonly d: bigint;
}

const babs = (v: bigint) => (v < 0n ? -v : v);
function bgcd(a: bigint, b: bigint): bigint {
  a = babs(a);
  b = babs(b);
  while (b) [a, b] = [b, a % b];
  return a;
}
function q(n: bigint | number, d: bigint | number = 1): Q {
  let nn = BigInt(n);
  let dd = BigInt(d);
  if (dd === 0n) throw new Error('oracle: zero denominator');
  if (dd < 0n) [nn, dd] = [-nn, -dd];
  const g = bgcd(nn, dd) || 1n;
  return { n: nn / g, d: dd / g };
}
const ZERO = q(0);
const add = (x: Q, y: Q) => q(x.n * y.d + y.n * x.d, x.d * y.d);
const neg = (x: Q) => q(-x.n, x.d);
const sub = (x: Q, y: Q) => add(x, neg(y));
const mul = (x: Q, y: Q) => q(x.n * y.n, x.d * y.d);
const div = (x: Q, y: Q) => q(x.n * y.d, x.d * y.n);
const isZero = (x: Q) => x.n === 0n;
const eqQ = (x: Q, y: Q) => x.n === y.n && x.d === y.d;
const qText = (x: Q) => (x.d === 1n ? `${x.n}` : `${x.n}/${x.d}`);

// --- Equation AST ---------------------------------------------------------------------------------

/** Magnitudes are positive; the sign lives on `Signed`. */
type Term =
  | { kind: 'x'; k: Q }
  | { kind: 'c'; c: Q; decimal?: boolean }
  /** m·(p·x + q): p, q non-zero integers, m a positive rational */
  | { kind: 'bracket'; m: Q; p: number; q: number };
interface Signed {
  sign: 1 | -1;
  term: Term;
}
type Side = Signed[];
interface Eq {
  left: Side;
  right: Side;
}
interface Lin {
  a: Q;
  b: Q;
}
type Sol = { kind: 'unique'; x: Q } | { kind: 'all' } | { kind: 'none' };

function termLin(t: Term): Lin {
  switch (t.kind) {
    case 'x':
      return { a: t.k, b: ZERO };
    case 'c':
      return { a: ZERO, b: t.c };
    case 'bracket':
      return { a: mul(t.m, q(t.p)), b: mul(t.m, q(t.q)) };
  }
}

function sideLin(side: Side): Lin {
  return side.reduce<Lin>(
    (acc, { sign, term }) => {
      const v = termLin(term);
      return sign > 0
        ? { a: add(acc.a, v.a), b: add(acc.b, v.b) }
        : { a: sub(acc.a, v.a), b: sub(acc.b, v.b) };
    },
    { a: ZERO, b: ZERO },
  );
}

/** The formula: (aL − aR)·x = bR − bL. */
function oracle(eq: Eq): Sol {
  const l = sideLin(eq.left);
  const r = sideLin(eq.right);
  const a = sub(l.a, r.a);
  const b = sub(r.b, l.b);
  if (!isZero(a)) return { kind: 'unique', x: div(b, a) };
  return isZero(b) ? { kind: 'all' } : { kind: 'none' };
}

function sameSol(x: Sol, y: Sol): boolean {
  if (x.kind === 'unique' && y.kind === 'unique') return eqQ(x.x, y.x);
  return x.kind === y.kind;
}

// --- Printing -------------------------------------------------------------------------------------

/** `times` is '' for implicit multiplication ("3x", "2(x + 1)") or ' * ' for explicit. */
interface Style {
  times: string;
}
const IMPLICIT: Style = { times: '' };

function decimalText(c: Q): string {
  const tenths = (c.n * 10n) / c.d; // only built for denominators dividing 10
  return `${tenths / 10n}.${tenths % 10n}`;
}

function termText(t: Term, s: Style): string {
  const over = (text: string, d: bigint) => (d === 1n ? text : `${text}/${d}`);
  switch (t.kind) {
    case 'x':
      return over(t.k.n === 1n ? 'x' : `${t.k.n}${s.times}x`, t.k.d);
    case 'c':
      return t.decimal ? decimalText(t.c) : qText(t.c);
    case 'bracket': {
      const coef = t.p === 1 ? '' : t.p === -1 ? '-' : `${t.p}${s.times}`;
      const inner = `${coef}x ${t.q < 0 ? '-' : '+'} ${Math.abs(t.q)}`;
      const prefix = t.m.n === 1n ? '' : `${t.m.n}${s.times}`;
      return over(`${prefix}(${inner})`, t.m.d);
    }
  }
}

function sideText(side: Side, s: Style = IMPLICIT): string {
  if (side.length === 0) return '0';
  return side
    .map(({ sign, term }, i) => {
      const t = termText(term, s);
      if (i === 0) return sign < 0 ? `-${t}` : t;
      return ` ${sign < 0 ? '-' : '+'} ${t}`;
    })
    .join('');
}

const eqText = (eq: Eq, s: Style = IMPLICIT) =>
  `${sideText(eq.left, s)} = ${sideText(eq.right, s)}`;

// --- Generators -----------------------------------------------------------------------------------

const digit = fc.integer({ min: 1, max: 9 });
const nonZero = fc.integer({ min: -9, max: 9 }).filter((v) => v !== 0);
const coefArb: fc.Arbitrary<Q> = fc.oneof(
  { weight: 3, arbitrary: digit.map((n) => q(n)) },
  {
    weight: 1,
    arbitrary: fc.tuple(digit, fc.integer({ min: 2, max: 6 })).map(([n, d]) => q(n, d)),
  },
);
const termArb: fc.Arbitrary<Term> = fc.oneof(
  coefArb.map((k): Term => ({ kind: 'x', k })),
  digit.map((n): Term => ({ kind: 'c', c: q(n) })),
  fc
    .integer({ min: 1, max: 99 })
    .filter((n) => n % 10 !== 0)
    .map((n): Term => ({ kind: 'c', c: q(n, 10), decimal: true })),
  fc
    .record({ m: coefArb, p: nonZero, q: nonZero })
    .map(({ m, p, q }): Term => ({ kind: 'bracket', m, p, q })),
);
const signedArb: fc.Arbitrary<Signed> = fc.record({
  sign: fc.constantFrom<1 | -1>(1, -1),
  term: termArb,
});
const sideArb = fc.array(signedArb, { minLength: 1, maxLength: 3 });

/** A linear equation with exactly one solution, short enough for the engine's input limit. */
const eqArb: fc.Arbitrary<Eq> = fc
  .record({ left: sideArb, right: sideArb })
  .filter((eq) => oracle(eq).kind === 'unique' && eqText(eq, { times: ' * ' }).length <= 110);

// --- Transformations ------------------------------------------------------------------------------

/** A step: the next line as the AST (for the oracle) and as the text the student types. */
interface Line {
  eq: Eq;
  text: string;
}
const line = (eq: Eq): Line => ({ eq, text: eqText(eq) });

const flip = (s: Signed): Signed => ({ sign: s.sign > 0 ? -1 : 1, term: s.term });

function scaleTerm(t: Term, f: Q): Term {
  switch (t.kind) {
    case 'x':
      return { kind: 'x', k: mul(t.k, f) };
    case 'c':
      return { kind: 'c', c: mul(t.c, f) };
    case 'bracket':
      return { ...t, m: mul(t.m, f) };
  }
}

/** Multiply every term of a side by a non-zero rational. */
function scaleSide(side: Side, f: Q): Side {
  const negative = f.n < 0n;
  const mag = negative ? neg(f) : f;
  return side.map((s) => {
    const scaled = { sign: s.sign, term: scaleTerm(s.term, mag) };
    return negative ? flip(scaled) : scaled;
  });
}

function expandAt(s: Signed): Side {
  if (s.term.kind !== 'bracket') return [s];
  const { m, p, q: c } = s.term;
  return [
    { sign: (s.sign * Math.sign(p)) as 1 | -1, term: { kind: 'x', k: mul(m, q(Math.abs(p))) } },
    { sign: (s.sign * Math.sign(c)) as 1 | -1, term: { kind: 'c', c: mul(m, q(Math.abs(c))) } },
  ];
}

function combineLike(side: Side): Side {
  const brackets = side.filter((s) => s.term.kind === 'bracket');
  const { a, b } = sideLin(side.filter((s) => s.term.kind !== 'bracket'));
  const out: Side = [];
  if (!isZero(a))
    out.push({ sign: a.n < 0n ? -1 : 1, term: { kind: 'x', k: a.n < 0n ? neg(a) : a } });
  out.push(...brackets);
  if (!isZero(b))
    out.push({ sign: b.n < 0n ? -1 : 1, term: { kind: 'c', c: b.n < 0n ? neg(b) : b } });
  return out;
}

const without = <T>(xs: readonly T[], i: number) => [...xs.slice(0, i), ...xs.slice(i + 1)];
const pick = <T>(xs: readonly T[], i: number) => xs[i % xs.length]!;
const bracketIndexes = (side: Side) =>
  side.flatMap((s, i) => (s.term.kind === 'bracket' ? [i] : []));
const sides = (eq: Eq, which: 0 | 1) =>
  which === 0 ? ([eq.left, eq.right] as const) : ([eq.right, eq.left] as const);
const rebuild = (which: 0 | 1, own: Side, other: Side): Eq =>
  which === 0 ? { left: own, right: other } : { left: other, right: own };

type CorrectOp =
  | { op: 'addBoth'; term: Signed }
  | { op: 'mulBoth'; k: number; wrap: boolean }
  | { op: 'divBoth'; k: number; wrap: boolean; colon: boolean }
  | { op: 'expand'; side: 0 | 1; i: number }
  | { op: 'transfer'; side: 0 | 1; i: number }
  | { op: 'combine'; side: 0 | 1 }
  | { op: 'reorder'; side: 0 | 1 }
  | { op: 'swap' };

const sideIdx = fc.constantFrom<0 | 1>(0, 1);
const idx = fc.nat({ max: 20 });
const factor = fc.integer({ min: -6, max: 6 }).filter((k) => k !== 0);

const correctOpArb: fc.Arbitrary<CorrectOp> = fc.oneof(
  signedArb
    .filter((s) => s.term.kind !== 'bracket')
    .map((term): CorrectOp => ({ op: 'addBoth', term })),
  fc.record({ k: factor, wrap: fc.boolean() }).map((r): CorrectOp => ({ op: 'mulBoth', ...r })),
  fc
    .record({ k: factor, wrap: fc.boolean(), colon: fc.boolean() })
    .map((r): CorrectOp => ({ op: 'divBoth', ...r })),
  fc.record({ side: sideIdx, i: idx }).map((r): CorrectOp => ({ op: 'expand', ...r })),
  fc.record({ side: sideIdx, i: idx }).map((r): CorrectOp => ({ op: 'transfer', ...r })),
  sideIdx.map((side): CorrectOp => ({ op: 'combine', side })),
  sideIdx.map((side): CorrectOp => ({ op: 'reorder', side })),
  fc.constant<CorrectOp>({ op: 'swap' }),
);

/** Applies a mathematically valid step; null when it does not apply to this line. */
function applyCorrect(eq: Eq, o: CorrectOp): Line | null {
  switch (o.op) {
    case 'addBoth':
      return line({ left: [...eq.left, o.term], right: [...eq.right, o.term] });
    case 'mulBoth': {
      const next = { left: scaleSide(eq.left, q(o.k)), right: scaleSide(eq.right, q(o.k)) };
      if (!o.wrap) return line(next);
      // "3(x + 4) = 2x + 19"  →  "2(3(x + 4)) = 2(2x + 19)"
      return { eq: next, text: `${o.k}(${sideText(eq.left)}) = ${o.k}(${sideText(eq.right)})` };
    }
    case 'divBoth': {
      const f = q(1, o.k);
      const next = { left: scaleSide(eq.left, f), right: scaleSide(eq.right, f) };
      if (!o.wrap) return line(next);
      const op = o.colon ? ' : ' : '/';
      const d = o.k < 0 ? `(${o.k})` : `${o.k}`;
      return {
        eq: next,
        text: `(${sideText(eq.left)})${op}${d} = (${sideText(eq.right)})${op}${d}`,
      };
    }
    case 'expand': {
      const [own, other] = sides(eq, o.side);
      const bs = bracketIndexes(own);
      if (bs.length === 0) return null;
      const at = pick(bs, o.i);
      const next = [...own.slice(0, at), ...expandAt(own[at]!), ...own.slice(at + 1)];
      return line(rebuild(o.side, next, other));
    }
    case 'transfer': {
      const [own, other] = sides(eq, o.side);
      if (own.length === 0) return null;
      const at = o.i % own.length;
      const moved = flip(own[at]!);
      return line(rebuild(o.side, without(own, at), [...other, moved]));
    }
    case 'combine': {
      const [own, other] = sides(eq, o.side);
      return line(rebuild(o.side, combineLike(own), other));
    }
    case 'reorder': {
      const [own, other] = sides(eq, o.side);
      return line(rebuild(o.side, [...own].reverse(), other));
    }
    case 'swap':
      return line({ left: eq.right, right: eq.left });
  }
}

type WrongOp =
  /** 3(x + 4) → 3x + 4 */
  | { op: 'distributeFirstOnly'; side: 0 | 1; i: number }
  /** 3x + 12 = 2x + 19 → 3x − 2x = 19 + 12 */
  | { op: 'transferKeepSign'; side: 0 | 1; i: number }
  /** add a term, or multiply, on one side only */
  | { op: 'oneSideAdd'; side: 0 | 1; term: Signed }
  | { op: 'oneSideMul'; side: 0 | 1; k: number }
  /** 2x + 6 = 10 → x + 6 = 5 */
  | { op: 'divideFirstTermOnly'; side: 0 | 1; k: number };

const wrongOpArb: fc.Arbitrary<WrongOp> = fc.oneof(
  fc.record({ side: sideIdx, i: idx }).map((r): WrongOp => ({ op: 'distributeFirstOnly', ...r })),
  fc.record({ side: sideIdx, i: idx }).map((r): WrongOp => ({ op: 'transferKeepSign', ...r })),
  fc
    .record({ side: sideIdx, term: signedArb.filter((s) => s.term.kind !== 'bracket') })
    .map((r): WrongOp => ({ op: 'oneSideAdd', ...r })),
  fc.record({ side: sideIdx, k: factor }).map((r): WrongOp => ({ op: 'oneSideMul', ...r })),
  fc
    .record({ side: sideIdx, k: factor.filter((k) => Math.abs(k) > 1) })
    .map((r): WrongOp => ({ op: 'divideFirstTermOnly', ...r })),
);

/** Applies a typical student mistake. It may happen to keep the solution set — the oracle decides. */
function applyWrong(eq: Eq, o: WrongOp): Line | null {
  const [own, other] = sides(eq, o.side);
  if (own.length === 0) return null;
  switch (o.op) {
    case 'distributeFirstOnly': {
      const bs = bracketIndexes(own);
      if (bs.length === 0) return null;
      const at = pick(bs, o.i);
      const s = own[at]!;
      if (s.term.kind !== 'bracket') return null;
      const { m, p, q: c } = s.term;
      const wrong: Side = [
        { sign: (s.sign * Math.sign(p)) as 1 | -1, term: { kind: 'x', k: mul(m, q(Math.abs(p))) } },
        { sign: (s.sign * Math.sign(c)) as 1 | -1, term: { kind: 'c', c: q(Math.abs(c)) } },
      ];
      return line(rebuild(o.side, [...own.slice(0, at), ...wrong, ...own.slice(at + 1)], other));
    }
    case 'transferKeepSign': {
      const at = o.i % own.length;
      return line(rebuild(o.side, without(own, at), [...other, own[at]!]));
    }
    case 'oneSideAdd':
      return line(rebuild(o.side, [...own, o.term], other));
    case 'oneSideMul':
      return line(rebuild(o.side, scaleSide(own, q(o.k)), other));
    case 'divideFirstTermOnly': {
      const f = q(1, o.k);
      const [first, ...rest] = own;
      const wrongOwn = [...scaleSide([first!], f), ...rest];
      return line(rebuild(o.side, wrongOwn, scaleSide(other, f)));
    }
  }
}

// --- Helpers --------------------------------------------------------------------------------------

function expectSideEquals(side: Pick<ParsedEquation['left'], 'a' | 'b'>, lin: Lin) {
  expect(qText({ n: side.a.num, d: side.a.den })).toBe(qText(lin.a));
  expect(qText({ n: side.b.num, d: side.b.den })).toBe(qText(lin.b));
}

function engineSolution(text: string): string {
  const s = solve(parseEquation(text));
  return s.kind === 'unique' ? `x = ${s.value.toString()}` : s.kind;
}
function oracleSolution(eq: Eq): string {
  const s = oracle(eq);
  return s.kind === 'unique' ? `x = ${qText(s.x)}` : s.kind;
}

const fits = (...texts: string[]) => texts.every((t) => t.length <= MAX_INPUT_LENGTH);

// --- Properties -----------------------------------------------------------------------------------

describe('math engine properties', () => {
  it('the generator covers brackets, x on both sides and fraction coefficients', () => {
    const sample = fc
      .sample(eqArb, { numRuns: NUM_RUNS, seed: 1 })
      .map((eq) => parseEquation(eqText(eq)));
    const share = (f: (e: ParsedEquation) => boolean) => sample.filter(f).length / sample.length;
    expect(share((e) => e.features.hasDistribution)).toBeGreaterThan(0.3);
    expect(share((e) => e.features.variableOnBothSides)).toBeGreaterThan(0.3);
    expect(share((e) => e.features.hasFractionCoefficients)).toBeGreaterThan(0.3);
  });

  it('1. parseEquation + solve gives the independently computed solution', () => {
    fc.assert(
      fc.property(eqArb, (eq) => {
        const text = eqText(eq);
        const parsed = parseEquation(text);
        expectSideEquals(parsed.left, sideLin(eq.left));
        expectSideEquals(parsed.right, sideLin(eq.right));
        expect(engineSolution(text)).toBe(oracleSolution(eq));
      }),
    );
  });

  it('2. every valid transformation is accepted as a correct step', () => {
    fc.assert(
      fc.property(eqArb, fc.array(correctOpArb, { minLength: 1, maxLength: 4 }), (eq, ops) => {
        let prev = line(eq);
        for (const o of ops) {
          const next = applyCorrect(prev.eq, o);
          if (!next || !fits(next.text)) continue;
          // The AST transformation itself is valid (guards the test, not the engine).
          expect(oracleSolution(next.eq)).toBe(oracleSolution(eq));
          const r = checkStep(prev.text, next.text);
          expect(r.equivalent, `${prev.text}  →  ${next.text}  (${o.op})`).toBe(true);
          prev = next;
        }
      }),
    );
  });

  it('3. a typical mistake is flagged exactly when it changes the solution set', () => {
    let flagged = 0;
    fc.assert(
      fc.property(eqArb, wrongOpArb, (eq, o) => {
        const prev = line(eq);
        const next = applyWrong(eq, o);
        fc.pre(next !== null && fits(next.text));
        const changed = !sameSol(oracle(eq), oracle(next.eq));
        if (changed) flagged++;
        const r = checkStep(prev.text, next.text);
        expect(r.equivalent, `${prev.text}  →  ${next.text}  (${o.op})`).toBe(!changed);
      }),
    );
    // Sanity: the generator really produces mistakes, not mostly harmless rewrites.
    expect(flagged).toBeGreaterThan(NUM_RUNS / 2);
  });

  it('4. notation does not change the result: − × · ÷ ":" decimal comma, spaces, X', () => {
    const variants: Record<string, readonly string[]> = {
      '-': ['-', '−', '–', '—'],
      '*': ['*', '×', '·', '∙', '⋅'],
      '/': ['/', ':', '÷'],
      '.': ['.', ','],
      ' ': [' ', '', '  ', '\t'],
      x: ['x', 'X'],
    };
    const mutate = (text: string, choices: number[]) =>
      [...text].map((ch, i) => (variants[ch] ? pick(variants[ch], choices[i] ?? 0) : ch)).join('');

    fc.assert(
      fc.property(
        eqArb,
        fc.array(fc.nat({ max: 99 }), { minLength: 130, maxLength: 130 }),
        (eq, choices) => {
          const canonical = eqText(eq, { times: ' * ' });
          const variant = mutate(canonical, choices);
          fc.pre(fits(variant));
          for (const text of [canonical, eqText(eq), variant]) {
            const parsed = parseEquation(text);
            expectSideEquals(parsed.left, sideLin(eq.left));
            expectSideEquals(parsed.right, sideLin(eq.right));
          }
        },
      ),
    );
  });

  it('5. isFinalForm holds only for "x = <number in lowest terms>"', () => {
    const gcdN = (a: number, b: number): number => (b ? gcdN(b, a % b) : a);
    type Num = { text: string; simplified: boolean };
    const numArb: fc.Arbitrary<Num> = fc.oneof(
      fc.integer({ min: -99, max: 99 }).map((n) => ({ text: `${n}`, simplified: true })),
      fc
        .tuple(fc.boolean(), fc.nat({ max: 99 }), fc.integer({ min: 1, max: 9 }))
        .map(([minus, i, f]) => ({ text: `${minus ? '-' : ''}${i}.${f}`, simplified: true })),
      fc
        .tuple(
          fc.integer({ min: -20, max: 20 }),
          fc.integer({ min: -12, max: 12 }).filter((d) => d !== 0),
        )
        .map(([p, d]) => ({
          text: `${p}/${d}`,
          simplified: d > 1 && gcdN(Math.abs(p), d) === 1,
        })),
      fc
        .tuple(digit, digit, fc.constantFrom('+', '-', '*'))
        .map(([a, b, op]) => ({ text: `${a} ${op} ${b}`, simplified: false })),
      digit.map((n) => ({ text: `(${n})`, simplified: false })),
    );
    const varSideArb = fc.oneof(
      fc.constantFrom('x', 'X').map((text) => ({ text, bare: true })),
      fc
        .constantFrom('2x', '-x', '1x', 'x + 0', '(x)', '1 * x', 'x / 1', '0 + x', 'x - 0')
        .map((text) => ({ text, bare: false })),
    );
    const spaces = fc.constantFrom('', ' ', '  ');

    fc.assert(
      fc.property(
        varSideArb,
        numArb,
        fc.boolean(),
        fc.constantFrom('x', 'y', 'n'),
        spaces,
        spaces,
        (v, num, swap, letter, s1, s2) => {
          const varText = v.text.replace(/x/i, (m) => (m === 'X' ? letter.toUpperCase() : letter));
          const text = swap
            ? `${num.text}${s1}=${s2}${varText}`
            : `${varText}${s1}=${s2}${num.text}`;
          const parsed = parseEquation(text);
          expect(isFinalForm(parsed), text).toBe(v.bare && num.simplified);
        },
      ),
    );
  });

  it('6. fuzz: any input up to 120 chars parses or throws MathInputError, quickly', () => {
    const tokens = [
      ...'0123456789xyzaeiXY+-*/^()[]{}=.,:;!%\'"?<>&|~ \t\n·×−–÷',
      'sqrt',
      'pi',
      'mod',
      'to',
      '1e9',
      '1e400',
      '0x1F',
      '0b101',
      '99999999',
      'import',
      'true',
    ];
    const mathy = fc.array(fc.constantFrom(...tokens), { maxLength: 40 }).map((ts) => ts.join(''));
    // Random text rarely parses far enough to reach the tree walker, so also inject foreign
    // syntax into an otherwise valid equation.
    const foreign = fc.constantFrom(
      'sqrt(4)',
      'abs(x)',
      'f(x)(2)',
      'x[1]',
      'x.y',
      '[1, 2]',
      '{a: 1}',
      '2!',
      ' mod 2',
      ' to cm',
      "x'",
      '"s"',
      'pi',
      'true',
      'x^x',
      '2^(1/2)',
      '9^9^9',
      'x ? 1 : 2',
      'a = b',
      '1/(x - x)',
      '0^0',
      '(-8)^(1/3)',
      'x == 1',
      '1e-7',
    );
    const injected = fc.tuple(eqArb, fc.nat(), foreign).map(([eq, at, bit]) => {
      const text = eqText(eq);
      const i = at % (text.length + 1);
      return `${text.slice(0, i)}${bit}${text.slice(i)}`.slice(0, MAX_INPUT_LENGTH);
    });
    const inputArb = fc.oneof(
      fc.string({ maxLength: MAX_INPUT_LENGTH }),
      fc.string({ unit: 'binary', maxLength: MAX_INPUT_LENGTH }),
      mathy,
      fc.tuple(mathy, mathy).map(([l, r]) => `${l}=${r}`.slice(0, MAX_INPUT_LENGTH)),
      injected,
    );
    const expectInputError = (fn: () => unknown, input: string) => {
      try {
        fn();
      } catch (e) {
        expect(e, `input: ${JSON.stringify(input)}`).toBeInstanceOf(MathInputError);
      }
    };

    fc.assert(
      fc.property(inputArb, (input) => {
        const started = Date.now();
        expect(() => classifyInput(input)).not.toThrow();
        expectInputError(() => {
          const parsed = parseEquation(input);
          isFinalForm(parsed);
          solve(parsed);
        }, input);
        expectInputError(() => checkStep('3(x + 4) = 2x + 19', input), input);
        expect(Date.now() - started, `slow input: ${JSON.stringify(input)}`).toBeLessThan(250);
      }),
      { numRuns: 1000 },
    );
  });
});
