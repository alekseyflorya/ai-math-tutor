import { create, parseDependencies } from 'mathjs/number';
import type { MathNode } from 'mathjs';
import { MathInputError } from './errors';
import { Fraction } from './fraction';

/**
 * Safe parser for linear equations in one variable.
 *
 * mathjs is used ONLY to build a syntax tree; we never call mathjs `evaluate` on
 * student input. Instead we walk a whitelist of node types and reduce every side
 * of the equation to the exact linear form  a·x + b  (a, b rational).
 * Anything outside that whitelist (functions, assignments, matrices, strings...)
 * is rejected, which closes the usual expression-evaluator injection holes.
 */
const math = create({ parseDependencies: parseDependencies! });

export const MAX_INPUT_LENGTH = 120;
const MAX_NODES = 200;
const MAX_POWER = 6;

export { MathInputError, type MathErrorCode } from './errors';

/** a·x + b */
export interface Linear {
  a: Fraction;
  b: Fraction;
}

export interface ParsedSide extends Linear {
  latex: string;
}

export interface ParsedEquation {
  raw: string;
  normalized: string;
  /** null when the equation contains no variable at all, e.g. "4 = 4" */
  variable: string | null;
  left: ParsedSide;
  right: ParsedSide;
  latex: string;
  features: EquationFeatures;
}

export interface EquationFeatures {
  /** a constant multiplies a bracket that contains the variable, e.g. 3(x + 4) */
  hasDistribution: boolean;
  variableOnBothSides: boolean;
  hasFractionCoefficients: boolean;
}

export type SolutionSet = { kind: 'unique'; value: Fraction } | { kind: 'all' } | { kind: 'none' };

/**
 * Normalises what students actually type: unicode minus and multiplication signs,
 * the ":" division sign used in post-Soviet schools, and decimal commas (2,5).
 */
export function normalizeMathInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[−–—]/g, '-')
    .replace(/[×·∙⋅]/g, '*')
    .replace(/÷/g, '/')
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/:/g, '/')
    .replace(/\s+/g, ' ');
}

export function parseEquation(input: string, opts: { variable?: string } = {}): ParsedEquation {
  const normalized = normalizeMathInput(input);
  if (!normalized) throw new MathInputError('EMPTY', 'Input is empty');
  if (normalized.length > MAX_INPUT_LENGTH) {
    throw new MathInputError('TOO_LONG', `Input is longer than ${MAX_INPUT_LENGTH} characters`);
  }
  const parts = normalized.split('=');
  if (parts.length === 1) throw new MathInputError('NOT_AN_EQUATION', 'No "=" sign found');
  if (parts.length > 2) throw new MathInputError('MULTIPLE_EQUALS', 'More than one "=" sign');

  const vars = new Set<string>();
  const features = { hasDistribution: false, hasFractionCoefficients: false };
  const [leftText, rightText] = parts as [string, string];
  const leftNode = parseSide(leftText);
  const rightNode = parseSide(rightText);
  const leftVars = new Set<string>();
  const rightVars = new Set<string>();
  const left = toLinear(leftNode, leftVars, features);
  const right = toLinear(rightNode, rightVars, features);
  leftVars.forEach((v) => vars.add(v));
  rightVars.forEach((v) => vars.add(v));

  if (vars.size > 1) {
    throw new MathInputError(
      'MULTIPLE_VARIABLES',
      `Only one variable is supported, found: ${[...vars].join(', ')}`,
    );
  }
  const variable = vars.size === 1 ? [...vars][0]! : null;
  if (opts.variable && variable && variable !== opts.variable) {
    throw new MathInputError(
      'WRONG_VARIABLE',
      `Expected the variable "${opts.variable}", found "${variable}"`,
    );
  }

  for (const lin of [left, right]) {
    if (!lin.a.isInteger() || !lin.b.isInteger()) features.hasFractionCoefficients = true;
  }

  const leftLatex = toTex(leftNode);
  const rightLatex = toTex(rightNode);
  return {
    raw: input,
    normalized,
    variable,
    left: { ...left, latex: leftLatex },
    right: { ...right, latex: rightLatex },
    latex: `${leftLatex} = ${rightLatex}`,
    features: {
      ...features,
      variableOnBothSides:
        leftVars.size > 0 && rightVars.size > 0 && !left.a.isZero() && !right.a.isZero(),
    },
  };
}

/**
 * Routes free-form input: "3x + 12 = 2x + 19" is a solution step, "why is it 12?" is a
 * message to the tutor. A step that fails to parse is still a step (the student gets a
 * precise "I couldn't read that" instead of a chat reply), so we decide on shape only:
 * it has "=", and contains no words (2+ letters in a row) or non-latin text.
 */
