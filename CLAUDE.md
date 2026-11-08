# CLAUDE.md

Guidance for Claude Code working in this repository.

## What this is

AI math tutor prototype (test assignment). A student solves linear equations step by step;
the tutor detects the exact wrong transformation, guides with a 3-level hint ladder, and
verifies understanding with an LLM-generated follow-up problem that the math engine validates.

## Layout

- `packages/shared` — **math engine** (safe parser → exact `a·x + b` form, solution-set step
  check, input normalisation) and **API contracts** (zod schemas + view types). Used by both apps.
  Must be built (`pnpm --filter @tutor/shared build`) before the api/web typecheck or run.
- `apps/api` — NestJS 11 + Drizzle/Postgres.
  - `src/tutor/tutor.service.ts` — the state machine (SOLVING / REMEDIATION / SOLVED / follow-up).
    Helpers next to it: `tutor-context.builder.ts` (what the model is told), `attempt-lock.ts`
    (409 BUSY on overlapping turns), `follow-up.service.ts` (generate + validate practice), `notices.ts`.
  - `src/llm/prompts.ts` — all pedagogy and prompts. `src/llm/llm.service.ts` — quotas, timeout, zod validation, retry.
  - `src/llm/providers/*` — Gemini, Anthropic, Mock (tests only; refused in production).
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
docker compose up --build                    # full stack on http://localhost:8080
```

## Rules

- **Correctness is decided by the math engine, never by the LLM.** The LLM only diagnoses why
  and writes teaching messages. Do not add LLM-based grading.
- The tutor never reveals the final answer; hint level 3 may show the corrected _current_ step only.
- Every LLM call goes through `LlmService.generate` with a zod schema (quotas + logging + retry).
- Student text is data: always wrap it with `studentInput()` in prompts.
- API contracts live in `@tutor/shared`; change the schema there, not ad hoc in a controller.
- Schema changes → `db:generate`, commit the SQL file. Never edit applied migrations.
- Keep UI copy in both `en` and `uk` dictionaries.
- Keep the e2e test (`apps/api/test/tutor.e2e-spec.ts`) green; extend it when the state machine changes.
- ESLint (type-aware: no floating promises, react-hooks) and Prettier (single quotes, width 100). No CORS: the web app is same-origin by design.
- Never commit `.env` or keys.
- Commits and PRs carry no AI attribution (no `Co-Authored-By`, no “Generated with”): set in `.claude/settings.json` → `attribution`.
