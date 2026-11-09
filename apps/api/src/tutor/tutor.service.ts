import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  checkStep,
  classifyInput,
  ERROR_TO_SKILL,
  MathInputError,
  normalizeMathInput,
  parseEquation,
  solve,
  type AttemptSummary,
  type AttemptView,
  type ErrorType,
  type ListAttemptsQuery,
  type MessageKind,
  type MessageRole,
  type StartAttemptInput,
  type StepCheckResult,
} from '@tutor/shared';
import type { Attempt, Mistake } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { LlmUnavailableError } from '../llm/llm.types';
import {
  celebratePrompt,
  chatPrompt,
  diagnosePrompt,
  hintPrompt,
  stepFeedbackPrompt,
  systemPrompt,
} from '../llm/prompts';
import { ChatReplySchema, DiagnosisSchema, FeedbackSchema } from '../llm/tutor-schemas';
import { ProblemsService } from '../problems/problems.service';
import { OUTCOME, SkillsService } from '../progress/skills.service';
import { AttemptRepository, type AttemptPatch } from './attempt.repository';
import { AppConfig } from '../config/config.service';
import { AttemptLock } from './attempt-lock';
import { FollowUpService } from './follow-up.service';
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
 *   SOLVING ──"x = answer"──▶ SOLVED ──had corrected mistakes?──▶ follow-up attempt
 *   follow-up SOLVED without repeating the error ──▶ mistake marked verified
 *
 * Correctness is decided by the math engine (exact solution-set comparison).
 * The LLM explains WHY a step is wrong and writes every teaching message.
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

    const attempt = await this.repo.insert({
      userId,
      problemId,
      title,
      equation,
      variable,
      currentLine: equation,
    });
    await this.say(attempt.id, 'TUTOR', 'GREETING', notices.greeting(locale, latex, false));
    return this.getView(userId, attempt.id);
  }

  async submit(userId: string, attemptId: string, text: string): Promise<AttemptView> {
    return this.lock.run(attemptId, async () => {
      const turn = await this.loadTurn(userId, attemptId);
      if (classifyInput(text) === 'step') await this.handleStep(turn, text);
      else await this.handleChat(turn, text);
      return this.getView(userId, attemptId);
    });
  }

  async hint(userId: string, attemptId: string): Promise<AttemptView> {
    return this.lock.run(attemptId, async () => {
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
        await this.update(turn, { hintLevel: level });
        await this.say(attemptId, 'TUTOR', level === 3 ? 'EXPLANATION' : 'HINT', out.message, {
          hintLevel: level,
          requested: true,
        });
      } catch (e) {
        await this.sayUnavailable(attemptId, e, notices.aiUnavailable(turn.locale));
      }
      return this.getView(userId, attemptId);
    });
  }

  // --- Turn handlers ---------------------------------------------------------

  private async handleStep(turn: Turn, text: string) {
    const { attempt, locale } = turn;
    await this.say(attempt.id, 'STUDENT', 'STEP', text);

    // Re-typing the last correct line is "equivalent" but proves nothing; after a mistake it
    // would otherwise count as the correction.
    if (sameText(text, attempt.currentLine)) {
      await this.say(
        attempt.id,
        'TUTOR',
        'NOTICE',
        notices.sameLine(locale, attempt.mode === 'REMEDIATION'),
        { repeatedLine: true },
      );
      return;
    }

    let check: StepCheckResult;
    try {
      check = checkStep(attempt.currentLine, text, attempt.variable);
    } catch (e) {
      if (e instanceof MathInputError) {
        await this.say(attempt.id, 'TUTOR', 'NOTICE', notices.parseError(locale, e.code), {
          inputError: e.code,
        });
        return;
      }
      throw e;
    }

    const step = await this.repo.insertStep({
      attemptId: attempt.id,
      index: turn.steps.length,
      input: text,
      latex: check.current.latex,
      isCorrect: check.equivalent,
    });
    turn.steps.push(step);

    if (check.equivalent) await this.onCorrectStep(turn, text, check);
    else await this.onWrongStep(turn, text, check);
  }

  private async onCorrectStep(turn: Turn, text: string, check: StepCheckResult) {
    const { attempt, locale } = turn;
    const fixed = attempt.mode === 'REMEDIATION' ? activeMistake(turn) : null;

    if (fixed) {
      await this.repo.markCorrected(fixed.id, attempt.hintLevel);
      fixed.corrected = true;
      await this.skills.record(attempt.userId, ERROR_TO_SKILL[fixed.errorType], OUTCOME.CORRECTED);
    }
    await this.update(turn, {
      currentLine: text,
      mode: 'SOLVING',
      hintLevel: 0,
      activeMistakeId: null,
    });

    if (check.solved) return this.onSolved(turn, check);

    const ctx = await this.contexts.build(turn);
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
      await this.say(attempt.id, 'TUTOR', 'FEEDBACK', out.message, {
        correct: true,
        fixedErrorType: fixed?.errorType ?? null,
      });
    } catch (e) {
      await this.sayUnavailable(attempt.id, e, notices.stepCorrectNoAi(locale), { correct: true });
    }
  }

  private async onWrongStep(turn: Turn, text: string, check: StepCheckResult) {
    const { attempt, locale } = turn;
    const active = activeMistake(turn);
    // Still fixing a mistake and tried again unsuccessfully → climb the hint ladder.
    // Otherwise it is a new mistake → diagnose it and start at level 1.
    const level = (active ? Math.min(MAX_HINT, attempt.hintLevel + 1) : 1) as 1 | 2 | 3;
    const ctx = await this.contexts.build(turn, { hintLevel: level });

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

    const mistakeId =
      active?.id ?? (await this.recordMistake(turn, text, errorType, misconception)).id;
    await this.update(turn, { mode: 'REMEDIATION', hintLevel: level, activeMistakeId: mistakeId });

    if (tutorMessage) {
      await this.say(attempt.id, 'TUTOR', level === 3 ? 'EXPLANATION' : 'HINT', tutorMessage, {
        hintLevel: level,
        errorType,
        correct: false,
      });
    } else {
      await this.sayUnavailable(attempt.id, unavailable, notices.stepWrongNoAi(locale), {
        correct: false,
      });
    }
  }

  private async onSolved(turn: Turn, check: StepCheckResult) {
    const { attempt, locale } = turn;
    await this.update(turn, { status: 'SOLVED', solvedAt: new Date() });

    const outcome = turn.mistakes.length ? OUTCOME.SOLVED_WITH_MISTAKES : OUTCOME.CLEAN;
    for (const skill of turn.problemSkills)
      await this.skills.record(attempt.userId, skill, outcome);

    // Follow-up passed: the original error was not repeated → understanding verified.
    if (attempt.targetErrorType && attempt.sourceMistakeId) {
      const repeated = turn.mistakes.some((m) => m.errorType === attempt.targetErrorType);
      if (!repeated) {
        await this.repo.markVerified(attempt.sourceMistakeId, attempt.userId);
        await this.skills.record(
          attempt.userId,
          ERROR_TO_SKILL[attempt.targetErrorType],
          OUTCOME.CLEAN,
        );
      }
    }

    const fixed = turn.mistakes.filter((m) => m.corrected && m.errorType !== 'OTHER');
    const target =
      (await this.repo.followUpDepth(attempt)) < MAX_FOLLOW_UP_DEPTH ? fixed[0] : undefined;
    const solution =
      check.currentSolution.kind === 'unique'
        ? `${attempt.variable} = ${check.currentSolution.value.toLatex()}`
        : '';

    // Build the follow-up first so the celebration can point at the real problem.
    const followUp = target ? await this.createFollowUp(turn, target) : null;

    const ctx = await this.contexts.build(turn);
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
          ),
          schema: FeedbackSchema,
          deadline: turn.deadline,
        },
        attempt.userId,
      );
      await this.say(attempt.id, 'TUTOR', 'CELEBRATION', out.message, { solved: true });
    } catch (e) {
      await this.sayUnavailable(attempt.id, e, notices.solvedNoAi(locale, solution), {
        solved: true,
      });
    }

    if (followUp && target) {
      await this.say(
        attempt.id,
        'TUTOR',
        'FOLLOW_UP',
        notices.followUpReady(locale, followUp.latex, followUp.title),
        {
          nextAttemptId: followUp.id,
          equation: followUp.equation,
          errorType: target.errorType,
          source: followUp.source,
        },
      );
    }
  }

  private async handleChat(turn: Turn, text: string) {
    const { attempt, locale } = turn;
    await this.say(attempt.id, 'STUDENT', 'CHAT', text);
    const ctx = await this.contexts.build(turn);
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
      if (attempt.mode === 'REMEDIATION' && activeMistake(turn) && reply.escalate) {
        const level = Math.min(MAX_HINT, attempt.hintLevel + 1);
        await this.update(turn, { hintLevel: level });
        await this.say(attempt.id, 'TUTOR', level === 3 ? 'EXPLANATION' : 'HINT', reply.message, {
          hintLevel: level,
        });
      } else {
        await this.say(
          attempt.id,
          'TUTOR',
          'CHAT',
          reply.message,
          reply.understood ? { understood: true } : null,
        );
      }
    } catch (e) {
      await this.sayUnavailable(attempt.id, e, notices.aiUnavailable(locale));
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
    const child = await this.repo.insert({
      userId: parent.userId,
      title: notices.followUpTitle(locale, mistake.errorType),
      equation: problem.equation,
      currentLine: problem.equation,
      parentAttemptId: parent.id,
      targetErrorType: mistake.errorType,
      sourceMistakeId: mistake.id,
    });
    await this.say(child.id, 'TUTOR', 'GREETING', notices.greeting(locale, parsed.latex, true));
    return {
      id: child.id,
      equation: problem.equation,
      latex: parsed.latex,
      title: child.title,
      source: problem.source,
    };
  }

  private async recordMistake(
    turn: Turn,
    stepInput: string,
    errorType: ErrorType,
    description: string,
  ) {
    const mistake = await this.repo.insertMistake({
      userId: turn.attempt.userId,
      attemptId: turn.attempt.id,
      errorType,
      description,
      previousLine: turn.attempt.currentLine,
      stepInput,
    });
    turn.mistakes.push(mistake);
    if (errorType !== 'OTHER')
      await this.skills.record(turn.attempt.userId, ERROR_TO_SKILL[errorType], OUTCOME.MISTAKE);
    return mistake;
  }

  private async update(turn: Turn, patch: AttemptPatch) {
    turn.attempt = await this.repo.update(turn.attempt.id, patch);
  }

  private async say(
    attemptId: string,
    role: MessageRole,
    kind: MessageKind,
    content: string,
    meta: Record<string, unknown> | null = null,
  ) {
    await this.repo.say(attemptId, role, kind, content, meta);
  }

  private async sayUnavailable(
    attemptId: string,
    e: unknown,
    text: string,
    meta: Record<string, unknown> = {},
  ) {
    if (!(e instanceof LlmUnavailableError)) throw e;
    await this.say(attemptId, 'TUTOR', 'NOTICE', text, { ...meta, aiUnavailable: e.reason });
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
    };
  }
}

const sameText = (a: string, b: string) =>
  normalizeMathInput(a).replace(/\s/g, '') === normalizeMathInput(b).replace(/\s/g, '');
