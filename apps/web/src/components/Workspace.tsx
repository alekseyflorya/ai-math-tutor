import { useMutation } from '@tanstack/react-query';
import { parseEquation, type AttemptView, type ErrorType, type MessageView } from '@tutor/shared';
import { ArrowLeft, ArrowRight, PartyPopper, RotateCcw, ShieldCheck, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ERROR_LABELS } from '../i18n/dict';
import { useI18n } from '../i18n/i18n';
import { api, ApiError } from '../lib/api';
import { useAttempt, useAttemptUpdate, useStartAttempt } from '../lib/hooks';
import { Chat } from './Chat';
import { Composer } from './Composer';
import { Tex } from './MathText';
import { Notebook } from './Notebook';

export function Workspace({ attemptId }: { attemptId: string }) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { data: attempt, isLoading, error } = useAttempt(attemptId);
  const applyUpdate = useAttemptUpdate(attemptId);
  const [pending, setPending] = useState<MessageView | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);

  const turn = useMutation({
    mutationFn: (arg: { kind: 'send'; text: string } | { kind: 'hint' }) =>
      arg.kind === 'send' ? api.send(attemptId, arg.text) : api.hint(attemptId),
    onMutate: (arg) => {
      setSendError(null);
      // Show the student's line immediately; the tutor's reply follows.
      if (arg.kind === 'send') {
        setPending({
          id: 'pending',
          role: 'STUDENT',
          kind: 'CHAT',
          content: arg.text,
          createdAt: new Date().toISOString(),
          meta: null,
        });
      }
    },
    onSuccess: (a) => applyUpdate(a),
    onError: (e) => setSendError(e instanceof ApiError ? e.message : t.errorGeneric),
    onSettled: () => setPending(null),
  });

  if (isLoading) return <div className="h-[32rem] animate-pulse rounded-2xl bg-paper-2" />;
  if (error || !attempt) {
    return (
      <div className="rounded-xl border border-line bg-surface p-6">
        <p className="text-pen">{error instanceof ApiError ? error.message : t.errorGeneric}</p>
        <Link to="/learn" className="mt-3 inline-block font-bold text-ink">
          {t.newProblem}
        </Link>
      </div>
    );
  }

  const solved = attempt.status === 'SOLVED';
  const aiOffline = attempt.messages.at(-1)?.meta?.aiUnavailable;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="min-w-0 space-y-4">
        <ProblemHeader attempt={attempt} />
        <Notebook attempt={attempt} />
        {solved && <SolvedCard attempt={attempt} onNext={(id) => navigate(`/learn/${id}`)} />}
      </div>

      <div className="flex min-h-[26rem] flex-col rounded-2xl border border-line bg-surface shadow-sm xl:sticky xl:top-19 xl:h-[calc(100dvh-6.5rem)]">
        <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
          <h2 className="font-serif font-bold text-text">{t.tutor}</h2>
          {attempt.mode === 'REMEDIATION' && attempt.hintLevel > 0 && (
            <span className="rounded-full bg-pen-soft px-2.5 py-0.5 text-xs font-bold text-pen">
              {t.hintLevel(attempt.hintLevel)}
            </span>
          )}
        </div>
        <Chat messages={attempt.messages} pending={pending} thinking={turn.isPending} />
        {/* Phones: the page scrolls, the input stays pinned to the bottom of the screen. */}
        <div className="sticky bottom-0 z-10 rounded-b-2xl bg-surface pb-[env(safe-area-inset-bottom)] shadow-[0_-8px_16px_-12px_rgb(0_0_0/0.25)] xl:static xl:pb-0 xl:shadow-none">
          {aiOffline ? (
            <p className="border-t border-line bg-paper-2 px-4 py-1.5 text-xs text-muted">
              {t.aiOffline}
            </p>
          ) : null}
          {sendError && (
            <p role="alert" className="border-t border-line bg-pen-soft px-4 py-2 text-sm text-pen">
              {sendError}
            </p>
          )}
          {solved ? (
            <div className="border-t border-line p-3 text-center">
              <Link to="/learn" className="text-sm font-bold text-ink">
                {t.newProblem}
              </Link>
            </div>
          ) : (
            <Composer
              busy={turn.isPending}
              variable={attempt.variable}
              onSend={(text) => turn.mutate({ kind: 'send', text })}
              onHint={() => turn.mutate({ kind: 'hint' })}
              currentLatex={attempt.currentLatex}
            />
          )}
        </div>
      </div>
      <span className="sr-only" aria-live="polite">
        {turn.isPending ? t.thinking : ''}
      </span>
    </div>
  );
}

