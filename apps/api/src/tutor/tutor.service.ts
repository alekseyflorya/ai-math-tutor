import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, notInArray } from 'drizzle-orm';
import {
  checkStep,
  classifyInput,
  ERROR_TO_SKILL,
  MathInputError,
  parseEquation,
  solve,
  type AttemptView,
  type ErrorType,
  type Locale,
  type MessageKind,
  type MessageRole,
  type Skill,
  type StartAttemptInput,
  type StepCheckResult,
} from '@tutor/shared';
import { DB, type Db } from '../db/db.module';
import { attempts, messages, mistakes, problems, steps, users, type Attempt, type Mistake, type Step } from '../db/schema';
import { LlmService } from '../llm/llm.service';
import { LlmUnavailableError } from '../llm/llm.types';
import {
  celebratePrompt,
  chatPrompt,
  diagnosePrompt,
  hintPrompt,
  stepFeedbackPrompt,
  systemPrompt,
  type TutorContext,
} from '../llm/prompts';
import { ChatReplySchema, DiagnosisSchema, FeedbackSchema } from '../llm/tutor-schemas';
import { ProblemsService } from '../problems/problems.service';
import { OUTCOME, SkillsService } from '../progress/skills.service';
import { toAttemptView } from './attempt.mapper';
import { FollowUpService } from './follow-up.service';
import { notices } from './notices';

