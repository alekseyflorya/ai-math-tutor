import { parseEquation, type MessageView } from '@tutor/shared';
import { ArrowRight, Lightbulb } from 'lucide-react';
import { useEffect, useMemo, useRef } from 'react';
import { useI18n } from '../i18n/i18n';
import { MathText, Tex } from './MathText';

interface Props {
  messages: MessageView[];
  pending: MessageView | null;
  thinking: boolean;
  onOpenAttempt: (id: string) => void;
}

export function Chat({ messages, pending, thinking, onOpenAttempt }: Props) {
  const { t } = useI18n();
  const endRef = useRef<HTMLDivElement>(null);
  const all = useMemo(() => (pending ? [...messages, pending] : messages), [messages, pending]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [all.length, thinking]);

  return (
    <div
      className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
      role="log"
      aria-live="polite"
      aria-label={t.tutor}
    >
      {all.map((m) =>
        m.role === 'STUDENT' ? (
          <StudentBubble key={m.id} m={m} />
        ) : (
          <TutorBubble key={m.id} m={m} onOpenAttempt={onOpenAttempt} />
        ),
      )}
      {thinking && (
        <div className="flex items-center gap-2 text-sm text-muted">
          <span className="flex gap-1" aria-hidden>
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="size-1.5 animate-bounce rounded-full bg-pen/60"
                style={{ animationDelay: `${i * 120}ms` }}
              />
            ))}
          </span>
          {t.thinking}
        </div>
      )}
      <div ref={endRef} />
    </div>
  );
}

function StudentBubble({ m }: { m: MessageView }) {
  const latex = useMemo(() => {
    if (m.kind !== 'STEP' && m.id !== 'pending') return null;
    try {
      return parseEquation(m.content).latex;
    } catch {
      return null;
    }
  }, [m]);
  return (
    <div className="animate-rise flex justify-end">
      <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-ink-soft px-3.5 py-2 text-ink">
        {latex ? (
          <Tex tex={latex} className="text-lg" />
        ) : (
          <span className="whitespace-pre-wrap">{m.content}</span>
        )}
      </div>
    </div>
  );
}

function TutorBubble({
  m,
  onOpenAttempt,
}: {
  m: MessageView;
  onOpenAttempt: (id: string) => void;
}) {
  const { t } = useI18n();
  const hintLevel = typeof m.meta?.hintLevel === 'number' ? m.meta.hintLevel : null;
  const nextId = typeof m.meta?.nextAttemptId === 'string' ? m.meta.nextAttemptId : null;

  const tone =
    m.kind === 'HINT' || m.kind === 'EXPLANATION'
      ? 'border-l-4 border-pen bg-pen-soft'
      : m.kind === 'CELEBRATION'
        ? 'border-l-4 border-ok bg-ok-soft'
        : m.kind === 'FEEDBACK'
          ? 'border-l-4 border-ok/60 bg-paper'
          : m.kind === 'NOTICE'
            ? 'border border-dashed border-line bg-paper text-muted'
            : m.kind === 'FOLLOW_UP'
              ? 'border-2 border-ink/30 bg-ink-soft'
              : 'bg-paper';

  return (
    <div className="animate-rise flex justify-start">
      <div
        className={`max-w-[92%] rounded-2xl rounded-bl-sm px-3.5 py-2.5 leading-relaxed ${tone}`}
      >
        {hintLevel && (m.kind === 'HINT' || m.kind === 'EXPLANATION') && (
          <span className="mb-1 flex items-center gap-1 text-xs font-bold tracking-wide text-pen uppercase">
            <Lightbulb size={12} aria-hidden /> {t.hintLevel(hintLevel)}
          </span>
        )}
        <MathText text={m.content} />
        {nextId && (
          <button
            type="button"
            onClick={() => onOpenAttempt(nextId)}
            className="mt-2.5 flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-sm font-bold text-paper transition hover:brightness-110"
          >
            {t.startFollowUp} <ArrowRight size={15} aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}
