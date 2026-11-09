import { useQuery } from '@tanstack/react-query';
import type { ProgressView } from '@tutor/shared';
import { CheckCircle2, Circle, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router';
import { ERROR_LABELS, SKILL_LABELS } from '../i18n/dict';
import { useI18n } from '../i18n/i18n';
import { api } from '../lib/api';
import { MathText } from '../components/MathText';

export function ProgressPage() {
  const { t, locale } = useI18n();
  const { data, isLoading } = useQuery({ queryKey: ['progress'], queryFn: api.progress });

  if (isLoading || !data) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="h-24 animate-pulse rounded-xl bg-paper-2" />
        ))}
      </div>
    );
  }

  const { totals, checks } = data;
  const finished = checks.done + checks.skipped;
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-bold text-text">{t.progress}</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label={t.statSolved}
          value={String(totals.solved)}
          sub={`${t.total}: ${totals.attempts}`}
        />
        <Stat
          label={t.statAccuracy}
          value={`${totals.accuracy}%`}
          sub={`${totals.correctSteps}/${totals.steps}`}
        />
        <Stat label={t.statCorrected} value={`${totals.correctedMistakes}/${totals.mistakes}`} />
        <Stat label={t.statVerified} value={String(totals.verifiedMistakes)} accent />
        <Stat
          label={t.statChecked}
          value={finished ? `${Math.round((checks.done / finished) * 100)}%` : '—'}
          sub={finished ? `${checks.done}/${finished}` : undefined}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card title={t.skills}>
          <ul className="space-y-3.5">
            {data.skills.map((s) => (
              <SkillBar
                key={s.skill}
                label={SKILL_LABELS[locale][s.skill]}
                mastery={s.mastery}
                attempts={s.attempts}
              />
            ))}
          </ul>
          <p className="mt-4 text-xs leading-relaxed text-muted">{t.howMeasured}</p>
        </Card>

        <Card title={t.activity}>
          <Activity data={data} />
        </Card>

        <Card title={t.mistakesByType}>
          {data.mistakesByType.length === 0 ? (
            <p className="text-sm text-muted">{t.noData}</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="pb-2 font-bold" />
                  <th className="pb-2 text-right font-bold">{t.total}</th>
                  <th className="pb-2 text-right font-bold">{t.corrected}</th>
                  <th className="pb-2 text-right font-bold">{t.verified}</th>
                </tr>
              </thead>
              <tbody>
                {data.mistakesByType.map((m) => (
                  <tr key={m.errorType} className="border-t border-line">
                    <td className="py-2 font-bold text-text">
                      {ERROR_LABELS[locale][m.errorType]}
                    </td>
                    <td className="py-2 text-right tabular-nums">{m.total}</td>
                    <td className="py-2 text-right tabular-nums text-ink">{m.corrected}</td>
                    <td className="py-2 text-right tabular-nums text-ok">{m.verified}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card title={t.recentMistakes}>
          {data.recentMistakes.length === 0 ? (
            <p className="text-sm text-muted">{t.noData}</p>
          ) : (
            <ul className="space-y-3">
              {data.recentMistakes.map((m) => (
                <li key={m.id} className="flex gap-3">
                  {m.verified ? (
                    <ShieldCheck
                      className="mt-0.5 shrink-0 text-ok"
                      size={18}
                      aria-label={t.verified}
                    />
                  ) : m.corrected ? (
                    <CheckCircle2
                      className="mt-0.5 shrink-0 text-ink"
                      size={18}
                      aria-label={t.corrected}
                    />
                  ) : (
                    <Circle className="mt-0.5 shrink-0 text-pen" size={18} />
                  )}
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-text">
                      {ERROR_LABELS[locale][m.errorType]}{' '}
                      <code className="ml-1 rounded bg-pen-soft px-1 text-xs font-normal text-pen">
                        {m.stepInput}
                      </code>
                    </p>
                    <p className="text-sm text-muted">
                      <MathText text={m.description} />
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card title={t.recent}>
        <ul className="divide-y divide-line">
          {data.recentAttempts.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-bold text-text">
                  {a.title}
                  {a.isFollowUp && (
                    <span className="ml-2 rounded bg-ink-soft px-1.5 py-0.5 text-[10px] text-ink uppercase">
                      {t.followUp}
                    </span>
                  )}
                </p>
                <p className="truncate font-mono text-xs text-muted">{a.equation}</p>
              </div>
              <div className="flex shrink-0 items-center gap-3">
                <span
                  className={`text-xs font-bold ${a.status === 'SOLVED' ? 'text-ok' : 'text-muted'}`}
                >
                  {a.status === 'SOLVED' ? t.statusSolved : t.statusInProgress}
                </span>
                <Link to={`/learn/${a.id}`} className="text-sm font-bold text-ink">
                  {t.open}
                </Link>
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}

function Stat({
  label,
  value,
  sub,
  accent,
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border bg-surface p-4 ${accent ? 'border-ok/40' : 'border-line'}`}>
      <p className="text-xs font-bold tracking-wide text-muted uppercase">{label}</p>
      <p
        className={`mt-1 font-serif text-3xl font-bold tabular-nums ${accent ? 'text-ok' : 'text-text'}`}
      >
        {value}
      </p>
      {sub && <p className="text-xs text-muted tabular-nums">{sub}</p>}
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <h2 className="mb-4 font-serif text-lg font-bold text-text">{title}</h2>
      {children}
    </section>
  );
}

function SkillBar({
  label,
  mastery,
  attempts,
}: {
  label: string;
  mastery: number;
  attempts: number;
}) {
  const { t } = useI18n();
  const pct = Math.round(mastery * 100);
  const color = attempts === 0 ? 'bg-line' : pct >= 70 ? 'bg-ok' : pct >= 45 ? 'bg-ink' : 'bg-pen';
  return (
    <li>
      <div className="mb-1 flex justify-between text-sm">
        <span className="font-bold text-text">{label}</span>
        <span className="tabular-nums text-muted">
          {attempts === 0 ? '—' : `${pct}% ${t.mastery}`}
        </span>
      </div>
      <div
        className="h-2 overflow-hidden rounded-full bg-paper-2"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={`h-full rounded-full transition-all ${color}`}
          style={{ width: `${attempts === 0 ? 0 : pct}%` }}
        />
      </div>
    </li>
  );
}

function Activity({ data }: { data: ProgressView }) {
  const { t, locale } = useI18n();
  const max = Math.max(1, ...data.activity.map((d) => d.steps));
  return (
    <div>
      <div className="flex h-36 items-end gap-1.5">
        {data.activity.map((d) => (
          <div key={d.date} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className={`w-full rounded-t ${d.solved > 0 ? 'bg-ok' : 'bg-ink/40'}`}
              style={{ height: `${d.steps === 0 ? 2 : Math.max(6, (d.steps / max) * 100)}%` }}
              title={`${d.date}: ${d.steps} ${t.stepsCount}, ${d.solved} ${t.solvedCount}`}
            />
          </div>
        ))}
      </div>
      <div className="mt-2 flex justify-between text-xs text-muted">
        <span>
          {new Date(data.activity[0]!.date).toLocaleDateString(
            locale === 'uk' ? 'uk-UA' : 'en-GB',
            { day: 'numeric', month: 'short' },
          )}
        </span>
        <span>
          {new Date(data.activity.at(-1)!.date).toLocaleDateString(
            locale === 'uk' ? 'uk-UA' : 'en-GB',
            { day: 'numeric', month: 'short' },
          )}
        </span>
      </div>
      <div className="mt-3 flex gap-4 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-ink/40" /> {t.stepsCount}
        </span>
        <span className="flex items-center gap-1.5">
          <span className="size-2.5 rounded-sm bg-ok" /> {t.solvedCount}
        </span>
      </div>
    </div>
  );
}
