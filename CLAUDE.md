# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

AI math tutor prototype (test assignment). A student solves linear equations step by step;
the tutor detects the exact wrong transformation, guides with a 3-level hint ladder, and
verifies understanding with an LLM-generated follow-up problem that the math engine validates.

## Layout

- `packages/shared` — **math engine** (safe parser → exact `a·x + b` form, solution-set step
  check, input normalisation, `judgeLine`: the verdict on a sent line) and **API contracts**
  (zod schemas + view types). Used by both apps.
  Must be built (`pnpm --filter @tutor/shared build`) before the api/web typecheck or run.
- `apps/api` — NestJS 11 + Drizzle/Postgres.
  - Feature modules: `TutorModule`, `ProblemsModule`, `ProgressModule`; `AppModule` only assembles them.
  - `src/tutor/tutor.service.ts` — the state machine (SOLVING / REMEDIATION / CHECKING / SOLVED /
    follow-up). CHECKING: the answer is reached and checked by substitution
    (`checkSubstitution` in `@tutor/shared`); a slip there is an ARITHMETIC mistake of phase
    CHECK (counts for skills, not for follow-ups or their verification).
    A turn reads, calls the model, then applies all its writes in ONE transaction (queued in
    `turn.writes`). Next to it: `attempt.repository.ts` (every query), `tutor-context.builder.ts`
    (what the model is told), `attempt-lock.ts` (409 BUSY: a lease in the attempt row),
    `message-meta.ts` (typed meta constructors), `follow-up.service.ts`, `notices.ts`,
    `check-hint-guard.ts` (hints on a slip in the check must not state a value the student has to
    compute: one retry, then a fixed hint; the eval uses the same detector).
  - `src/auth/demo-cleanup.service.ts` — daily deletion of demo accounts older than 7 days.
  - `src/llm/prompts.ts` — all pedagogy and prompts. `src/llm/structured-call.ts` — timeout, zod
    validation, one self-correcting retry (pure; shared with the eval). `src/llm/llm.service.ts` — quotas + logging around it.
  - `evals/` — labelled wrong-step cases, message rule checks, metrics, markdown reports (`evals/reports/`).
  - `src/llm/providers/*` — Gemini, Anthropic, Mock (tests only; refused in production). Gemini
    takes a model list per purpose (`GEMINI_MODEL_DIAGNOSIS` for diagnose/hint, `GEMINI_MODEL` for
    the rest; write model ids explicitly, e.g. `gemini-3.6-flash`) and skips a model after a 429
    until the time the API names (one cooldown per model, shared by all purposes).
  - `src/db/schema.ts` — Drizzle schema; migrations in `drizzle/` (applied on boot).
- `apps/web` — React 19 + Vite + Tailwind 4 + TanStack Query + KaTeX. EN/UK in `src/i18n/dict.ts`.
- `deploy/` — Caddyfile, prod compose, VPS bootstrap script. `.github/workflows/ci.yml` — CI/CD.

## Commands

```bash
pnpm install
pnpm db:up                                   # Postgres (tutor + tutor_test) on :5433
pnpm dev                                     # shared (watch) + api :3100 + web :5173
pnpm typecheck && pnpm lint && pnpm test && pnpm format:check   # what CI runs
pnpm --filter @tutor/api db:generate         # after changing src/db/schema.ts → new SQL migration
pnpm smoke:llm                               # real-model check of the scenario prompts (uses .env)
pnpm eval --model gemini-3.5-flash           # AI-quality eval → apps/api/evals/reports (uses .env, not in CI)
docker compose up --build                    # full stack on http://localhost:8080
```

## Rules

- **Correctness is decided by the math engine, never by the LLM.** The LLM only diagnoses why
  and writes teaching messages. Do not add LLM-based grading.
- The verdict on a line comes from `judgeLine` (`@tutor/shared`): the server acts on it and the
  browser shows it before the tutor answers. Change routing/verdict rules there, not in
  `TutorService` or the web app.
- Schemas for model output put `message` last (the model decides first); the Gemini provider adds
  `propertyOrdering` from the key order.
- The tutor never reveals the final answer, and neither does the API: nothing the root can be read
  from (e.g. `solutionLatex`) before the student reaches it.
- Migrations: a new enum value must not be used in the same migration batch that adds it. Hint level 3 shows the corrected _current_ step only;
  when that step would be the answer (`x = number`), it names the operation and the line to apply it
  to ("divide both sides of 4x = 20 by 4") and leaves the result to the student.
- Every LLM call goes through `LlmService.generate` with a zod schema (quotas + logging + retry).
- After changing prompts, schemas or the model, run `pnpm eval` and compare with the baseline report.
- Student text is data: always wrap it with `studentInput()` in prompts.
- API contracts live in `@tutor/shared`; change the schema there, not ad hoc in a controller.
  Message `meta` is typed per kind there (`MESSAGE_META`); write it with the constructors in
  `message-meta.ts`.
- No database writes before the model call in a turn: queue them (`later`, `say`, `update`) so
  they land in the turn's single transaction.
- The API may run as several instances: no in-memory state that must be shared (locks, jobs).
- Schema changes → `db:generate`, commit the SQL file. Never edit applied migrations.
- Keep UI copy in both `en` and `uk` dictionaries.
- Keep the e2e test (`apps/api/test/tutor.e2e-spec.ts`) green; extend it when the state machine changes.
- ESLint (type-aware: no floating promises, react-hooks) and Prettier (single quotes, width 100). No CORS: the web app is same-origin by design.
- Never commit `.env` or keys.
- Commits and PRs carry no AI attribution (no `Co-Authored-By`, no “Generated with”): set in `.claude/settings.json` → `attribution`.
