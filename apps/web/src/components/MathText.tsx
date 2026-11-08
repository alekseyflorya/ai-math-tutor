import katex from 'katex';
import { memo, useMemo } from 'react';

function renderTex(tex: string, display = false): string {
  return katex.renderToString(tex, {
    throwOnError: false,
    displayMode: display,
    strict: 'ignore',
    trust: false,
  });
}

/** Renders a LaTeX formula. KaTeX output is sanitized markup (trust: false). */
export const Tex = memo(function Tex({
  tex,
  display,
  className,
}: {
  tex: string;
  display?: boolean;
  className?: string;
}) {
  const html = useMemo(() => renderTex(tex, display), [tex, display]);
  return <span className={className} dangerouslySetInnerHTML={{ __html: html }} />;
});

type Segment = { kind: 'text' | 'math' | 'code' | 'bold'; value: string };

/** Splits "Look at $3(x+4)$ — **every** term, e.g. `3x + 12`" into typed segments. */
function segments(text: string): Segment[] {
  const out: Segment[] = [];
  const re = /\$([^$]+)\$|`([^`]+)`|\*\*([^*]+)\*\*/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) out.push({ kind: 'text', value: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ kind: 'math', value: m[1] });
    else if (m[2] !== undefined) out.push({ kind: 'code', value: m[2] });
    else out.push({ kind: 'bold', value: m[3]! });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
  return out;
}

/** Tutor messages: plain text with inline $math$, `code` and **bold**. No raw HTML is ever injected. */
export const MathText = memo(function MathText({ text }: { text: string }) {
  const parts = useMemo(() => segments(text), [text]);
  return (
    <>
      {parts.map((p, i) => {
        if (p.kind === 'math') return <Tex key={i} tex={p.value} />;
        if (p.kind === 'code')
          return (
            <code
              key={i}
              className="rounded bg-ink-soft px-1 py-0.5 font-mono text-[0.9em] text-ink"
            >
              {p.value}
            </code>
          );
        if (p.kind === 'bold') return <strong key={i}>{p.value}</strong>;
        return <span key={i}>{p.value}</span>;
      })}
    </>
  );
});
