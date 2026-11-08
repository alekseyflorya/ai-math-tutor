import type { ProblemView } from '@tutor/shared';
import { Check, Sparkles, Star } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../i18n/i18n';
import { ApiError } from '../lib/api';
import { useProblems, useStartAttempt } from '../lib/hooks';
import { Tex } from './MathText';

export function ProblemSidebar() {
  const { t } = useI18n();
  const { data: problems, isLoading } = useProblems();
  const start = useStartAttempt();
  const [custom, setCustom] = useState('');

  const featured = problems?.find((p) => p.featured);
  const rest = problems?.filter((p) => !p.featured) ?? [];

  const onCustom = (e: FormEvent) => {
    e.preventDefault();
    if (custom.trim()) start.mutate({ equation: custom.trim() });
  };

  return (
    <div className="space-y-5 lg:sticky lg:top-19">
      {featured && (
        <button
          type="button"
          onClick={() => start.mutate({ problemId: featured.id })}
          disabled={start.isPending}
          className="notebook group w-full rounded-xl border-2 border-pen/40 py-3 pr-3 pl-14 text-left shadow-sm transition hover:border-pen disabled:opacity-60"
        >
          <span className="flex items-center gap-1.5 text-xs font-bold tracking-wide text-pen uppercase">
            <Star size={13} aria-hidden /> {t.testScenario}
          </span>
          <span className="mt-1 block text-xl whitespace-nowrap text-ink">
            <Tex tex={featured.latex} />
          </span>
          {featured.solved && (
            <span className="mt-1 flex items-center gap-1 text-xs font-bold text-ok">
              <Check size={13} aria-hidden /> {t.solved}
            </span>
          )}
        </button>
      )}

      <div>
        <h2 className="mb-2 px-1 font-serif text-sm font-bold text-muted">{t.curriculum}</h2>
        <ol className="space-y-1">
          {isLoading &&
            Array.from({ length: 6 }, (_, i) => (
              <li key={i} className="h-14 animate-pulse rounded-lg bg-paper-2" />
            ))}
          {rest.map((p) => (
            <ProblemItem
              key={p.id}
              problem={p}
              onOpen={() => start.mutate({ problemId: p.id })}
              disabled={start.isPending}
            />
          ))}
        </ol>
      </div>

      <form onSubmit={onCustom} className="rounded-xl border border-line bg-surface p-3">
        <label htmlFor="custom-eq" className="mb-1.5 block text-sm font-bold text-text">
          {t.ownEquation}
        </label>
        <div className="flex gap-2">
          <input
            id="custom-eq"
            value={custom}
            onChange={(e) => setCustom(e.target.value)}
            placeholder={t.ownEquationPlaceholder}
            className="min-w-0 flex-1 rounded-md border border-line bg-paper px-2.5 py-1.5 font-mono text-sm outline-none focus:border-ink"
            maxLength={120}
          />
          <button
            type="submit"
            disabled={start.isPending || !custom.trim()}
            className="rounded-md bg-ink px-3 text-sm font-bold text-paper disabled:opacity-50"
          >
            {t.start}
          </button>
        </div>
        {start.error && (
          <p role="alert" className="mt-2 text-xs text-pen">
            {start.error instanceof ApiError ? start.error.message : t.errorGeneric}
          </p>
        )}
      </form>
    </div>
  );
}

function ProblemItem({
  problem,
  onOpen,
  disabled,
}: {
  problem: ProblemView;
  onOpen: () => void;
  disabled: boolean;
}) {
  const { t } = useI18n();
  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        disabled={disabled}
        className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition hover:bg-surface disabled:opacity-60 ${
          problem.recommended ? 'bg-surface ring-1 ring-ink/30' : ''
        }`}
      >
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-bold ${
            problem.solved ? 'bg-ok-soft text-ok' : 'bg-paper-2 text-muted'
          }`}
          aria-label={problem.solved ? t.solved : undefined}
        >
          {problem.solved ? <Check size={13} /> : problem.order + 1}
        </span>
        <span className="min-w-0 flex-1">
          {problem.recommended && (
            <span className="mb-0.5 flex w-fit items-center gap-0.5 rounded bg-ink-soft px-1.5 py-0.5 text-[10px] font-bold text-ink uppercase">
              <Sparkles size={10} aria-hidden /> {t.recommended}
            </span>
          )}
          <span className="block truncate text-sm font-bold text-text">{problem.title}</span>
          <span className="block overflow-hidden text-[13px] whitespace-nowrap text-muted">
            <Tex tex={problem.latex} />
          </span>
        </span>
        <span
          className="flex shrink-0 gap-0.5"
          aria-label={`${t.difficulty} ${problem.difficulty}/5`}
        >
          {Array.from({ length: 5 }, (_, i) => (
            <span
              key={i}
              className={`size-1.5 rounded-full ${i < problem.difficulty ? 'bg-pen/70' : 'bg-line'}`}
            />
          ))}
        </span>
      </button>
    </li>
  );
}
