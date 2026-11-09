import { describe, expect, it } from 'vitest';
import { isLatexIntact, repairLatexEscapes } from './latex';

// What JSON.parse makes of an un-doubled backslash.
const broken = (s: string) => JSON.parse(`"${s}"`) as string;

describe('repairLatexEscapes', () => {
  it.each([
    ['$9 \\times 6$', '$9 \\times 6$'],
    ['$\\frac{x}{2}$', '$\\frac{x}{2}$'],
    ['$x \\neq 3$', '$x \\neq 3$'],
    ['$(x + 1\\right)$', '$(x + 1\\right)$'], // \left is not a JSON escape: invalid JSON, retried
    ['$\\beta$', '$\\beta$'],
    ['$$\\text{so } \\frac{1}{2}$$', '$$\\text{so } \\frac{1}{2}$$'],
  ])('restores %s', (raw, expected) => {
    const parsed = broken(raw);
    expect(isLatexIntact(parsed)).toBe(false);
    expect(repairLatexEscapes(parsed)).toBe(expected);
    expect(isLatexIntact(repairLatexEscapes(parsed))).toBe(true);
  });

  it('leaves text without math alone', () => {
    const text = 'Look at the brackets.\nWhat\tdo you see?';
    expect(repairLatexEscapes(text)).toBe(text);
    expect(isLatexIntact(text)).toBe(true);
  });

  it('keeps a real line break between sentences and math', () => {
    const text = 'First: $3x + 12$.\nThen: $x = 7$?';
    expect(repairLatexEscapes(text)).toBe(text);
    expect(isLatexIntact(text)).toBe(true);
  });

  it('does not touch a line break inside math that is not followed by a letter', () => {
    expect(repairLatexEscapes('$$3x\n= 12$$')).toBe('$$3x\n= 12$$');
  });

  it('restores form feed and backspace anywhere', () => {
    expect(repairLatexEscapes(broken('Use \\frac and \\beta'))).toBe('Use \\frac and \\beta');
  });

  it('leaves correct LaTeX unchanged', () => {
    const ok = 'So $3 \\cdot (x + 4) = \\frac{6x + 24}{2}$, right?';
    expect(repairLatexEscapes(ok)).toBe(ok);
    expect(isLatexIntact(ok)).toBe(true);
  });
});
