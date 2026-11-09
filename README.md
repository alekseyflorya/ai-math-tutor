# AI Math Tutor

A tutor for linear equations, built as a test task. The student solves a problem step by step.
When a step is wrong, the tutor finds the exact transformation that went wrong, asks questions
instead of giving the answer, and then gives a new problem with the same trap to see whether the
lesson stuck.

**Demo:** https://tutor.florik.pp.ua. Click **Try as a demo student**; no sign-up needed, and every
click creates a separate account.

## Try the test scenario

Click **Open the test scenario** (`3(x + 4) = 2x + 19`), then:

1. Type the classic mistake `3x + 4 = 2x + 19`. The line is marked wrong right away, and the tutor
   asks a question about the bracket.
2. Press **Hint** twice: the rule on a different example, then the corrected step. The tutor never
   gives `x = 7`.
3. Write any correct line (for example `3x + 12 = 2x + 19`) and solve to the end.
4. Check the answer the way it is done at school: `3(7 + 4) = 2·7 + 19`, then `33 = 33`.
5. Solve the practice problem the tutor gives you, then open **Progress**.

## How it works

**Code decides whether a step is right. The model only explains why.**

LLMs make arithmetic mistakes, and a tutor that marks a correct step as wrong quickly loses the
student's trust. So `packages/shared` contains a small math engine. It parses the input safely
(mathjs only builds the syntax tree; nothing is evaluated), turns each side into `a·x + b` with
exact fractions, and compares the solution sets of two lines. Any valid transformation is
accepted, so there is no single "expected path".

When a step is wrong, the model (Gemini) gets the facts from the engine, such as both lines
expanded and both solutions, and returns JSON: the error type, a short description, and the
message for the student. If the student is still stuck, the hints go up three levels.

The same engine runs in the browser, so ✓ or ✗ appears as soon as the line is sent. The tutor's
text follows in 1–2 seconds.

A few more decisions:

- **A plain state machine, no LangChain.** Solving → fixing a mistake → checking the answer →
  solved → practice problem, in `apps/api/src/tutor/tutor.service.ts`, with the state in
  Postgres. A framework would hide this flow, not simplify it.
- **The model can fail.** If it is slow, rate limited or down, the engine still checks every step
  and the app says the AI is offline.
- **The demo is public.** Sessions are httpOnly cookies, and there are rate limits and daily
  limits on model calls. Whatever the student types reaches the model as data, not as
  instructions.

## Measuring the AI part

`pnpm eval` runs 54 labelled student mistakes and 18 slips in the answer check against the real
model, with the same prompts as production. It counts how often the error type is right and
whether the hints follow the rules: level 1 is a question, and no hint gives the answer away.

| Setup                                                    | Error type right | Hints that give the answer away |
| -------------------------------------------------------- | ---------------- | ------------------------------- |
| First version, `gemini-3.5-flash-lite`                   | 41 / 54          | 2 of 162                        |
| Final, `gemini-3.5-flash-lite`                           | 43 / 54          | 0                               |
| Final, `gemini-3.6-flash` for diagnosis and hints (prod) | 48 / 54          | 0                               |

What it changed:

- `gemini-3.6-flash` diagnoses better but is about twice as slow, so it is used only for
  diagnosis and hints. Everything else uses `gemini-3.5-flash-lite`.
- Prompts make leaks rarer but cannot rule them out. Hints for a slip in the answer check go
  through a check in code that catches the value of a side and asks the model again. In the last
  run no such value got through.
- The weak spots are mistakes that fit no category, which the model forces into a named one, and,
  on `gemini-3.5-flash-lite`, "did something to one side only".

The cases, rules and full results are in [apps/api/evals](apps/api/evals/README.md).

## Tests

- **Math engine:** unit tests, plus property-based tests (fast-check) that compare it with an
  independent solver on random equations.
- **API:** unit tests, and an e2e test of the whole scenario over HTTP on a real Postgres with a
  mock model.
- **Web:** Vitest and Testing Library.

CI runs typecheck, lint, tests and the build on every pull request.

## Run it locally