/** An attempt plus what a turn needs; mutated in memory as the turn progresses. */
interface Turn {
  attempt: Attempt;
  steps: Step[];
  mistakes: Mistake[];
  problemSkills: Skill[];
  locale: Locale;
}

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
  /** Rejects overlapping turns on one attempt (double clicks, two tabs). Single instance by design. */
  private readonly busy = new Set<string>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly llm: LlmService,
    private readonly followUps: FollowUpService,
    private readonly skills: SkillsService,
    private readonly problems: ProblemsService,
  ) {}

  // --- Queries ---------------------------------------------------------------

  async getView(userId: string, attemptId: string): Promise<AttemptView> {
    const attempt = await this.findOwned(userId, attemptId);
    const [stepRows, messageRows, [next]] = await Promise.all([
      this.db.select().from(steps).where(eq(steps.attemptId, attemptId)).orderBy(asc(steps.index)),
      this.db.select().from(messages).where(eq(messages.attemptId, attemptId)).orderBy(asc(messages.seq)),
      this.db
        .select({ id: attempts.id })
        .from(attempts)
        .where(eq(attempts.parentAttemptId, attemptId))
        .orderBy(desc(attempts.createdAt))
        .limit(1),
    ]);
    return toAttemptView(attempt, stepRows, messageRows, next?.id ?? null);
  }

  async listRecent(userId: string) {
    const rows = await this.db
      .select({
        id: attempts.id,
        title: attempts.title,
        equation: attempts.equation,
        status: attempts.status,
        parentAttemptId: attempts.parentAttemptId,
        updatedAt: attempts.updatedAt,
      })
      .from(attempts)
      .where(eq(attempts.userId, userId))
      .orderBy(desc(attempts.updatedAt))
      .limit(20);
    return rows.map(({ parentAttemptId, updatedAt, ...r }) => ({
      ...r,
      isFollowUp: Boolean(parentAttemptId),
      updatedAt: updatedAt.toISOString(),
    }));
  }

  // --- Commands --------------------------------------------------------------

  async start(userId: string, input: StartAttemptInput): Promise<AttemptView> {
    const locale = await this.localeOf(userId);
    let equation: string;
    let title: string;
    let problemId: string | null = null;

    if (input.problemId) {
      const problem = await this.problems.get(input.problemId);
      // Resume instead of piling up duplicate attempts for the same problem.
      const [open] = await this.db
        .select({ id: attempts.id })
        .from(attempts)
        .where(and(eq(attempts.userId, userId), eq(attempts.problemId, problem.id), eq(attempts.status, 'IN_PROGRESS')))
        .orderBy(desc(attempts.updatedAt))
        .limit(1);
      if (open) return this.getView(userId, open.id);
      equation = problem.equation;
      title = locale === 'uk' ? problem.titleUk : problem.title;
      problemId = problem.id;
    } else {
      equation = input.equation!;
      title = notices.customTitle(locale);
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
      if (e instanceof MathInputError) throw new BadRequestException({ code: 'INVALID_EQUATION', message: e.message });
      throw e;
    }

    const [attempt] = await this.db
      .insert(attempts)
      .values({ userId, problemId, title, equation, variable, currentLine: equation })
      .returning();
    await this.say(attempt!.id, 'TUTOR', 'GREETING', notices.greeting(locale, latex, false));
    return this.getView(userId, attempt!.id);
  }

  async submit(userId: string, attemptId: string, text: string): Promise<AttemptView> {
    return this.exclusive(attemptId, async () => {
      const turn = await this.loadTurn(userId, attemptId);
      if (classifyInput(text) === 'step') await this.handleStep(turn, text);
      else await this.handleChat(turn, text);
      return this.getView(userId, attemptId);
    });
  }

  async hint(userId: string, attemptId: string): Promise<AttemptView> {
    return this.exclusive(attemptId, async () => {
      const turn = await this.loadTurn(userId, attemptId);
      const level = Math.min(MAX_HINT, turn.attempt.hintLevel + 1) as 1 | 2 | 3;
      await this.update(turn, { hintLevel: level });
      const ctx = await this.context(turn);
      try {
        const out = await this.llm.generate(
          { purpose: 'hint', system: systemPrompt(turn.locale), prompt: hintPrompt(ctx, level), schema: FeedbackSchema },
          userId,
        );
        await this.say(attemptId, 'TUTOR', level === 3 ? 'EXPLANATION' : 'HINT', out.message, { hintLevel: level, requested: true });
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

    let check: StepCheckResult;
    try {
      check = checkStep(attempt.currentLine, text, attempt.variable);
    } catch (e) {
      if (e instanceof MathInputError) {
        await this.say(attempt.id, 'TUTOR', 'NOTICE', notices.parseError(locale, e.code), { inputError: e.code });
        return;
      }
      throw e;
    }

    const [step] = await this.db
      .insert(steps)
      .values({ attemptId: attempt.id, index: turn.steps.length, input: text, latex: check.current.latex, isCorrect: check.equivalent })
      .returning();
    turn.steps.push(step!);

    if (check.equivalent) await this.onCorrectStep(turn, text, check);
    else await this.onWrongStep(turn, text, check);
  }

  private async onCorrectStep(turn: Turn, text: string, check: StepCheckResult) {
    const { attempt, locale } = turn;
    const fixed = attempt.mode === 'REMEDIATION' ? this.activeMistake(turn) : null;

    if (fixed) {
      await this.db
        .update(mistakes)
        .set({ corrected: true, correctedAt: new Date(), hintsUsed: attempt.hintLevel })
        .where(eq(mistakes.id, fixed.id));
      fixed.corrected = true;
      await this.skills.record(attempt.userId, ERROR_TO_SKILL[fixed.errorType], OUTCOME.CORRECTED);
    }
    await this.update(turn, { currentLine: text, mode: 'SOLVING', hintLevel: 0, activeMistakeId: null });

    if (check.solved) return this.onSolved(turn, check);

    const ctx = await this.context(turn);
    try {
      const out = await this.llm.generate(
        {
          purpose: 'step_feedback',
          system: systemPrompt(locale),
          prompt: stepFeedbackPrompt(ctx, text, check.facts, Boolean(fixed)),
          schema: FeedbackSchema,
        },
        attempt.userId,
      );
      await this.say(attempt.id, 'TUTOR', 'FEEDBACK', out.message, { correct: true, fixedErrorType: fixed?.errorType ?? null });
    } catch (e) {
      await this.sayUnavailable(attempt.id, e, notices.stepCorrectNoAi(locale), { correct: true });
    }
  }

  private async onWrongStep(turn: Turn, text: string, check: StepCheckResult) {
    const { attempt, locale } = turn;
    const active = this.activeMistake(turn);
    // Still fixing a mistake and tried again unsuccessfully → climb the hint ladder.
    // Otherwise it is a new mistake → diagnose it and start at level 1.
    const level = (active ? Math.min(MAX_HINT, attempt.hintLevel + 1) : 1) as 1 | 2 | 3;
    const ctx = await this.context(turn, { hintLevel: level });

    let errorType: ErrorType = active?.errorType ?? 'OTHER';
    let tutorMessage: string | null = null;
    let unavailable: unknown = null;
    let misconception = 'Not diagnosed: AI tutor unavailable';
    try {
      const diagnosis = await this.llm.generate(
        {
          purpose: 'diagnose',
          system: systemPrompt(locale),
          prompt: diagnosePrompt(ctx, text, check.facts, level),
          schema: DiagnosisSchema,
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

    const mistakeId = active?.id ?? (await this.recordMistake(turn, text, errorType, misconception)).id;
    await this.update(turn, { mode: 'REMEDIATION', hintLevel: level, activeMistakeId: mistakeId });

    if (tutorMessage) {
      await this.say(attempt.id, 'TUTOR', level === 3 ? 'EXPLANATION' : 'HINT', tutorMessage, {
        hintLevel: level,
        errorType,
        correct: false,
      });
    } else {
      await this.sayUnavailable(attempt.id, unavailable, notices.stepWrongNoAi(locale), { correct: false });
    }
  }

  private async onSolved(turn: Turn, check: StepCheckResult) {
    const { attempt, locale } = turn;
    await this.update(turn, { status: 'SOLVED', solvedAt: new Date() });

    const outcome = turn.mistakes.length ? OUTCOME.SOLVED_WITH_MISTAKES : OUTCOME.CLEAN;
    for (const skill of turn.problemSkills) await this.skills.record(attempt.userId, skill, outcome);

    // Follow-up passed: the original error was not repeated → understanding verified.
    if (attempt.targetErrorType && attempt.sourceMistakeId) {
      const repeated = turn.mistakes.some((m) => m.errorType === attempt.targetErrorType);
      if (!repeated) {
        await this.db
          .update(mistakes)
          .set({ verified: true, verifiedAt: new Date() })
          .where(and(eq(mistakes.id, attempt.sourceMistakeId), eq(mistakes.userId, attempt.userId)));
        await this.skills.record(attempt.userId, ERROR_TO_SKILL[attempt.targetErrorType], OUTCOME.CLEAN);
      }
    }

    const fixed = turn.mistakes.filter((m) => m.corrected && m.errorType !== 'OTHER');
    const target = (await this.followUpDepth(attempt)) < MAX_FOLLOW_UP_DEPTH ? fixed[0] : undefined;
    const solution =
      check.currentSolution.kind === 'unique' ? `${attempt.variable} = ${check.currentSolution.value.toLatex()}` : '';

    const ctx = await this.context(turn);
    try {
      const out = await this.llm.generate(
        {
          purpose: 'celebrate',
          system: systemPrompt(locale),
          prompt: celebratePrompt(ctx, solution, target ? fixed.map((m) => `${m.errorType}: ${m.description}`) : []),
          schema: FeedbackSchema,
        },
        attempt.userId,
      );
      await this.say(attempt.id, 'TUTOR', 'CELEBRATION', out.message, { solved: true });
    } catch (e) {
      await this.sayUnavailable(attempt.id, e, notices.solvedNoAi(locale, solution), { solved: true });
    }

    if (target) await this.createFollowUp(turn, target);
  }

  private async handleChat(turn: Turn, text: string) {
    const { attempt, locale } = turn;
    await this.say(attempt.id, 'STUDENT', 'CHAT', text);
    const ctx = await this.context(turn);
    try {
      const reply = await this.llm.generate(
        { purpose: 'chat', system: systemPrompt(locale), prompt: chatPrompt(ctx, text), schema: ChatReplySchema },
        attempt.userId,
      );
      if (attempt.mode === 'REMEDIATION' && this.activeMistake(turn) && reply.escalate) {
        const level = Math.min(MAX_HINT, attempt.hintLevel + 1);
        await this.update(turn, { hintLevel: level });
        await this.say(attempt.id, 'TUTOR', level === 3 ? 'EXPLANATION' : 'HINT', reply.message, { hintLevel: level });
      } else {
        await this.say(attempt.id, 'TUTOR', 'CHAT', reply.message, reply.understood ? { understood: true } : null);
      }
    } catch (e) {
      await this.sayUnavailable(attempt.id, e, notices.aiUnavailable(locale));
    }
  }

  // --- Helpers ---------------------------------------------------------------

  private async createFollowUp(turn: Turn, mistake: Mistake) {
    const { attempt: parent, locale } = turn;
    const previous = await this.db
      .select({ equation: attempts.equation })
      .from(attempts)
      .where(and(eq(attempts.userId, parent.userId), eq(attempts.targetErrorType, mistake.errorType)))
      .limit(10);
    const problem = await this.followUps.generate({
      userId: parent.userId,
      source: parent.equation,
      errorType: mistake.errorType,
      misconception: mistake.description,
      avoid: previous.map((p) => p.equation),
    });
    const parsed = parseEquation(problem.equation);
    const [child] = await this.db
      .insert(attempts)
      .values({
        userId: parent.userId,
        title: notices.followUpTitle(locale, mistake.errorType),
        equation: problem.equation,
        currentLine: problem.equation,
        parentAttemptId: parent.id,
        targetErrorType: mistake.errorType,
        sourceMistakeId: mistake.id,
      })
      .returning();
    await this.say(child!.id, 'TUTOR', 'GREETING', notices.greeting(locale, parsed.latex, true));
    await this.say(parent.id, 'TUTOR', 'FOLLOW_UP', notices.followUpReady(locale, parsed.latex), {
      nextAttemptId: child!.id,
      equation: problem.equation,
      errorType: mistake.errorType,
      source: problem.source,
    });
  }

  private async recordMistake(turn: Turn, stepInput: string, errorType: ErrorType, description: string) {
    const [mistake] = await this.db
      .insert(mistakes)
      .values({
        userId: turn.attempt.userId,
        attemptId: turn.attempt.id,
        errorType,
        description,
        previousLine: turn.attempt.currentLine,
        stepInput,
      })
      .returning();
    turn.mistakes.push(mistake!);
    if (errorType !== 'OTHER') await this.skills.record(turn.attempt.userId, ERROR_TO_SKILL[errorType], OUTCOME.MISTAKE);
    return mistake!;
  }

  private activeMistake(turn: Turn): Mistake | null {
    const id = turn.attempt.activeMistakeId;
    return id ? (turn.mistakes.find((m) => m.id === id) ?? null) : null;
  }

  private async followUpDepth(attempt: Attempt): Promise<number> {
    let depth = 0;
    let parentId = attempt.parentAttemptId;
    while (parentId && depth < 10) {
      depth++;
      const [parent] = await this.db
        .select({ parentAttemptId: attempts.parentAttemptId })
        .from(attempts)
        .where(eq(attempts.id, parentId));
      parentId = parent?.parentAttemptId ?? null;
    }
    return depth;
  }

  private async context(turn: Turn, override: Partial<TutorContext> = {}): Promise<TutorContext> {
    const { attempt } = turn;
    const active = this.activeMistake(turn);
    const recent = await this.db
      .select({ role: messages.role, content: messages.content })
      .from(messages)
      .where(and(eq(messages.attemptId, attempt.id), notInArray(messages.kind, ['GREETING', 'FOLLOW_UP'])))
      .orderBy(desc(messages.seq))
      .limit(8);
    return {
      locale: turn.locale,
      problem: attempt.equation,
      currentLine: attempt.currentLine,
      steps: turn.steps.map((s) => ({ input: s.input, isCorrect: s.isCorrect })),
      mode: attempt.mode,
      hintLevel: attempt.hintLevel,
      activeMistake: active
        ? { errorType: active.errorType, description: active.description, stepInput: active.stepInput, previousLine: active.previousLine }
        : null,
      recentDialogue: recent.reverse().map((m) => ({
        role: m.role === 'STUDENT' ? 'Student' : 'Tutor',
        content: m.content.slice(0, 400),
      })),
      isFollowUp: Boolean(attempt.targetErrorType),
      ...override,
    };
  }

  private async update(turn: Turn, patch: Partial<typeof attempts.$inferInsert>) {
    const [row] = await this.db
      .update(attempts)
      .set({ ...patch, updatedAt: new Date() })
      .where(eq(attempts.id, turn.attempt.id))
      .returning();
    turn.attempt = row!;
  }

  private async say(attemptId: string, role: MessageRole, kind: MessageKind, content: string, meta: Record<string, unknown> | null = null) {
    await this.db.insert(messages).values({ attemptId, role, kind, content, meta });
  }

  private async sayUnavailable(attemptId: string, e: unknown, text: string, meta: Record<string, unknown> = {}) {
    if (!(e instanceof LlmUnavailableError)) throw e;
    await this.say(attemptId, 'TUTOR', 'NOTICE', text, { ...meta, aiUnavailable: e.reason });
  }

  private async findOwned(userId: string, attemptId: string): Promise<Attempt> {
    if (!/^[0-9a-f-]{36}$/i.test(attemptId)) throw new NotFoundException({ code: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found' });
    const [attempt] = await this.db
      .select()
      .from(attempts)
      .where(and(eq(attempts.id, attemptId), eq(attempts.userId, userId)));
    if (!attempt) throw new NotFoundException({ code: 'ATTEMPT_NOT_FOUND', message: 'Attempt not found' });
    return attempt;
  }

  private async loadTurn(userId: string, attemptId: string): Promise<Turn> {
    const attempt = await this.findOwned(userId, attemptId);
    if (attempt.status !== 'IN_PROGRESS') {
      throw new ConflictException({ code: 'ATTEMPT_CLOSED', message: 'This problem is already finished' });
    }
    const [stepRows, mistakeRows, problem, locale] = await Promise.all([
      this.db.select().from(steps).where(eq(steps.attemptId, attemptId)).orderBy(asc(steps.index)),
      this.db.select().from(mistakes).where(eq(mistakes.attemptId, attemptId)).orderBy(asc(mistakes.createdAt)),
      attempt.problemId
        ? this.db.select({ skills: problems.skills }).from(problems).where(eq(problems.id, attempt.problemId)).then((r) => r[0])
        : Promise.resolve(undefined),
      this.localeOf(userId),
    ]);
    return { attempt, steps: stepRows, mistakes: mistakeRows, problemSkills: (problem?.skills ?? []) as Skill[], locale };
  }

  private async localeOf(userId: string): Promise<Locale> {
    const [u] = await this.db.select({ locale: users.locale }).from(users).where(eq(users.id, userId));
    return u?.locale === 'uk' ? 'uk' : 'en';
  }

  private async exclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.busy.has(key)) {
      throw new ConflictException({ code: 'BUSY', message: 'The tutor is still answering your previous message' });
    }
    this.busy.add(key);
    try {
      return await fn();
    } finally {
      this.busy.delete(key);
    }
  }
}
