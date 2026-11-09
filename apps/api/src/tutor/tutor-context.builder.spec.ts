import type { Db } from '../db/db.module';
import { attempts, messages, mistakes, type Attempt } from '../db/schema';
import { TutorContextBuilder } from './tutor-context.builder';
import type { Turn } from './turn';

type Row = { role: 'STUDENT' | 'TUTOR'; content: string };

/**
 * Just enough of Drizzle for the builder: the messages query returns the stored dialogue newest
 * first, cut at its LIMIT (as ORDER BY seq DESC LIMIT n would); the history queries are empty.
 */
function fakeDb(dialogueOldestFirst: Row[]): Db {
  const query = (table: unknown) => {
    let limit = Infinity;
    const chain = {
      where: () => chain,
      groupBy: () => chain,
      orderBy: () => chain,
      limit: (n: number) => {
        limit = n;
        return chain;
      },
      then: (resolve: (rows: unknown[]) => unknown) => {
        if (table === messages) return resolve([...dialogueOldestFirst].reverse().slice(0, limit));
        if (table === attempts) return resolve([{ n: 0 }]);
        if (table === mistakes) return resolve([]);
        throw new Error('unexpected table');
      },
    };
    return chain;
  };
  return { select: () => ({ from: query }) } as unknown as Db;
}

const turn: Turn = {
  attempt: {
    id: 'a1',
    userId: 'u1',
    equation: '3(x + 4) = 2x + 19',
    currentLine: '3(x + 4) = 2x + 19',
    mode: 'SOLVING',
    hintLevel: 0,
    activeMistakeId: null,
    targetErrorType: null,
  } as Attempt,
  steps: [],
  mistakes: [],
  problemSkills: [],
  locale: 'en',
  deadline: 0,
  writes: [],
};

describe('TutorContextBuilder — the student message of this turn', () => {
  // A long dialogue, so the window of recent messages really cuts it.
  const earlier: Row[] = Array.from({ length: 12 }, (_, i) => ({
    role: i % 2 ? 'TUTOR' : 'STUDENT',
    content: `message ${i}`,
  }));
  const current = '3x + 4 = 2x + 19';

  it('gives the same context whether the message is pending or already stored', async () => {
    const pending = await new TutorContextBuilder(fakeDb(earlier)).build(turn, {}, current);
    const stored = await new TutorContextBuilder(
      fakeDb([...earlier, { role: 'STUDENT', content: current }]),
    ).build(turn);

    expect(pending).toEqual(stored);
    expect(pending.recentDialogue).toHaveLength(8);
    expect(pending.recentDialogue.at(-1)).toEqual({ role: 'Student', content: current });
  });

  it('without a pending message, shows the stored dialogue as before', async () => {
    const ctx = await new TutorContextBuilder(fakeDb(earlier)).build(turn);
    expect(ctx.recentDialogue.map((m) => m.content)).toEqual(
      earlier.slice(-8).map((m) => m.content),
    );
  });
});
