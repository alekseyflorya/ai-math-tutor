# Design notes

How the tutor works inside: the turn, the database, failures, security, models, latency and
deployment. The [README](../README.md) gives the overview.

## A turn and its states

An attempt moves through five states, kept in Postgres:

`SOLVING → REMEDIATION (hint 1 → 2 → 3) → SOLVING → CHECKING → SOLVED → follow-up`

- **SOLVING.** Each line is judged by `judgeLine` in `@tutor/shared`. A line with the same
  solution set as the previous one is a correct step, whatever the transformation.
- **REMEDIATION.** A wrong line opens a mistake. The model diagnoses it, and that message is hint
  level 1, a question. The level rises only while the student is stuck: they ask for a hint, guess,
  or write another wrong line. Any line equivalent to the last correct one marks the mistake
  corrected.
- **CHECKING.** Reaching `x = 7` does not close the problem. The student substitutes the root into
  the original equation and computes both sides. The engine judges each line exactly
  (`checkSubstitution`). A slip is an `ARITHMETIC` mistake of phase `CHECK`, with its own hint
  ladder. It counts for skills, but not for follow-ups or their verification. The check can be
  skipped after a confirmation.
- **SOLVED → follow-up.** The model writes a new problem with the same trap. The engine accepts it
  only if it is linear, has one whole-number root, is new, and contains the trap (for a bracket
  mistake, a bracket with a coefficient). A rejected problem goes back to the model with the
  reason; a checked template is the last resort. Solving it without repeating the mistake marks
  the mistake verified.

The root is in no API response until the student reaches it (`solutionLatex` stays null).

Model calls: a turn makes one call with a typed JSON answer. The turn that finishes or skips the
check makes two (the follow-up problem, then the message that presents it). Check lines get fixed
copy; the model is called only for a slip. All calls of a turn share one time budget
(`LLM_TURN_BUDGET_MS`, 25 s), and one call times out after `LLM_TIMEOUT_MS` (15 s). A slow model
costs one message, not the request.

Every prompt carries a short profile of the student's earlier mistakes (for example
`SIGN_TRANSFER ×2, 1 verified`), so the tutor can point at a pattern. All pedagogy is in
`apps/api/src/llm/prompts.ts`.

Why no LangChain or LangGraph: the flow is a small explicit state machine with its state in the
database. A framework would hide it. The provider port (`LlmProvider`) is about 20 lines per
vendor.

## One transaction per turn

A turn reads, judges with the engine, calls the model, and only then writes. Writes are queued
during the turn (`later`, `say`, `update`) and applied in one transaction at the end.

- No transaction is open while the model thinks.
- A failure anywhere leaves the attempt as it was.
- All queries live in `AttemptRepository`; `TutorService` keeps only the state machine.

## A lock in the database

Two turns on one attempt (a double click, two tabs, two API instances) must not interleave. The
lock is a lease in the attempt row: `busy_until` and `busy_token`.

- One conditional `UPDATE … RETURNING` takes it. If the row is busy, the API answers 409 `BUSY`.
- Only the holder releases it, by token.
- The lease expires on its own (`TURN_LOCK_LEASE_MS`, by default the turn budget plus 15 s), so a
  crashed instance does not block the attempt.

A partial unique index allows one open attempt per problem, so a double click on "start" cannot
open two.

## Failures and running without AI

- Model output is validated with zod. An invalid answer is retried once, with the validation
  error in the request (`structured-call.ts`).
- LaTeX broken by JSON escaping (`\t` in `\times`) is repaired before use.
- Timeouts, 429s and exhausted quotas do not stop the lesson. The engine still judges every line,
  and the app says the AI is offline.
- Hints on a slip in the check pass a guard in code (`check-hint-guard.ts`). If a hint states the
  value of a side, the model is asked once more; if it leaks again, a fixed hint is shown.
- The mock provider exists for tests only and is refused in production.

## Security

The demo is public, so:

- The session JWT is in an `httpOnly`, `SameSite=Lax`, `Secure` cookie.
- Passwords are hashed with argon2id. Login takes the same time whether the user exists or not.
- Writes accept JSON only (a CSRF defence). Bodies are limited to 20 KB, and inputs have length
  limits.
- No CORS: Caddy serves the web app and the API from one origin. helmet on the API, a strict CSP
  from Caddy.
- Per-IP rate limits: 120 requests a minute, 10 a minute for login and sign-up, 10 demo accounts
  an hour.
- Daily model quotas per user (150 calls) and in total (1000), counted in the database.
- Whatever the student types reaches the model wrapped as data (`studentInput()`), and the prompt
  says not to follow instructions inside it.
- Every demo click creates a separate account. Demo accounts older than 7 days are deleted daily.

## Progress model

Mistakes are typed: `DISTRIBUTION`, `SIGN_TRANSFER`, `COMBINING_LIKE_TERMS`, `INVERSE_OPERATION`,
`ONE_SIDE_ONLY`, `ARITHMETIC` (and `OTHER`). Each type maps to a skill.

Each skill keeps a mastery score, a moving average of outcomes (weight 0.25): a clean solve 1.0,
solved with mistakes 0.7, a corrected mistake 0.6, a mistake 0. A mistake is verified when the
student solves its follow-up without repeating it.

