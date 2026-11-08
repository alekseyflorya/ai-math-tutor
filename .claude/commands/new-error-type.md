---
description: Add a new mistake category to the tutor end to end
argument-hint: <ERROR_TYPE_NAME> <short description>
---

Add the mistake category `$ARGUMENTS` across the stack:

1. `packages/shared/src/schemas/index.ts`: add it to `ERROR_TYPES` and map it in `ERROR_TO_SKILL`.
2. `apps/api/src/llm/prompts.ts`: describe it in `ERROR_TYPE_GUIDE` (one sentence + an example).
3. `apps/api/src/tutor/follow-up.service.ts`: add a structural requirement in `validateFollowUp`
   if the category needs one, and a branch in `templateProblem` if the generic template cannot test it.
4. `apps/api/src/tutor/notices.ts` (`followUpTitle`) and `apps/web/src/i18n/dict.ts` (`ERROR_LABELS`): EN + UK labels.
5. The Postgres enum changed: run `pnpm --filter @tutor/api db:generate` and commit the new migration.
6. Extend `follow-up.service.spec.ts`, then run `/check`.