function ProblemHeader({ attempt }: { attempt: AttemptView }) {
  const { t, locale } = useI18n();
  return (
    <div className="rounded-2xl border border-line bg-surface px-5 py-4 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-bold text-muted">{attempt.title}</span>
        {attempt.isFollowUp && attempt.targetErrorType && (
          <span className="inline-flex items-center gap-1 rounded-full bg-ink-soft px-2 py-0.5 text-xs font-bold text-ink">
            <Target size={12} aria-hidden /> {t.followUpFor}{' '}
            {ERROR_LABELS[locale][attempt.targetErrorType]}
          </span>
        )}
      </div>
      <div className="mt-1 flex items-baseline gap-3">
        <span className="text-sm text-muted">{t.problemLabel}:</span>
        <span className="text-2xl text-text">
          <Tex tex={attempt.latex} />
        </span>
      </div>
    </div>
  );
}

function SolvedCard({ attempt, onNext }: { attempt: AttemptView; onNext: (id: string) => void }) {
  const { t, locale } = useI18n();
  const start = useStartAttempt();
  // The practice problem and the mistake it targets come from the tutor's FOLLOW_UP message.
  const followUp = attempt.messages.find((m) => m.kind === 'FOLLOW_UP')?.meta;
  const followUpLatex = useMemo(() => {
    const eq = typeof followUp?.equation === 'string' ? followUp.equation : null;
    if (!eq) return null;
    try {
      return parseEquation(eq).latex;
    } catch {
      return null;
    }
  }, [followUp]);
  const errorType = followUp?.errorType as ErrorType | undefined;
  const practiceDone = attempt.nextAttemptStatus === 'SOLVED';
  const linkButton =
    'inline-flex items-center gap-1.5 rounded-lg border border-ink/30 px-3 py-1.5 text-sm font-bold text-ink transition hover:bg-ink-soft';

  return (
    <div className="animate-rise rounded-2xl border-2 border-ok/40 bg-ok-soft px-5 py-4">
      <p className="flex items-center gap-2 font-serif text-lg font-bold text-ok">
        <PartyPopper size={20} aria-hidden /> {t.solvedBanner}
      </p>

      {/* This WAS a practice problem: confirm the result and lead back. */}
      {attempt.parentAttemptId && (
        <div className="mt-3 space-y-3">
          {attempt.understandingVerified && (
            <p className="flex items-start gap-2 text-sm font-bold text-ok">
              <ShieldCheck size={18} className="shrink-0" aria-hidden /> {t.understandingConfirmed}
            </p>
          )}
          <button
            type="button"
            onClick={() => onNext(attempt.parentAttemptId!)}
            className={linkButton}
          >
            <ArrowLeft size={15} aria-hidden /> {t.backToParent}
          </button>
        </div>
      )}

      {/* This problem HAS a practice problem: offer it, or report how it went. */}
      {attempt.nextAttemptId && practiceDone && (
        <div className="mt-3 space-y-3">
          <p className="flex items-start gap-2 text-sm font-bold text-ok">
            <ShieldCheck size={18} className="shrink-0" aria-hidden />
            {attempt.understandingVerified ? t.lessonConsolidated : t.practiceRepeated}
          </p>
          <button
            type="button"
            onClick={() => onNext(attempt.nextAttemptId!)}
            className={linkButton}
          >
            {t.openPractice} <ArrowRight size={15} aria-hidden />
          </button>
        </div>
      )}
      {attempt.nextAttemptId && !practiceDone && errorType && (
        <div className="mt-3 rounded-xl border border-ink/20 bg-surface px-4 py-3">
          <p className="text-sm text-text">{t.followUpIntro(ERROR_LABELS[locale][errorType])}</p>
          {followUpLatex && (
            <p className="mt-1.5 text-xl text-ink">
              <Tex tex={followUpLatex} />
            </p>
          )}
          <button
            type="button"
            onClick={() => onNext(attempt.nextAttemptId!)}
            className="mt-3 inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 font-bold text-paper transition hover:brightness-110"
          >
            {t.startFollowUp} <ArrowRight size={16} aria-hidden />
          </button>
        </div>
      )}

      {attempt.problemId && (
        <button
          type="button"
          onClick={() => start.mutate({ problemId: attempt.problemId!, restart: true })}
          disabled={start.isPending}
          className="mt-3 inline-flex items-center gap-2 rounded-lg border border-ok/50 px-4 py-2 text-sm font-bold text-ok transition hover:bg-ok-soft disabled:opacity-60"
        >
          <RotateCcw size={15} aria-hidden /> {t.solveAgain}
        </button>
      )}
    </div>
  );
}
