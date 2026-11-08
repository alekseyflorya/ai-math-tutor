import { ArrowRight } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { useProblems, useStartAttempt } from '../lib/hooks';
import { Tex } from './MathText';

export function WelcomePanel() {
  const { t } = useI18n();
  const { data: problems } = useProblems();
  const start = useStartAttempt();
  const featured = problems?.find((p) => p.featured);

  return (
    <div className="notebook flex min-h-[28rem] flex-col justify-center rounded-2xl border border-line py-10 pr-8 pl-16 shadow-sm">
      <h1 className="font-serif text-3xl font-bold text-text">{t.pickProblem}</h1>
      <p className="mt-3 max-w-lg text-muted">{t.pickProblemHint}</p>
      {featured && (
        <button
          type="button"
          onClick={() => start.mutate({ problemId: featured.id })}
          disabled={start.isPending}
          className="mt-8 inline-flex w-fit items-center gap-3 rounded-lg bg-pen px-5 py-3 font-bold text-white transition hover:brightness-110 disabled:opacity-60"
        >
          {t.startScenario}
          <span className="rounded bg-white/15 px-2 py-0.5">
            <Tex tex={featured.latex} />
          </span>
          <ArrowRight size={18} aria-hidden />
        </button>
      )}
    </div>
  );
}