The Progress page shows steps, accuracy, mistakes by type (total, corrected, verified), mastery
per skill, the share of problems solved with a check, and 14 days of activity. The next problem
is recommended from the weakest skill within reach.

## Which Gemini model where

| Purpose                                                        | Variable                 | Models, in order                            |
| -------------------------------------------------------------- | ------------------------ | ------------------------------------------- |
| Diagnosis of a wrong step, hints                               | `GEMINI_MODEL_DIAGNOSIS` | `gemini-3.6-flash`, `gemini-3.5-flash-lite` |
| Everything else (step feedback, chat, follow-ups, celebration) | `GEMINI_MODEL`           | `gemini-3.5-flash-lite`, `gemini-3.6-flash` |

- Why: `gemini-3.6-flash` diagnoses better (48 of 54 against 43 for lite, see the
  [eval](../apps/api/evals/README.md)), but is about twice as slow. The extra second is paid only
  on a wrong step and on a hint; the verdict itself is instant.
- Each list falls back to the next model on a timeout or a 429.
- A model that answers 429 is skipped until the time the API names ("retry in 41s", or the reset
  of a daily quota at midnight Pacific time). The cooldown is per model, shared by both purposes.
- When every model is cooling down, the API is not called. The student sees the usual "AI
  unavailable" notice, and the engine keeps judging lines.

An Anthropic provider (`LLM_PROVIDER=anthropic`) is the alternative.

## Latency

What the student waits for is the verdict on their line. The browser runs the same `judgeLine`
as the server (about 0.06 ms on a laptop), so the line shows with ✓ or ✗ as soon as it is sent,
and a screen reader announces it. The tutor's text follows when the server answers; the server's
line replaces the provisional one. A different verdict there would be a bug, and it is logged in
development.

### Why the tutor's text is not streamed

Measured with `generateContentStream` on a diagnosis (three fields, `message` last, thinking level
low, two runs per model):

| Model                 | First chunk | `message` starts | Whole answer | Chunks           |
| --------------------- | ----------- | ---------------- | ------------ | ---------------- |
| gemini-3.5-flash-lite | 0.61–1.02 s | 0.73–1.14 s      | 0.86–1.33 s  | 5 × ~100 chars   |
| gemini-3.6-flash      | 0.97–1.14 s | 1.25–1.39 s      | 1.45–1.59 s  | 4–5 × ~100 chars |

Streaming would show the text 0.2–0.3 s earlier, in two or three jumps. That does not pay for a
new protocol, mid-turn disconnects, proxy settings and a Safari workaround. It will pay with longer
replies, voice, or slower models.

### The plan, if it is needed

- `POST /api/attempts/:id/messages/stream` as `text/event-stream`, read with `fetch`. Events typed
  in `@tutor/shared`: `verdict`, `delta`, `replace` (the final text differs, e.g. after a retry),
  `done` (after the turn's transaction commits) and `error`. The JSON endpoint stays as the
  fallback.
- `message` is already the last field of every schema, and Gemini gets `propertyOrdering`. A small
  parser takes `message` out of the partial JSON; the whole answer still goes through
  `callStructured`.
- Client gone while the model writes: abort, write nothing, release the lock. Gone after the
  answer: commit anyway; it shows after a reload.
- Caddy: a separate `handle` for the stream without `encode`, a heartbeat every 15 s.
- Safari: an open WebKit bug (Bugzilla 319542) can stall an idle fetch stream. Test WebKit first;
  fall back to `XMLHttpRequest` progress events.
- A server switch (`STREAMING_ENABLED`) answers 503 before the first byte, so the app falls back to
  JSON without a deploy.

## Deployment

A push to `main` runs the CI job (typecheck, lint, format, tests, build). Then:

1. Two images are built for `linux/amd64`: `api`, and `web` (Caddy with the static app). They are
   pushed to GHCR.
2. Over SSH the server runs `docker compose pull` and `up -d`, then waits for the API health
   check.
3. If the new version is not healthy, the tag that ran before is started again and checked. The
   job fails either way.

Nothing is compiled on the server. Caddy gets and renews the Let's Encrypt certificate.
`deploy/server/setup.sh` turns a fresh Ubuntu VPS into a Docker host: a deploy user, key-only
SSH, ufw, fail2ban, unattended upgrades. Memory limits per container keep the stack within 2 GB.

Migrations are applied on boot. So far they only add (columns, indexes, foreign keys), so the
previous image still runs after a rollback. A migration that removes or renames something must be
split across two releases.

## Several API instances

State lives in Postgres, so the API can run as several instances:

- the turn lock is a lease in the attempt row, and a turn is one transaction;
- a partial unique index keeps one open attempt per problem;
- migrations run under an advisory lock on boot;
- the daily demo cleanup runs on one instance (a transaction-scoped advisory lock).

Still per instance: the per-IP rate limits (in-memory throttler) and the cooldown of
rate-limited models. Shared limits would move both to Redis.

## Limitations

- Linear equations in one variable only. The engine is the place to extend.
- Re-typing the previous line is not accepted as a correction; a line that only reorders it
  (`3(x + 4) = 19 + 2x`) is. The follow-up problem checks understanding anyway.
- The tutor's text arrives whole, about a second after the verdict.
- After a network error the app does not resend a step, so it is not counted twice. An idempotency
  key per turn would make a retry safe.
- No off-server database backups and no uptime monitoring yet.
