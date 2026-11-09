import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ERROR_TO_SKILL,
  judgeLine,
  lastCheckLine,
  lineContext,
  MathInputError,
  parseEquation,
  sameText,
  solve,
  type LineVerdict,
  type AttemptSummary,
  type AttemptView,
  type ErrorType,
  type ListAttemptsQuery,
  type MessageKind,
  type MessageMeta,
  type MessageRole,
  type NoticeMeta,
  type Skill,
  type StartAttemptInput,
  type StepCheckResult,
} from '@tutor/shared';
import type { Attempt, Mistake } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { LlmUnavailableError } from '../llm/llm.types';
import {
  celebratePrompt,
  chatPrompt,
  checkDiagnosePrompt,
  diagnosePrompt,
  hintPrompt,
  stepFeedbackPrompt,
  systemPrompt,
} from '../llm/prompts';
import {
  ChatReplySchema,
  CheckDiagnosisSchema,
  DiagnosisSchema,
  FeedbackSchema,
} from '../llm/tutor-schemas';
import { ProblemsService } from '../problems/problems.service';
import { OUTCOME, SkillsService } from '../progress/skills.service';
import { AppConfig } from '../config/config.service';
import { AttemptLock } from './attempt-lock';
import { AttemptRepository, type AttemptPatch } from './attempt.repository';
import { FollowUpService } from './follow-up.service';
import { meta } from './message-meta';
import { notices } from './notices';
import { TutorContextBuilder } from './tutor-context.builder';
import { activeMistake, type Turn } from './turn';

const MAX_HINT = 3;
const MAX_FOLLOW_UP_DEPTH = 2;

/**
 * The tutoring state machine.
 *
 *   SOLVING ──wrong step──▶ REMEDIATION (hint level 1)
 *      ▲                      │ still stuck (chat / "Hint" / another wrong try) → level 2 → 3
 *      └──correct step────────┘ mistake marked corrected
 *   SOLVING ──"x = answer"──▶ CHECKING: substitute it into the original equation
 *      CHECKING ──slip──▶ hint ladder (mode stays CHECKING) ──"33 = 33"──▶ SOLVED (check DONE)
 *      CHECKING ──"skip the check"──▶ SOLVED (check SKIPPED)
 *   SOLVED ──had corrected mistakes in the solution?──▶ follow-up attempt
 *   follow-up SOLVED without repeating the error ──▶ mistake marked verified
 *
 * Correctness is decided by the math engine (exact solution-set comparison).
 * The LLM explains WHY a step is wrong and writes every teaching message.
 *
 * A turn reads, checks with the engine, calls the model, and only then writes: every write of
 * the turn is queued (the in-memory Turn is updated at once, so later prompts see it) and applied
 * in ONE transaction at the end. No transaction is open while the model thinks, and a failure
 * leaves the attempt exactly as it was.
 */
@Injectable()
export class TutorService {
  constructor(
    private readonly repo: AttemptRepository,
    private readonly llm: LlmService,
    private readonly followUps: FollowUpService,
    private readonly skills: SkillsService,
    private readonly problems: ProblemsService,
    private readonly config: AppConfig,
    private readonly lock: AttemptLock,
    private readonly contexts: TutorContextBuilder,
  ) {}

  // --- Queries ---------------------------------------------------------------

  async getView(userId: string, attemptId: string): Promise<AttemptView> {
    return this.repo.view(await this.findOwned(userId, attemptId));
  }

  listRecent(userId: string, kind?: ListAttemptsQuery['kind']): Promise<AttemptSummary[]> {
    return this.repo.listRecent(userId, kind);
  }

  // --- Commands --------------------------------------------------------------

