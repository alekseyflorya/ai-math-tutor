import { MathInputError } from './errors';

/** Reduced numerators/denominators above this are rejected as "too large" input. */
const MAX_MAGNITUDE = 10n ** 30n;

/**
 * Exact rational arithmetic on bigint. Floats would make "is this step equivalent?"
 * unreliable (0.1 + 0.2 !== 0.3), and plain numbers silently lose precision once an
 * intermediate product passes 2^53 — the tutor must never mark a correct step wrong.
 */
export class Fraction {
  readonly num: bigint;
  readonly den: bigint;

  constructor(num: bigint, den: bigint = 1n) {
    if (den === 0n) throw new MathInputError('DIVISION_BY_ZERO', 'Division by zero');
    const sign = den < 0n ? -1n : 1n;
    const g = gcd(abs(num), abs(den)) || 1n;
    this.num = (sign * num) / g;
    this.den = abs(den) / g;
    if (abs(this.num) > MAX_MAGNITUDE || this.den > MAX_MAGNITUDE) {
      throw new MathInputError('TOO_LONG', 'Number is too large');
    }
  }

  static readonly ZERO = new Fraction(0n);
  static readonly ONE = new Fraction(1n);

  static fromInteger(value: number): Fraction {
    if (!Number.isSafeInteger(value)) throw new MathInputError('TOO_LONG', 'Number is too large');
    return new Fraction(BigInt(value));
  }

  /**
   * Exact conversion of a finite decimal literal such as 2.5 or 0.125. The parser hands us a
   * JS number, so anything that is not exactly representable (more than ~15 significant
   * digits, exponent notation) is rejected instead of being silently rounded.
   */
  static fromDecimal(value: number): Fraction {
    const text = String(value);
    if (!Number.isFinite(value) || /e/i.test(text)) {
      throw new MathInputError('TOO_LONG', 'Number is too large');
    }
    const [intPart = '0', fracPart = ''] = text.split('.');
    const digits = `${intPart}${fracPart}`;
    if (!Number.isSafeInteger(Number(digits))) {
      throw new MathInputError('TOO_LONG', 'Number is too large');
    }
    return new Fraction(BigInt(digits), 10n ** BigInt(fracPart.length));
  }

  add(o: Fraction) {
    return new Fraction(this.num * o.den + o.num * this.den, this.den * o.den);
  }
  sub(o: Fraction) {
    return new Fraction(this.num * o.den - o.num * this.den, this.den * o.den);
  }
  mul(o: Fraction) {
    return new Fraction(this.num * o.num, this.den * o.den);
  }
  div(o: Fraction) {
    if (o.num === 0n) throw new MathInputError('DIVISION_BY_ZERO', 'Division by zero');
    return new Fraction(this.num * o.den, this.den * o.num);
  }
  neg() {
    return new Fraction(-this.num, this.den);
  }
  isZero() {
    return this.num === 0n;
  }
  isNegative() {
    return this.num < 0n;
  }
  isInteger() {
    return this.den === 1n;
  }
  equals(o: Fraction) {
    return this.num === o.num && this.den === o.den;
  }
  /** |this| ≤ limit */
  fitsWithin(limit: number) {
    return abs(this.num) <= BigInt(limit) * this.den;
  }
  toNumber() {
    return Number(this.num) / Number(this.den);
  }
  toString() {
    return this.den === 1n ? String(this.num) : `${this.num}/${this.den}`;
  }
  toLatex() {
    if (this.den === 1n) return String(this.num);
    const sign = this.num < 0n ? '-' : '';
    return `${sign}\\frac{${abs(this.num)}}{${this.den}}`;
  }
}

function abs(n: bigint): bigint {
  return n < 0n ? -n : n;
}

function gcd(a: bigint, b: bigint): bigint {
  while (b) [a, b] = [b, a % b];
  return a;
}
