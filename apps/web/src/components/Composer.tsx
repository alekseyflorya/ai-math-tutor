import { classifyInput, MathInputError, parseEquation } from '@tutor/shared';
import { Lightbulb, SendHorizontal } from 'lucide-react';
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/i18n';
import { Tex } from './MathText';

interface Props {
  busy: boolean;
  variable: string;
  onSend: (text: string) => void;
  onHint: () => void;
  /** Last verified line, shown above the input on phones where the notebook scrolls away. */
  currentLatex: string;
}

/**
 * One input for both solution steps and questions. The same classifier the server
 * uses (from @tutor/shared) shows live whether this will be checked as a step,
 * and the same parser renders a preview, so what you see is what gets checked.
 */
export function Composer({ busy, variable, onSend, onHint, currentLatex }: Props) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  // The input is disabled while the tutor answers; give focus back afterwards.
  useEffect(() => {
    if (!busy) inputRef.current?.focus({ preventScroll: true });
  }, [busy]);

  const preview = useMemo(() => {
    const value = text.trim();
    if (!value) return null;
    if (classifyInput(value) === 'message') return { kind: 'message' as const };
    try {
      return { kind: 'step' as const, latex: parseEquation(value).latex };
    } catch (e) {
      return {
        kind: 'step' as const,
        latex: null,
        error: e instanceof MathInputError ? e.code : 'SYNTAX',
      };
    }
  }, [text]);

  const submit = (e?: FormEvent) => {
    e?.preventDefault();
    const value = text.trim();
    if (!value || busy) return;
    onSend(value);
    setText('');
  };

  const insert = (s: string) => {
    const el = inputRef.current;
    if (!el) return;
    const start = el.selectionStart ?? text.length;
    const end = el.selectionEnd ?? text.length;
    const next = text.slice(0, start) + s + text.slice(end);
    setText(next);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + s.length, start + s.length);
    });
  };

  return (
    <form onSubmit={submit} className="border-t border-line p-3">
      <div className="mb-2 flex min-h-6 items-center gap-2 text-sm">
        {preview?.kind === 'step' && (
          <>
            <span className="rounded bg-ink-soft px-1.5 py-0.5 text-xs font-bold text-ink">
              {t.inputStep}
            </span>
            {preview.latex ? (
              <Tex tex={preview.latex} className="text-ink" />
            ) : (
              <span className="text-xs text-muted">…</span>
            )}
          </>
        )}
        {!preview && (
          <span className="flex min-w-0 items-center gap-2 text-xs text-muted xl:hidden">
            <span className="shrink-0">{t.lastLine}:</span>
            <Tex tex={currentLatex} className="truncate text-sm text-ink" />
          </span>
        )}
        {preview?.kind === 'message' && (
          <span className="rounded bg-paper-2 px-1.5 py-0.5 text-xs font-bold text-muted">
            {t.inputQuestion}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2">
        <input
          ref={inputRef}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={t.inputPlaceholder}
          maxLength={400}
          disabled={busy}
          autoComplete="off"
          spellCheck={false}
          aria-label={t.inputPlaceholder}
          className="min-w-0 flex-1 rounded-lg border border-line bg-paper px-3 py-2.5 text-base text-text outline-none transition focus:border-ink focus:ring-2 focus:ring-ink-soft disabled:opacity-60"
        />
        <button
          type="button"
          onClick={onHint}
          disabled={busy}
          className="flex items-center gap-1 rounded-lg border border-pen/40 px-3 py-2.5 text-sm font-bold text-pen transition hover:bg-pen-soft disabled:opacity-50"
          title={t.hint}
        >
          <Lightbulb size={16} aria-hidden /> <span className="hidden sm:inline">{t.hint}</span>
        </button>
        <button
          type="submit"
          disabled={busy || !text.trim()}
          className="rounded-lg bg-ink px-3 py-2.5 text-paper transition hover:brightness-110 disabled:opacity-50"
          aria-label={t.send}
          title={t.send}
        >
          <SendHorizontal size={18} />
        </button>
      </div>

      <div className="mt-2 flex flex-wrap gap-1" aria-label={t.keys}>
        {[variable, '(', ')', '=', '+', '−', '·', '/'].map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => insert(k === '−' ? '-' : k === '·' ? '*' : k)}
            disabled={busy}
            className="min-w-8 rounded-md border border-line bg-paper px-2 py-1 font-mono text-sm text-text transition hover:border-ink hover:text-ink disabled:opacity-50"
          >
            {k}
          </button>
        ))}
      </div>
    </form>
  );
}