  async start(userId: string, input: StartAttemptInput): Promise<AttemptView> {
    const locale = await this.repo.localeOf(userId);
    let equation: string;
    let title: string;
    let problemId: string | null = null;

    if (input.problemId) {
      const problem = await this.problems.get(input.problemId);
      // Resume instead of piling up duplicate attempts for the same problem.
      const open = await this.repo.latestForProblem(userId, problem.id, 'IN_PROGRESS');
      if (open) return this.getView(userId, open);
      // Clicking a solved problem shows the solution; "Solve again" sends restart: true.
      if (!input.restart) {
        const solved = await this.repo.latestForProblem(userId, problem.id, 'SOLVED');
        if (solved) return this.getView(userId, solved);
      }
      equation = problem.equation;
      title = locale === 'uk' ? problem.titleUk : problem.title;
      problemId = problem.id;
    } else {
      equation = input.equation!;
      title = notices.customTitle(locale);
      // Same equation typed again while it's still open → resume it instead of duplicating.
      const [open] = (await this.repo.openCustom(userId)).filter((r) =>
        sameText(r.equation, equation),
      );
      if (open) return this.getView(userId, open.id);
    }

    let latex: string;
    let variable: string;
    try {
      const parsed = parseEquation(equation);
      const s = solve(parsed);
      if (s.kind !== 'unique') {
        throw new BadRequestException({
          code: 'NO_UNIQUE_SOLUTION',
          message:
            s.kind === 'all'
              ? 'Every number solves this equation. Try another one.'
              : 'This equation has no solution. Try another one.',
        });
      }
      latex = parsed.latex;
      variable = parsed.variable ?? 'x';
    } catch (e) {
      if (e instanceof MathInputError)
        throw new BadRequestException({ code: 'INVALID_EQUATION', message: e.message });
      throw e;
    }

    const values = { userId, problemId, title, equation, variable, currentLine: equation };
    const attempt = await this.repo.transaction(async (r) => {
      // On a curriculum problem a parallel request may have opened it a moment ago.
      const row = problemId ? await r.insertUnlessOpen(values) : await r.insert(values);
      if (row) await r.say(row.id, 'TUTOR', 'GREETING', notices.greeting(locale, latex, false));
      return row;
    });
    if (attempt) return this.getView(userId, attempt.id);
    const open = await this.repo.latestForProblem(userId, problemId!, 'IN_PROGRESS');
    return this.getView(userId, open!);
  }

  async submit(userId: string, attemptId: string, text: string): Promise<AttemptView> {
    return this.lock.run(userId, attemptId, async () => {
      const turn = await this.loadTurn(userId, attemptId);
      // The browser computes the same verdict to show it at once (judgeLine in @tutor/shared).
      const verdict = judgeLine(text, lineContext(turn.attempt, turn.steps));
      if (verdict.kind === 'message') await this.handleChat(turn, text);
      else await this.handleLine(turn, text, verdict);
      await this.commit(turn);
      return this.getView(userId, attemptId);
    });
  }

  async hint(userId: string, attemptId: string): Promise<AttemptView> {
    return this.lock.run(userId, attemptId, async () => {
      const turn = await this.loadTurn(userId, attemptId);
      const level = Math.min(MAX_HINT, turn.attempt.hintLevel + 1) as 1 | 2 | 3;
      const ctx = await this.contexts.build(turn, { hintLevel: level });
      try {
        const out = await this.llm.generate(
          {
            purpose: 'hint',
            system: systemPrompt(turn.locale),
            prompt: hintPrompt(ctx, level),
            schema: FeedbackSchema,
            deadline: turn.deadline,
          },
          userId,
        );
        // Raised only once the hint exists: an outage must not silently "spend" a level.
        this.update(turn, { hintLevel: level });
        this.say(
          turn,
          'TUTOR',
          level === 3 ? 'EXPLANATION' : 'HINT',
          out.message,
          meta.hint(level, { requested: true }),
        );
      } catch (e) {
        this.sayUnavailable(turn, e, notices.aiUnavailable(turn.locale));
      }
      await this.commit(turn);
      return this.getView(userId, attemptId);
    });
  }

