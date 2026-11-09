import type { AttemptView, StepView } from '@tutor/shared';
import { useI18n } from '../i18n/i18n';
import { Tex } from './MathText';

/**
 * The student's solution as it would look in a squared exercise book, with red-pen marks; the
 * check by substitution follows under its own heading, as in class.
 */
export function Notebook({ attempt }: { attempt: AttemptView }) {
  const { t } = useI18n();
  const solution = attempt.steps.filter((s) => s.phase === 'SOLUTION');
  const check = attempt.steps.filter((s) => s.phase === 'CHECK');
  const showCheck = attempt.mode === 'CHECKING' || check.length > 0 || attempt.check !== null;
  return (
    <div
      className="notebook rounded-2xl border border-line py-3 pr-4 pl-14 shadow-sm"
      aria-label={t.notebook}
    >
      <ol>
        <li className="flex min-h-10 items-center text-xl text-ink">
          <Tex tex={attempt.latex} className="min-w-0 overflow-x-auto" />
        </li>
        {solution.map((s) => (
          <Line key={s.id} step={s} />
        ))}
      </ol>
      {attempt.steps.length === 0 && (
        <p className="mt-1 font-hand text-xl text-muted">{t.noSteps}</p>
      )}
      {showCheck && (
        <section aria-label={t.checkBlock} className="mt-2">
          <h3 className="flex min-h-10 items-center gap-3 font-hand text-2xl font-bold text-ink">
            {t.checkBlock}:
            {attempt.check === 'DONE' && <span className="text-lg text-ok">{t.checkDone}</span>}
            {attempt.check === 'SKIPPED' && (
              <span className="text-lg text-muted">{t.checkSkipped}</span>
            )}
          </h3>
          <ol>
            {check.map((s) => (
              <Line key={s.id} step={s} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

function Line({ step: s }: { step: StepView }) {
  const { t } = useI18n();
  return (
    <li className="animate-rise relative flex min-h-10 items-center text-xl text-ink">
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
  );
}
