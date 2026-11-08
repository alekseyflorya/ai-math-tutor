/**
 * Minimal exact rational arithmetic. Floats would make "is this step equivalent?"
 * unreliable (0.1 + 0.2 !== 0.3), and the tutor must never mark a correct step wrong.
 */
export class Fraction {
  readonly num: number;
  readonly den: number;

  constructor(num: number, den = 1) {
    if (!Number.isInteger(num) || !Number.isInteger(den)) {
      throw new Error('Fraction parts must be integers');
    }
    if (den === 0) throw new Error('Division by zero');
    const sign = den < 0 ? -1 : 1;
    const g = gcd(Math.abs(num), Math.abs(den)) || 1;
    this.num = (sign * num) / g;
    this.den = Math.abs(den) / g;
    if (!Number.isSafeInteger(this.num) || !Number.isSafeInteger(this.den)) {
      throw new Error('Number too large');
    }
  }

  static readonly ZERO = new Fraction(0);
  static readonly ONE = new Fraction(1);

  /** Exact conversion of a finite decimal literal such as 2.5 or 0.125. */
  static fromDecimal(value: number): Fraction {
    if (!Number.isFinite(value)) throw new Error('Invalid number');
    const text = String(value);
    if (/e/i.test(text)) throw new Error('Number too large');
    const [intPart, fracPart = ''] = text.split('.');
    const den = 10 ** fracPart.length;
    return new Fraction(Number(`${intPart}${fracPart}`.replace(/^(-?)0+(?=\d)/, '$1')), den);
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
    if (o.num === 0) throw new Error('Division by zero');
    return new Fraction(this.num * o.den, this.den * o.num);
  }
  neg() {
    return new Fraction(-this.num, this.den);
  }
  isZero() {
    return this.num === 0;
  }
  isInteger() {
    return this.den === 1;
  }
  equals(o: Fraction) {
    return this.num === o.num && this.den === o.den;
  }
  toNumber() {
    return this.num / this.den;
  }
  toString() {
    return this.den === 1 ? String(this.num) : `${this.num}/${this.den}`;
  }
  toLatex() {
    if (this.den === 1) return String(this.num);
    const sign = this.num < 0 ? '-' : '';
    return `${sign}\\frac{${Math.abs(this.num)}}{${this.den}}`;
  }
}

function gcd(a: number, b: number): number {
  while (b) [a, b] = [b, a % b];
  return a;
}