  /**
   * Closes the problem without the check (allowed only while CHECKING). A slip in the check that
   * is being worked on stays uncorrected: it is recorded as it was.
   */
  async skipCheck(userId: string, attemptId: string): Promise<AttemptView> {
    return this.lock.run(userId, attemptId, async () => {
      const turn = await this.loadTurn(userId, attemptId);
      if (turn.attempt.mode !== 'CHECKING') {
        throw new ConflictException({
          code: 'NOT_CHECKING',
          message: 'There is no answer to check yet',
        });
      }
      this.say(
        turn,
        'TUTOR',
        'NOTICE',
        notices.checkSkipped(turn.locale),
        meta.notice({ checkSkipped: true }),
      );
      await this.onSolved(turn, { checked: false });
      await this.commit(turn);
      return this.getView(userId, attemptId);
    });
  }

  // --- Turn handlers ---------------------------------------------------------

  /** A line of the solution or of the check, already judged by the engine. */
  private async handleLine(
    turn: Turn,
    text: string,
    verdict: Exclude<LineVerdict, { kind: 'message' }>,
  ) {
    const { attempt, locale } = turn;
    this.say(turn, 'STUDENT', 'STEP', text);

    switch (verdict.kind) {
      case 'repeated':
        this.say(
          turn,
          'TUTOR',
          'NOTICE',
          notices.sameLine(locale, Boolean(activeMistake(turn))),
          meta.notice({ repeatedLine: true }),
        );
        return;
      case 'unreadable':
        this.say(
          turn,
          'TUTOR',
          'NOTICE',
          notices.parseError(locale, verdict.code),
          meta.notice({ inputError: verdict.code }),
        );
        return;
      case 'not_check': {
        const { solutionLatex, equationLatex } = answerOf(attempt);
        this.say(
          turn,
          'TUTOR',
          'NOTICE',
          verdict.reason === 'not_numeric'
            ? notices.checkNotNumeric(locale, solutionLatex)
            : notices.checkNotSubstitution(locale, solutionLatex, equationLatex),
          meta.notice({ checkError: verdict.reason }),
        );
        return;
      }
      case 'check':
        return this.onCheckLine(turn, text, verdict);
      case 'step':
        break;
    }

    const step = {
      id: randomUUID(),
      attemptId: attempt.id,
      index: turn.steps.length,
      input: text,
      latex: verdict.latex,
      isCorrect: verdict.isCorrect,
      phase: 'SOLUTION' as const,
      createdAt: new Date(),
    };
    turn.steps.push(step);
    this.later(turn, (r) => r.insertStep(step));

    if (verdict.isCorrect) await this.onCorrectStep(turn, text, verdict.result);
    else await this.onWrongStep(turn, text, verdict.result);
  }

  private async onCorrectStep(turn: Turn, text: string, check: StepCheckResult) {
    const { attempt, locale } = turn;
    const fixed = activeMistake(turn);

    if (fixed) {
      const hintsUsed = attempt.hintLevel;
      fixed.corrected = true;
      this.later(turn, (r) => r.markCorrected(fixed.id, hintsUsed));
      this.recordSkill(turn, ERROR_TO_SKILL[fixed.errorType], OUTCOME.CORRECTED);
    }
    this.update(turn, { currentLine: text, mode: 'SOLVING', hintLevel: 0, activeMistakeId: null });

    if (check.solved) return this.onAnswerReached(turn, fixed);

    const ctx = await this.contexts.build(turn, {}, text);
    try {
      const out = await this.llm.generate(
        {
          purpose: 'step_feedback',
          system: systemPrompt(locale),
          prompt: stepFeedbackPrompt(ctx, text, check.facts, Boolean(fixed)),
          schema: FeedbackSchema,
          deadline: turn.deadline,
        },
        attempt.userId,
      );
      this.say(turn, 'TUTOR', 'FEEDBACK', out.message, meta.feedback(fixed?.errorType ?? null));
    } catch (e) {
      this.sayUnavailable(turn, e, notices.stepCorrectNoAi(locale), { correct: true });
    }
  }