You need a Gemini API key from [aistudio.google.com](https://aistudio.google.com).

```bash
cp .env.example .env          # set GEMINI_API_KEY and JWT_SECRET
docker compose up --build     # → http://localhost:8080
```

For development (Node 22, pnpm 10):

```bash
pnpm install
pnpm db:up                    # Postgres in Docker on :5433
pnpm dev                      # API on :3100, web on http://localhost:5173
pnpm test                     # needs pnpm db:up
```

## Deployment

A push to `main` runs the tests, builds two Docker images (API, and Caddy with the web app) and
deploys them to a small VPS over SSH. If the new version fails the health check, the previous one
is started again. Caddy handles HTTPS. `deploy/server/setup.sh` prepares a fresh Ubuntu server.

## Web, iOS and Android

The web app is the first client. A mobile app can reuse most of what is already here:

- **Shared code.** The math engine and the API contracts live in `@tutor/shared`, plain
  TypeScript with no browser APIs. An Expo / React Native app in `apps/mobile` imports it as it
  is, so every step is checked on the phone, instantly and offline. Only the tutor's text needs
  the network. The new work is the UI: formulas need a native math view or a small WebView with
  KaTeX.
- **The same API.** It is JSON, with zod schemas shared by the client and the server. Mobile apps
  use bearer tokens with refresh rotation instead of the cookie session; that is a second strategy
  in the same auth module.
- **Input that fits a phone.** A row of math keys (x, brackets, fractions, ×, −) above the system
  keyboard. Later, a photo or handwriting of a step goes to a math OCR model and then to the same
  parser. A recognition error shows up as "I couldn't read that step", never as a wrong grade.
- **Offline.** Problems and the student's work can be cached on the device. Steps are checked
  locally, and the turns that need the tutor are sent when the connection is back.
- **Notifications.** On iOS and Android, a push reminder can bring the student back to an old
  mistake a few days later.
- **Voice** for younger students: speech in and out around the same turns. This is where an agent
  framework such as LangGraph starts to pay off (interruptions, long conversations).
- **More users.** The API already runs as several instances: locks and migrations live in the
  database. Next come shared rate limits, managed Postgres with read replicas for progress pages,
  and keeping the cheaper model for everything except diagnosis, so the cost per student stays
  low.
- **More of the school course.** Inequalities, systems and quadratic equations mean extending the
  engine. The curriculum itself is data.

## What I would do next

For students:

- **Come back to old mistakes.** A few days after a mistake is marked as fixed, give one more
  problem with the same trap. One practice problem right after the hint shows short-term
  understanding, not whether it lasts.
- **Better diagnosis on the cheaper model.** The engine can tell the model facts like "only
  the right side changed", which points straight at "did something to one side only". I would
  test this on new eval cases, so the prompt does not just fit the 54 I already have.
- **Notice steps that go nowhere.** Moving terms around is a correct step, but it brings the
  student no closer to the answer. The tutor could gently suggest a more useful next move.
- **A view for teachers and parents.** Typed mistakes and fixed skills are already in the
  database; this is mostly a read-only page.

For the system:

- **Run the eval on a schedule.** Google can switch the model behind a name without notice
  (`gemini-3.5-flash` is already served by `gemini-3.6-flash`). A small nightly run would catch
  a drop in quality.
- **Stream the tutor's text** once replies get longer. I measured it: today it would save only
  0.2–0.3 s ([details](docs/design.md#latency)).
- **Safe retries.** After a network error the app does not resend a step, to avoid counting it
  twice. An idempotency key per turn would make a retry safe.
- **Backups and monitoring.** Daily database backups off the server and an uptime check.
- **Several API instances.** Locks and migrations already work with several instances; rate
  limits and model cooldowns still live in memory and should move to Redis.

## Project structure

| Path                                  | What                                                    |
| ------------------------------------- | ------------------------------------------------------- |
| `packages/shared/src/math/`           | the math engine, shared by the server and the browser   |
| `apps/api/src/tutor/tutor.service.ts` | the tutor's state machine                               |
| `apps/api/src/llm/prompts.ts`         | all prompts and teaching rules                          |
| `apps/api/evals/`                     | eval cases, rule checks, reports                        |
| `apps/api/test/tutor.e2e-spec.ts`     | the whole scenario as an e2e test                       |
| `deploy/`                             | Caddyfile, production compose file, server setup script |

More detail (state machine, locks and transactions, security, latency measurements) is in
[docs/design.md](docs/design.md).

**Stack:** React 19, Vite, Tailwind CSS 4, TanStack Query, KaTeX · NestJS 11, PostgreSQL, Drizzle,
zod · Gemini · Docker, Caddy, GitHub Actions.
