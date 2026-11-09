# Eval of the AI part

The math engine decides whether a line is right. The model diagnoses why a step is wrong and
writes the hints. `pnpm eval` measures that part against a real model, so a change to a prompt, a
schema or the model becomes a number.

## Commands

Run from the repository root. Report paths are relative to `apps/api`.

```bash
pnpm eval                                  # all cases, the first model of GEMINI_MODEL_DIAGNOSIS
pnpm eval --model gemini-3.5-flash-lite    # another model
pnpm eval --only SIGN_TRANSFER --limit 4   # a quick look at one error type
pnpm eval --only CHECK                     # only the slips in the answer check
pnpm eval --resume evals/reports/<file>.json    # finish a run cut short by the daily quota
pnpm eval --rescore evals/reports/<file>.json   # apply changed checks to saved answers, offline
```

A run writes `evals/reports/<date>-<model>.md` and a `.json` with the raw answers. `--rescore`
writes `<file>-rescored`. The eval is not in CI: it needs an API key and spends about 200 requests.
Run it after changing prompts, schemas or the model, and commit the report.

## Cases

- **Wrong steps** (`cases.ts`): 54 cases, 8 per error type and 6 for `OTHER`, half EN and half
  UK. Each has the category a teacher would give and a step a teacher would accept. Before a run
  the engine checks that every wrong step is wrong and every accepted step is right; a bad case
  stops the run.
- **Slips in the answer check** (`check-cases.ts`): 18 cases. The student substituted the root
  correctly, then made one slip computing a side: left or right side, in a multiplication or an
  addition, EN and UK. In `check-13` … `check-18` the equation itself shows the value of the sides
  (`x + 5 = 12`).

## What runs

Production prompt functions and zod schemas, through `callStructured` (the API's validation and
retry); no database, no server. A wrong step gets the diagnosis (also hint level 1), then levels 2
and 3. A slip in the check gets `checkDiagnosePrompt`, then levels 2 and 3 of the check's ladder,
all through the API's guard.

## Rules and metrics

- Error type accuracy, per type and locale, with a confusion matrix. Invalid JSON, failed calls,
  latency p50 / p95.
- Level 1 is a question. No level gives the final answer in any form (`x = 7`, `x = 14/2`, "x
  equals 7").
- Level 3 shows the corrected current step only; when that step is the answer, it names the
  operation and the line.
- Level 2 builds its example on other numbers: none of the equation or the student's lines outside
  a quote of their work.
- In the check, no level states the value of a side or the result of the operation that slipped,
  or shows a computed check line; level 3 lists operations without results. Guard: retries, fixed
  hints, leaks after it, false positives (every number caught is already written).
- The reply is in the student's language; the raw LaTeX is intact.

Math is pulled out of the LaTeX and compared by the engine, not as strings. The checks are
heuristics with unit tests (`*.spec.ts`).

## Results

All runs below are scored with the current checks.

Wrong steps, 54 cases, 162 hints per run:

| Run                                    | Report                                        | Error type | Hints with the final answer | L1 is a question | L3 rule | L2 on other numbers | Latency p50 / p95 |
| -------------------------------------- | --------------------------------------------- | ---------- | --------------------------- | ---------------- | ------- | ------------------- | ----------------- |
| First version, `gemini-3.5-flash-lite` | `2026-11-09-gemini-3.5-flash-lite-rescored`   | 41 / 54    | 2                           | 100%             | 96.3%   | 37.0%               | 916 / 1408 ms     |
| Final, `gemini-3.5-flash-lite`         | `2026-11-09-gemini-3.5-flash-lite-4-rescored` | 43 / 54    | 0                           | 96.3%            | 96.3%   | 35.2%               | 835 / 1154 ms     |
| Final, `gemini-3.6-flash` (production) | `2026-11-09-gemini-3.6-flash-2-rescored`      | 48 / 54    | 0                           | 98.1%            | 98.1%   | 70.4%               | 1606 / 3146 ms    |

The final lite run came before the level-2 prompt fix, so its level-2 column is not comparable.

Slips in the check, last run (`2026-11-10-gemini-3.6-flash-3`, `gemini-3.6-flash`, 18 cases, 54
hints): level 1 is a question 100%, no value of a side 96.3% (52/54), no computed line 100%,
level 3 rule 100%, level 2 on other numbers 66.7%, guard retried 2 / fixed hint 1, no leak after
the guard 100%, guard false positives 0 of 3, latency 1643 / 4251 ms.

## The guard on hints in the check

Prompts make leaks rarer but cannot rule them out. So hints on a slip in the check pass a guard
in code (`src/tutor/check-hint-guard.ts`), in the API and in the eval:

1. It forbids the value both sides take at the root and the true values of both sides of the
   student's line. Numbers already written in the equation or the student's line are allowed:
   quoting `33 = 32`, or the 12 in `x + 5 = 12`, gives nothing away.
2. If a hint states a forbidden value, the model is asked once more, and the request names the
   violation.
3. If the retry leaks too, a fixed hint for that level is shown (`notices.checkHintTemplate`).

In the last run the guard acted 3 times in 54 hints, with no false positives. Twice the retry was
clean; once the fixed hint was shown. The two hints still flagged are level-2 examples that end
in the result of the operation that slipped (`check-7`: 28, `check-18`: 5). The guard does not
know which operation slipped, so these stay a prompt matter.

## Weak spots

- **Mistakes that fit no category** (`OTHER`) are forced into a named one: 2 of 6 right in
  production, 0 of 6 on lite. Some labels are arguable (`3x + 6 → 3x + 6x` does look like
  combining), so read the confusion matrix, not only the total.
- **Lite** confuses "did something to one side only" (5 of 8) and arithmetic slips (6 of 8) with
  other mistakes. `gemini-3.6-flash` does better on both (8 and 7 of 8) but is about twice as slow.
- **Level 2 on other numbers** is at 70%. Most remaining flags are small numbers in an example
  that happen to match the problem. Some are the check being strict: naming the student's own
  coefficient as a bare number counts against the tutor.
- **Noise.** Diagnosis runs at temperature 0.3, and a ±2 case swing between runs is normal.
- **The model behind a name can change.** `gemini-3.5-flash` is already served by
  `gemini-3.6-flash`.

## History

Only the reports behind the tables are kept. The intermediate runs (field order in the schemas,
level 2 before and after its fix, the first version of the guard) are in commit `721b8d1`:

```bash
git ls-tree --name-only 721b8d1 apps/api/evals/reports/
git checkout 721b8d1 -- apps/api/evals/reports
```