  private async onWrongStep(turn: Turn, text: string, check: StepCheckResult) {
    const { attempt, locale } = turn;
    const active = activeMistake(turn);
    // Still fixing a mistake and tried again unsuccessfully → climb the hint ladder.
    // Otherwise it is a new mistake → diagnose it and start at level 1.
    const level = (active ? Math.min(MAX_HINT, attempt.hintLevel + 1) : 1) as 1 | 2 | 3;
    const ctx = await this.contexts.build(turn, { hintLevel: level }, text);

    let errorType: ErrorType = active?.errorType ?? 'OTHER';
    let tutorMessage: string | null = null;
    let unavailable: unknown = null;
    let misconception = notices.notDiagnosed(locale);
    try {
      const diagnosis = await this.llm.generate(
        {
          purpose: 'diagnose',
          system: systemPrompt(locale),
          prompt: diagnosePrompt(ctx, text, check.facts, level),
          schema: DiagnosisSchema,
          deadline: turn.deadline,
          temperature: 0.3,
        },
        attempt.userId,
      );
      if (!active) errorType = diagnosis.errorType;
      misconception = diagnosis.misconception;
      tutorMessage = diagnosis.message;
    } catch (e) {
      if (!(e instanceof LlmUnavailableError)) throw e;
      unavailable = e; // the math engine still knows the step is wrong; record it anyway
    }

    const mistakeId = active?.id ?? this.recordMistake(turn, text, errorType, misconception).id;
    this.update(turn, { mode: 'REMEDIATION', hintLevel: level, activeMistakeId: mistakeId });

    if (tutorMessage) {
      this.say(
        turn,
        'TUTOR',
        level === 3 ? 'EXPLANATION' : 'HINT',
        tutorMessage,
        meta.hint(level, { errorType, correct: false }),
      );
    } else {
      this.sayUnavailable(turn, unavailable, notices.stepWrongNoAi(locale), { correct: false });
    }
  }

  /**
   * The answer is reached and verified by the engine. Not solved yet: the student checks it by
   * substitution first. Fixed copy, no model call.
   */
  private onAnswerReached(turn: Turn, fixed: Mistake | null) {
    const { solutionLatex, equationLatex } = answerOf(turn.attempt);
    this.update(turn, { mode: 'CHECKING' });
    this.say(
      turn,
      'TUTOR',
      'FEEDBACK',
      notices.checkRequest(turn.locale, solutionLatex, equationLatex),
      meta.feedback(fixed?.errorType ?? null, { checkRequested: true }),
    );
  }

  /** A line of the check by substitution (CHECKING), right or with a slip: the engine's call. */
  private async onCheckLine(
    turn: Turn,
    text: string,
    verdict: Extract<LineVerdict, { kind: 'check' }>,
  ) {
    const { attempt, locale } = turn;
    const lastRight = lastCheckLine(turn.steps);
    const result = verdict.result;
    const step = {
      id: randomUUID(),
      attemptId: attempt.id,
      index: turn.steps.length,
      input: text,
      latex: verdict.latex,
      isCorrect: verdict.isCorrect,
      phase: 'CHECK' as const,
      createdAt: new Date(),
    };
    turn.steps.push(step);
    this.later(turn, (r) => r.insertStep(step));

    if (result.verdict.kind === 'arithmetic') {
      return this.onCheckSlip(turn, text, result.facts, lastRight?.input ?? attempt.equation);
    }

    const fixed = activeMistake(turn);
    if (fixed) {
      const hintsUsed = attempt.hintLevel;
      fixed.corrected = true;
      this.later(turn, (r) => r.markCorrected(fixed.id, hintsUsed));
      this.recordSkill(turn, ERROR_TO_SKILL[fixed.errorType], OUTCOME.CORRECTED);
      this.update(turn, { hintLevel: 0, activeMistakeId: null });
    }
    if (result.verdict.kind === 'correct' && result.verdict.done)
      return this.onSolved(turn, { checked: true, pendingStudentMessage: text });
    this.say(
      turn,
      'TUTOR',
      'FEEDBACK',
      notices.checkStepOk(locale),
      meta.feedback(fixed?.errorType ?? null, { checkStep: true }),
    );
  }

