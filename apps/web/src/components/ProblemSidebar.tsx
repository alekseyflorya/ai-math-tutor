import { useQuery } from '@tanstack/react-query';
import { parseEquation, type ProblemView } from '@tutor/shared';
import { Check, Circle, Sparkles, Star } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useI18n } from '../i18n/i18n';
import { api, ApiError } from '../lib/api';
import { useCustomAttempts, useProblems, useStartAttempt } from '../lib/hooks';
import type { AttemptSummary } from '../lib/api';
import { Tex } from './MathText';

export function ProblemSidebar() {
  const { t } = useI18n();
  const { data: problems, isLoading } = useProblems();
  const start = useStartAttempt();
  const [custom, setCustom] = useState('');
  const { data: customAttempts } = useCustomAttempts();
  // The open attempt is already in the query cache (the workspace loaded it), so no extra request.
  const { attemptId } = useParams();
  const { data: activeAttempt } = useQuery({
    queryKey: ['attempt', attemptId],
    queryFn: () => api.attempt(attemptId!),
    enabled: Boolean(attemptId),
  });
  const activeProblemId = attemptId ? (activeAttempt?.problemId ?? null) : null;

  const featured = problems?.find((p) => p.featured);
  const rest = problems?.filter((p) => !p.featured) ?? [];

  const onCustom = (e: FormEvent) => {
    e.preventDefault();
    if (custom.trim())
      start.mutate({ equation: custom.trim() }, { onSuccess: () => setCustom('') });
  };

  return (
    <div className="space-y-5 lg:sticky lg:top-19 lg:-ml-2.5 lg:max-h-[calc(100dvh-6rem)] lg:overflow-y-auto lg:pr-1 lg:pb-2 lg:pl-2.5">
      {featured && (
        <button
          type="button"
          onClick={() => start.mutate({ problemId: featured.id })}
          disabled={start.isPending}
          aria-current={activeProblemId === featured.id ? 'true' : undefined}
          className={`notebook group w-full rounded-xl border-2 py-3 pr-3 pl-14 text-left shadow-sm transition hover:border-pen disabled:opacity-60 ${
            activeProblemId === featured.id ? 'border-pen ring-2 ring-pen/30' : 'border-pen/40'
          }`}
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
              active={p.id === activeProblemId}
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

      {customAttempts && customAttempts.length > 0 && (
        <div>
          <h2 className="mb-2 px-1 font-serif text-sm font-bold text-muted">{t.myEquations}</h2>
          <ul className="space-y-1">
            {customAttempts.slice(0, 10).map((a) => (
              <CustomItem key={a.id} attempt={a} active={a.id === attemptId} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function ProblemItem({
  problem,
  active,
  onOpen,
  disabled,
}: {
  problem: ProblemView;
  active: boolean;
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
        aria-current={active ? 'true' : undefined}
        className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition disabled:opacity-60 ${
          active
            ? 'bg-ink-soft ring-2 ring-ink before:absolute before:inset-y-2 before:-left-1.5 before:w-1 before:rounded-full before:bg-ink'
            : problem.recommended
              ? 'border border-dashed border-ink/40 hover:bg-surface'
              : 'hover:bg-surface'
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

function CustomItem({ attempt, active }: { attempt: AttemptSummary; active: boolean }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const latex = useMemo(() => {
    try {
      return parseEquation(attempt.equation).latex;
    } catch {
      return null;
    }
  }, [attempt.equation]);
  const solved = attempt.status === 'SOLVED';
  return (
    <li>
      <button
        type="button"
        onClick={() => navigate(`/learn/${attempt.id}`)}
        aria-current={active ? 'true' : undefined}
        className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition ${
          active
            ? 'bg-ink-soft ring-2 ring-ink before:absolute before:inset-y-2 before:-left-1.5 before:w-1 before:rounded-full before:bg-ink'
            : 'hover:bg-surface'
        }`}
      >
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full ${
            solved ? 'bg-ok-soft text-ok' : 'bg-paper-2 text-muted'
          }`}
          aria-label={solved ? t.statusSolved : t.statusInProgress}
          title={solved ? t.statusSolved : t.statusInProgress}
        >
          {solved ? <Check size={13} /> : <Circle size={9} />}
        </span>
        <span className="block min-w-0 flex-1 overflow-hidden text-[13px] whitespace-nowrap text-text">
          {latex ? <Tex tex={latex} /> : <span className="font-mono">{attempt.equation}</span>}
        </span>
      </button>
    </li>
  );
}
