---
description: Run everything CI runs (build shared, typecheck, format check, tests, web build) and report failures
---

Run, in order, and stop at the first failure to investigate and fix it:

1. `pnpm --filter @tutor/shared build`
2. `pnpm typecheck`
3. `pnpm format:check` (if it fails, run `pnpm format` and show the diff summary)
4. `pnpm test` (needs `pnpm db:up`; if Postgres is not running, start it first)
5. `pnpm --filter @tutor/web build`

Finish with a one-line verdict: ready to push, or what is still failing.