  /**
   * A calculation slip in the check: an ARITHMETIC mistake with the usual hint ladder. The mode
   * stays CHECKING; the model only explains (the category is the engine's).
   */
  private async onCheckSlip(turn: Turn, text: string, facts: string[], previousLine: string) {
    const { attempt, locale } = turn;
    const active = activeMistake(turn);
    const level = (active ? Math.min(MAX_HINT, attempt.hintLevel + 1) : 1) as 1 | 2 | 3;
    const ctx = await this.contexts.build(turn, { hintLevel: level }, text);

    let tutorMessage: string | null = null;
    let unavailable: unknown = null;
    let misconception = notices.notDiagnosed(locale);
    try {
      const diagnosis = await this.llm.generate(
        {
          purpose: 'diagnose',
          system: systemPrompt(locale),
          prompt: checkDiagnosePrompt(ctx, text, facts, level),
          schema: CheckDiagnosisSchema,
          deadline: turn.deadline,
          temperature: 0.3,
        },
        attempt.userId,
      );
      misconception = diagnosis.misconception;
      tutorMessage = diagnosis.message;
    } catch (e) {
      if (!(e instanceof LlmUnavailableError)) throw e;
      unavailable = e;
    }

    const mistakeId =
      active?.id ??
      this.recordMistake(turn, text, 'ARITHMETIC', misconception, { phase: 'CHECK', previousLine })
        .id;
    this.update(turn, { hintLevel: level, activeMistakeId: mistakeId });

    if (tutorMessage) {
      this.say(
        turn,
        'TUTOR',
        level === 3 ? 'EXPLANATION' : 'HINT',
        tutorMessage,
        meta.hint(level, { errorType: 'ARITHMETIC', correct: false }),
      );
    } else {
      this.sayUnavailable(turn, unavailable, notices.stepWrongNoAi(locale), { correct: false });
    }
  }

