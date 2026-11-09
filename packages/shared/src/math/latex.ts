/**
 * Models write LaTeX inside JSON strings and sometimes forget to double the backslash: "\frac"
 * then parses as a form feed + "rac", "\times" as a tab + "imes", "\neq" as a line feed + "eq".
 * These helpers undo that after JSON.parse.
 */

const MATH = /\$\$[\s\S]*?\$\$|\$[^$]*\$/g;

/** JSON escapes that collide with LaTeX commands. */
const ESCAPED: Record<string, string> = { '\t': 't', '\n': 'n', '\r': 'r', '\f': 'f', '\b': 'b' };

/**
 * Inside $…$ and $$…$$, a TAB, LF, CR, FF or BS followed by a latin letter becomes the command it
 * was meant to be ("\times", "\neq", "\right", "\frac", "\beta"). FF and BS never belong in a
 * message, so they are restored everywhere; a TAB or line break outside math is left alone.
 */
export function repairLatexEscapes(text: string): string {
  // eslint-disable-next-line no-control-regex -- the control characters are what we look for
  const restored = text.replace(/[\f\x08]/g, (c) => `\\${ESCAPED[c]}`);
  return restored.replace(MATH, (math) =>
    math.replace(/[\t\n\r](?=[a-zA-Z])/g, (c) => `\\${ESCAPED[c]}`),
  );
}

/** No control characters inside math, and no FF/BS anywhere: the LaTeX survived JSON. */
export function isLatexIntact(text: string): boolean {
  // eslint-disable-next-line no-control-regex -- the control characters are what we look for
  if (/[\f\x08]/.test(text)) return false;
  // eslint-disable-next-line no-control-regex -- same
  return !(text.match(MATH) ?? []).some((math) => /[\x00-\x1f]/.test(math));
}