export function classifyInput(text: string): 'step' | 'message' {
  const t = normalizeMathInput(text);
  if (!t.includes('=')) return 'message';
  if (/[a-z]{2,}/.test(t) || /[?!]/.test(t) || /[^\x20-\x7e]/.test(t)) return 'message';
  return 'step';
}

export function solve(eq: Pick<ParsedEquation, 'left' | 'right'>): SolutionSet {
  // left - right = 0  →  a·x + b = 0
  const a = eq.left.a.sub(eq.right.a);
  const b = eq.left.b.sub(eq.right.b);
  if (!a.isZero()) return { kind: 'unique', value: b.neg().div(a) };
  return b.isZero() ? { kind: 'all' } : { kind: 'none' };
}

export function sameSolutionSet(x: SolutionSet, y: SolutionSet): boolean {
  if (x.kind !== y.kind) return false;
  return x.kind === 'unique' && y.kind === 'unique' ? x.value.equals(y.value) : true;
}

export function describeSolution(s: SolutionSet, variable = 'x'): string {
  if (s.kind === 'unique') return `${variable} = ${s.value.toString()}`;
  return s.kind === 'all' ? 'every number is a solution' : 'no solution';
}

/**
 * "x = 7", "7 = x", "x = -3/2", "x = 2.5": the bare variable on one side and a single,
 * fully simplified number on the other, as WRITTEN. Not final yet: "3x - 2x = 19 - 12"
 * (same solution, still needs simplifying) and "x = 18/3" (the fraction can be reduced).
 */
export function isFinalForm(eq: ParsedEquation): boolean {
  if (!eq.variable) return false;
  const v = eq.variable;
  const num = String.raw`(-?\d+(?:\.\d+)?(?:\s*\/\s*-?\d+(?:\.\d+)?)?)`;
  const m = new RegExp(String.raw`^(?:${v}\s*=\s*${num}|${num}\s*=\s*${v})$`).exec(
    eq.normalized.trim(),
  );
  if (!m) return false;
  return isSimplifiedNumber((m[1] ?? m[2])!);
}

/** "6", "-2.5", "3/2" are simplified; "18/3", "4/2", "6/1", "1.5/3", "3/-2" are not. */
function isSimplifiedNumber(text: string): boolean {
  const [numerator, denominator] = text.replace(/\s/g, '').split('/');
  if (denominator === undefined) return true;
  if (!/^-?\d+$/.test(numerator!) || !/^\d+$/.test(denominator)) return false;
  const p = Math.abs(Number(numerator));
  const q = Number(denominator);
  if (q <= 1) return false;
  let a = p;
  let b = q;
  while (b) [a, b] = [b, a % b];
  return a === 1;
}

export function evaluateSide(side: Linear, value: Fraction): Fraction {
  return side.a.mul(value).add(side.b);
}

export function formatLinear(side: Linear, variable = 'x'): string {
  const parts: string[] = [];
  if (!side.a.isZero()) {
    const a = side.a;
    if (a.equals(Fraction.ONE)) parts.push(variable);
    else if (a.equals(Fraction.ONE.neg())) parts.push(`-${variable}`);
    else if (a.isInteger()) parts.push(`${a.num}${variable}`);
    else parts.push(`(${a.toString()})${variable}`);
  }
  if (!side.b.isZero() || parts.length === 0) {
    if (parts.length === 0) parts.push(side.b.toString());
    else {
      const negative = side.b.isNegative();
      parts.push(
        `${negative ? '-' : '+'} ${negative ? side.b.neg().toString() : side.b.toString()}`,
      );
    }
  }
  return parts.join(' ');
}

export function formatEquation(eq: Pick<ParsedEquation, 'left' | 'right'>, variable = 'x'): string {
  return `${formatLinear(eq.left, variable)} = ${formatLinear(eq.right, variable)}`;
}

// ---------------------------------------------------------------------------

function parseSide(text: string): MathNode {
  if (!text.trim()) throw new MathInputError('SYNTAX', 'One side of the equation is empty');
  let node: MathNode;
  try {
    node = math.parse(text);
  } catch {
    throw new MathInputError('SYNTAX', `Could not read "${text.trim()}"`);
  }
  let count = 0;
  node.traverse(() => {
    count++;
  });
  if (count > MAX_NODES) throw new MathInputError('TOO_LONG', 'Expression is too complex');
  return node;
}

function toTex(node: MathNode): string {
  try {
    // mathjs puts "~" (a visible space) around implicit multiplication: "3~\left(x+4\right)".
    return node.toTex({ implicit: 'hide', parenthesis: 'keep' }).replace(/~\s*/g, '');
  } catch {
    return node.toString();
  }
}

const isVariableName = (name: string) => /^[a-z]$/.test(name);

type FeatureFlags = { hasDistribution: boolean; hasFractionCoefficients: boolean };