  /** Checked (or the check skipped): skills, follow-up verification and practice, celebration. */
  private async onSolved(turn: Turn, opts: { checked: boolean; pendingStudentMessage?: string }) {
    const { attempt, locale } = turn;
    this.update(turn, {
      status: 'SOLVED',
      solvedAt: new Date(),
      check: opts.checked ? 'DONE' : 'SKIPPED',
      mode: 'SOLVING', // nothing left to check or remediate
      hintLevel: 0,
      // A slip in the check that was left when skipping stays uncorrected, honestly.
      activeMistakeId: null,
    });

    const outcome = turn.mistakes.length ? OUTCOME.SOLVED_WITH_MISTAKES : OUTCOME.CLEAN;
    for (const skill of turn.problemSkills) this.recordSkill(turn, skill, outcome);

    // Follow-up passed: the original error was not repeated → understanding verified.
    if (attempt.targetErrorType && attempt.sourceMistakeId) {
      // Only the solution counts: a slip in checking the practice problem is not the original
      // mistake coming back.
      const repeated = turn.mistakes.some(
        (m) => m.phase === 'SOLUTION' && m.errorType === attempt.targetErrorType,
      );
      if (!repeated) {
        const { sourceMistakeId, userId, targetErrorType } = attempt;
        this.later(turn, (r) => r.markVerified(sourceMistakeId, userId));
        this.recordSkill(turn, ERROR_TO_SKILL[targetErrorType], OUTCOME.CLEAN);
      }
    }

    // Practice targets mistakes of the solution, not slips while checking the answer.
    const fixed = turn.mistakes.filter(
      (m) => m.corrected && m.errorType !== 'OTHER' && m.phase === 'SOLUTION',
    );
    const target =
      (await this.repo.followUpDepth(attempt)) < MAX_FOLLOW_UP_DEPTH ? fixed[0] : undefined;
    const solution = answerOf(attempt).solutionLatex;

    // Build the follow-up first so the celebration can point at the real problem.
    const followUp = target ? await this.createFollowUp(turn, target) : null;

    const ctx = await this.contexts.build(turn, {}, opts.pendingStudentMessage);
    try {
      const out = await this.llm.generate(
        {
          purpose: 'celebrate',
          system: systemPrompt(locale),
          prompt: celebratePrompt(
            ctx,
            solution,
            fixed.map((m) => `${m.errorType}: ${m.description}`),
            followUp?.latex ?? null,
            opts.checked,
          ),
          schema: FeedbackSchema,
          deadline: turn.deadline,
        },
        attempt.userId,
      );
      this.say(turn, 'TUTOR', 'CELEBRATION', out.message, meta.celebration(opts.checked));
    } catch (e) {
      this.sayUnavailable(turn, e, notices.solvedNoAi(locale, solution), { solved: true });
    }

    if (followUp && target) {
      this.say(
        turn,
        'TUTOR',
        'FOLLOW_UP',
        notices.followUpReady(locale, followUp.latex, followUp.title),
        meta.followUp({
          nextAttemptId: followUp.id,
          equation: followUp.equation,
          errorType: target.errorType,
          source: followUp.source,
        }),
      );
    }
  }

  private async handleChat(turn: Turn, text: string) {
    const { attempt, locale } = turn;
    this.say(turn, 'STUDENT', 'CHAT', text);
    const ctx = await this.contexts.build(turn, {}, text);
    try {
      const reply = await this.llm.generate(
        {
          purpose: 'chat',
          system: systemPrompt(locale),
          prompt: chatPrompt(ctx, text),
          schema: ChatReplySchema,
          deadline: turn.deadline,
        },
        attempt.userId,
      );
      if (activeMistake(turn) && reply.escalate) {
        const level = Math.min(MAX_HINT, attempt.hintLevel + 1) as 1 | 2 | 3;
        this.update(turn, { hintLevel: level });
        this.say(
          turn,
          'TUTOR',
          level === 3 ? 'EXPLANATION' : 'HINT',
          reply.message,
          meta.hint(level),
        );
      } else {
        this.say(turn, 'TUTOR', 'CHAT', reply.message, reply.understood ? meta.understood() : null);
      }
    } catch (e) {
      this.sayUnavailable(turn, e, notices.aiUnavailable(locale));
    }
  }

  // --- Helpers ---------------------------------------------------------------

  private async createFollowUp(turn: Turn, mistake: Mistake) {
    const { attempt: parent, locale } = turn;
    const previous = await this.repo.followUpEquations(parent.userId, mistake.errorType);
    const problem = await this.followUps.generate({
      userId: parent.userId,
      source: parent.equation,
      errorType: mistake.errorType,
      misconception: mistake.description,
      avoid: previous,
      // At most half of what is left: the celebration still needs its call afterwards.
      deadline: Date.now() + (turn.deadline - Date.now()) / 2,
    });
    const parsed = parseEquation(problem.equation);
    const child = {
      id: randomUUID(),
      userId: parent.userId,
      title: notices.followUpTitle(locale, mistake.errorType),
      equation: problem.equation,
      currentLine: problem.equation,
      parentAttemptId: parent.id,
      targetErrorType: mistake.errorType,
      sourceMistakeId: mistake.id,
    };
    this.later(turn, async (r) => {
      await r.insert(child);
      await r.say(child.id, 'TUTOR', 'GREETING', notices.greeting(locale, parsed.latex, true));
    });
    return {
      id: child.id,
      equation: problem.equation,
      latex: parsed.latex,
      title: child.title,
      source: problem.source,
    };
  }

