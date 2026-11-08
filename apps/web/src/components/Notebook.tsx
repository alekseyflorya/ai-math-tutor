import type { AttemptView } from '@tutor/shared';
import { useI18n } from '../i18n/i18n';
import { Tex } from './MathText';

/** The student's solution as it would look in a squared exercise book, with red-pen marks. */
export function Notebook({ attempt }: { attempt: AttemptView }) {
  const { t } = useI18n();
  return (
    <div
      className="notebook rounded-2xl border border-line py-3 pr-4 pl-14 shadow-sm"
      aria-label={t.notebook}
    >
      <ol>
        <li className="flex min-h-10 items-center text-xl text-ink">
          <Tex tex={attempt.latex} className="min-w-0 overflow-x-auto" />
        </li>
        {attempt.steps.map((s) => (
          <li
            key={s.id}
            className="animate-rise relative flex min-h-10 items-center text-xl text-ink"
          >
            <span
              className={`absolute -left-10 w-6 text-center font-hand text-2xl font-bold ${s.isCorrect ? 'text-ok' : 'text-pen'}`}
              aria-label={s.isCorrect ? t.correct : t.incorrect}
            >
              {s.isCorrect ? '✓' : '✗'}
            </span>
            <span
              className={`min-w-0 overflow-x-auto py-1.5 ${s.isCorrect ? '' : 'underline decoration-pen decoration-wavy decoration-2 underline-offset-[6px] opacity-80'}`}
            >
              <Tex tex={s.latex} />
            </span>
          </li>
        ))}
      </ol>
      {attempt.steps.length === 0 && (
        <p className="mt-1 font-hand text-xl text-muted">{t.noSteps}</p>
      )}
    </div>
  );
}
