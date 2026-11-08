import { useMutation, useQueryClient } from '@tanstack/react-query';
import { LoginSchema, RegisterSchema } from '@tutor/shared';
import { ArrowRight, CheckCheck, MessageCircleQuestion, Repeat2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { LanguageToggle } from '../components/LanguageToggle';
import { ThemeToggle } from '../components/ThemeToggle';
import { Logo } from '../components/Logo';
import { Tex } from '../components/MathText';
import { useI18n } from '../i18n/i18n';
import { api, ApiError } from '../lib/api';

export function LoginPage() {
  const { t, locale } = useI18n();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState<string | null>(null);

  const onUser = (user: Awaited<ReturnType<typeof api.me>>) => {
    qc.setQueryData(['me'], user);
    navigate('/learn', { replace: true });
  };
  const onError = (e: unknown) => setError(e instanceof ApiError ? e.message : t.errorGeneric);

  const demo = useMutation({ mutationFn: () => api.demo(locale), onSuccess: onUser, onError });
  const submit = useMutation({
    mutationFn: async () => {
      if (mode === 'signin') {
        const input = LoginSchema.safeParse(form);
        if (!input.success) throw new ApiError(400, 'VALIDATION', input.error.issues[0]!.message);
        return api.login(input.data);
      }
      const input = RegisterSchema.safeParse({ ...form, locale });
      if (!input.success)
        throw new ApiError(
          400,
          'VALIDATION',
          input.error.issues.map((i) => `${String(i.path[0])}: ${i.message}`).join('; '),
        );
      return api.register(input.data);
    },
    onSuccess: onUser,
    onError,
  });

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    submit.mutate();
  };

  const field =
    'w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-text outline-none transition focus:border-ink focus:ring-2 focus:ring-ink-soft';

  return (
    <div className="graph-paper min-h-dvh">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-5 py-4">
        <Logo />
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <LanguageToggle />
        </div>
      </header>

      <main className="mx-auto grid max-w-6xl items-center gap-10 px-5 pb-16 pt-4 lg:grid-cols-[1.15fr_1fr] lg:pt-12">
        <section>
          <h1 className="font-serif text-4xl leading-tight font-bold text-text sm:text-5xl">
            {t.heroTitle}
          </h1>
          <p className="mt-4 max-w-xl text-lg text-muted">{t.tagline}</p>

          {/* A tiny worked example in "exercise book" style: the step, the red-pen mark, the question. */}
          <div className="notebook mt-8 max-w-xl rounded-xl border border-line py-4 pr-4 pl-14 shadow-sm">
            <div className="font-hand text-2xl text-ink">
              <Tex tex="3(x+4) = 2x+19" />
            </div>
            <div className="relative mt-1 font-hand text-2xl text-ink">
              <span className="absolute -left-10 top-0.5 font-bold text-pen" aria-hidden>
                ✗
              </span>
              <span className="underline decoration-pen decoration-wavy underline-offset-4">
                <Tex tex="3x+4 = 2x+19" />
              </span>
            </div>
            <p className="mt-3 border-l-2 border-pen pl-3 font-hand text-xl leading-snug text-pen">
              {locale === 'uk'
                ? 'Подивись на дужки: на що множиться кожен доданок усередині?'
                : 'Look at the brackets: what is every term inside multiplied by?'}
            </p>
          </div>

          <ul className="mt-8 space-y-3 text-text">
            {[
              [CheckCheck, t.feature1],
              [MessageCircleQuestion, t.feature2],
              [Repeat2, t.feature3],
            ].map(([Icon, text], i) => {
              const I = Icon as typeof CheckCheck;
              return (
                <li key={i} className="flex items-start gap-3">
                  <I className="mt-0.5 shrink-0 text-pen" size={20} aria-hidden />
                  <span>{text as string}</span>
                </li>
              );
            })}
          </ul>
        </section>

        <section className="rounded-2xl border border-line bg-surface p-6 shadow-sm sm:p-8">
          <button
            type="button"
            onClick={() => {
              setError(null);
              demo.mutate();
            }}
            disabled={demo.isPending}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-pen px-4 py-3.5 text-base font-bold text-paper transition hover:brightness-110 disabled:opacity-60"
          >
            {t.tryDemo} <ArrowRight size={18} aria-hidden />
          </button>
          <p className="mt-2 text-center text-sm text-muted">{t.tryDemoHint}</p>

          <div className="my-6 flex items-center gap-3 text-xs uppercase tracking-wider text-muted">
            <span className="h-px flex-1 bg-line" /> {t.or} <span className="h-px flex-1 bg-line" />
          </div>

          <div className="mb-4 flex rounded-lg bg-paper-2 p-1" role="tablist">
            {(['signin', 'signup'] as const).map((m) => (
              <button
                key={m}
                role="tab"
                type="button"
                aria-selected={mode === m}
                onClick={() => {
                  setMode(m);
                  setError(null);
                }}
                className={`flex-1 rounded-md py-2 text-sm font-bold transition ${
                  mode === m ? 'bg-surface text-text shadow-sm' : 'text-muted'
                }`}
              >
                {m === 'signin' ? t.signIn : t.signUp}
              </button>
            ))}
          </div>

          <form onSubmit={onSubmit} className="space-y-3" noValidate>
            {mode === 'signup' && (
              <label className="block">
                <span className="mb-1 block text-sm font-bold text-text">{t.name}</span>
                <input
                  className={field}
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  autoComplete="name"
                  required
                />
              </label>
            )}
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-text">{t.email}</span>
              <input
                className={field}
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                autoComplete="email"
                required
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-sm font-bold text-text">{t.password}</span>
              <input
                className={field}
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                minLength={mode === 'signup' ? 8 : undefined}
                required
              />
              {mode === 'signup' && (
                <span className="mt-1 block text-xs text-muted">{t.passwordHint}</span>
              )}
            </label>
            {error && (
              <p role="alert" className="rounded-md bg-pen-soft px-3 py-2 text-sm text-pen">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={submit.isPending}
              className="w-full rounded-lg border border-ink px-4 py-2.5 font-bold text-ink transition hover:bg-ink-soft disabled:opacity-60"
            >
              {mode === 'signin' ? t.signIn : t.signUp}
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