  private recordMistake(
    turn: Turn,
    stepInput: string,
    errorType: ErrorType,
    description: string,
    opts: { phase?: Mistake['phase']; previousLine?: string } = {},
  ): Mistake {
    const mistake: Mistake = {
      id: randomUUID(),
      userId: turn.attempt.userId,
      attemptId: turn.attempt.id,
      errorType,
      description,
      previousLine: opts.previousLine ?? turn.attempt.currentLine,
      stepInput,
      phase: opts.phase ?? 'SOLUTION',
      hintsUsed: 0,
      corrected: false,
      correctedAt: null,
      verified: false,
      verifiedAt: null,
      createdAt: new Date(),
    };
    turn.mistakes.push(mistake);
    this.later(turn, (r) => r.insertMistake(mistake));
    if (errorType !== 'OTHER') this.recordSkill(turn, ERROR_TO_SKILL[errorType], OUTCOME.MISTAKE);
    return mistake;
  }

  // --- Unit of work: queued writes, applied together --------------------------

  /** Queues a write of this turn; it runs in the turn's transaction. */
  private later(turn: Turn, write: Turn['writes'][number]) {
    turn.writes.push(write);
  }

  /** Applies every queued write of the turn in one transaction. */
  private async commit(turn: Turn) {
    if (turn.writes.length === 0) return;
    const writes = turn.writes.splice(0);
    await this.repo.transaction(async (r, tx) => {
      for (const write of writes) await write(r, tx);
    });
  }

  private update(turn: Turn, patch: AttemptPatch) {
    turn.attempt = { ...turn.attempt, ...patch, updatedAt: new Date() };
    const id = turn.attempt.id;
    this.later(turn, (r) => r.update(id, patch));
  }

  private recordSkill(turn: Turn, skill: Skill, outcome: number) {
    const userId = turn.attempt.userId;
    this.later(turn, (_r, tx) => this.skills.record(userId, skill, outcome, tx));
  }

  private say<K extends MessageKind>(
    turn: Turn,
    role: MessageRole,
    kind: K,
    content: string,
    data: MessageMeta<K> | null = null,
  ) {
    const attemptId = turn.attempt.id;
    this.later(turn, (r) => r.say(attemptId, role, kind, content, data));
  }

  private sayUnavailable(
    turn: Turn,
    e: unknown,
    text: string,
    extra: Omit<NoticeMeta, 'aiUnavailable'> = {},
  ) {
    if (!(e instanceof LlmUnavailableError)) throw e;
    this.say(turn, 'TUTOR', 'NOTICE', text, meta.notice({ ...extra, aiUnavailable: e.reason }));
  }

  private async findOwned(userId: string, attemptId: string): Promise<Attempt> {
    const attempt = await this.repo.findOwned(userId, attemptId);
    if (!attempt)
      throw new NotFoundException({ code: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found' });
    return attempt;
  }

  private async loadTurn(userId: string, attemptId: string): Promise<Turn> {
    const attempt = await this.findOwned(userId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictException({
        code: 'ATTEMPT_CLOSED',
        message: 'This problem is already finished',
      });
    }
    return {
      attempt,
      ...(await this.repo.loadTurnData(attempt)),
      deadline: Date.now() + this.config.get('LLM_TURN_BUDGET_MS'),
      writes: [],
    };
  }
}

/** The root and the original equation, as LaTeX (only shown once the root is reached). */
function answerOf(attempt: Attempt): { solutionLatex: string; equationLatex: string } {
  const parsed = parseEquation(attempt.equation);
  const s = solve(parsed);
  return {
    solutionLatex: `${attempt.variable} = ${s.kind === 'unique' ? s.value.toLatex() : '?'}`,
    equationLatex: parsed.latex,
  };
}