/** The node shapes the walker understands. Anything else falls to `default` and is rejected. */
type KnownNode =
  | { type: 'ConstantNode'; value: unknown }
  | { type: 'SymbolNode'; name: string }
  | { type: 'ParenthesisNode'; content: MathNode }
  | { type: 'FunctionNode'; fn: { name?: unknown } | undefined; args: MathNode[] }
  | { type: 'OperatorNode'; fn: string; op: string; args: MathNode[] };

function toLinear(node: MathNode, vars: Set<string>, flags: FeatureFlags): Linear {
  const n = node as unknown as KnownNode;
  switch (n.type) {
    case 'ConstantNode': {
      if (typeof n.value !== 'number')
        throw new MathInputError('UNSUPPORTED', 'Only numbers are allowed');
      return { a: Fraction.ZERO, b: Fraction.fromDecimal(n.value) };
    }
    case 'SymbolNode': {
      if (!isVariableName(n.name))
        throw new MathInputError('UNSUPPORTED', `Unknown symbol "${n.name}"`);
      vars.add(n.name);
      return { a: Fraction.ONE, b: Fraction.ZERO };
    }
    case 'ParenthesisNode':
      return toLinear(n.content, vars, flags);
    case 'FunctionNode': {
      // mathjs reads "x(x + 1)" as a call to a function named x — treat it as multiplication.
      const fnName: unknown = n.fn?.name;
      if (typeof fnName === 'string' && isVariableName(fnName) && n.args.length === 1) {
        vars.add(fnName);
        return multiply({ a: Fraction.ONE, b: Fraction.ZERO }, toLinear(n.args[0]!, vars, flags));
      }
      throw new MathInputError('UNSUPPORTED', 'Functions are not supported');
    }
    case 'OperatorNode': {
      const args = n.args;
      switch (n.fn) {
        case 'unaryPlus':
          return toLinear(args[0]!, vars, flags);
        case 'unaryMinus': {
          const v = toLinear(args[0]!, vars, flags);
          return { a: v.a.neg(), b: v.b.neg() };
        }
        case 'add':
        case 'subtract': {
          const l = toLinear(args[0]!, vars, flags);
          const r = toLinear(args[1]!, vars, flags);
          return n.fn === 'add'
            ? { a: l.a.add(r.a), b: l.b.add(r.b) }
            : { a: l.a.sub(r.a), b: l.b.sub(r.b) };
        }
        case 'multiply': {
          const l = toLinear(args[0]!, vars, flags);
          const r = toLinear(args[1]!, vars, flags);
          if (isBracketWithVariable(args[1]!, r) || isBracketWithVariable(args[0]!, l)) {
            flags.hasDistribution = true;
          }
          return multiply(l, r);
        }
        case 'divide': {
          const l = toLinear(args[0]!, vars, flags);
          const r = toLinear(args[1]!, vars, flags);
          if (!r.a.isZero())
            throw new MathInputError('NONLINEAR', 'The variable cannot be in a denominator');
          if (r.b.isZero()) throw new MathInputError('DIVISION_BY_ZERO', 'Division by zero');
          return { a: l.a.div(r.b), b: l.b.div(r.b) };
        }
        case 'pow': {
          const base = toLinear(args[0]!, vars, flags);
          const exp = toLinear(args[1]!, vars, flags);
          if (
            !exp.a.isZero() ||
            !exp.b.isInteger() ||
            exp.b.isNegative() ||
            !exp.b.fitsWithin(MAX_POWER)
          ) {
            throw new MathInputError('UNSUPPORTED', 'Only small whole-number powers are supported');
          }
          const k = Number(exp.b.num);
          if (k === 0) return { a: Fraction.ZERO, b: Fraction.ONE };
          if (k === 1) return base;
          if (!base.a.isZero())
            throw new MathInputError('NONLINEAR', 'Only linear equations are supported');
          let value = Fraction.ONE;
          for (let i = 0; i < k; i++) value = value.mul(base.b);
          return { a: Fraction.ZERO, b: value };
        }
        default:
          throw new MathInputError('UNSUPPORTED', `Operator "${n.op}" is not supported`);
      }
    }
    default:
      throw new MathInputError('UNSUPPORTED', 'Unsupported expression');
  }
}

function multiply(l: Linear, r: Linear): Linear {
  if (!l.a.isZero() && !r.a.isZero()) {
    throw new MathInputError('NONLINEAR', 'Only linear equations are supported');
  }
  if (l.a.isZero()) return { a: r.a.mul(l.b), b: r.b.mul(l.b) };
  return { a: l.a.mul(r.b), b: l.b.mul(r.b) };
}

function isBracketWithVariable(node: MathNode, value: Linear): boolean {
  return node.type === 'ParenthesisNode' && !value.a.isZero() && !value.b.isZero();
}
