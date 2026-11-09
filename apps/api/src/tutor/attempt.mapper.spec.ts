import { Logger } from '@nestjs/common';
import type { Message } from '../db/schema';
import { toMessageView } from './attempt.mapper';

const row = (kind: Message['kind'], meta: Message['meta']): Message => ({
  id: 'm1',
  attemptId: 'a1',
  seq: 1,
  role: 'TUTOR',
  kind,
  content: 'text',
  meta,
  createdAt: new Date('2026-11-09T10:00:00Z'),
});

describe('toMessageView — meta by kind', () => {
  let warn: jest.SpyInstance;
  beforeEach(() => {
    warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => warn.mockRestore());

  it('keeps meta that matches the contract of its kind', () => {
    expect(toMessageView(row('HINT', { hintLevel: 2, errorType: 'DISTRIBUTION' })).meta).toEqual({
      hintLevel: 2,
      errorType: 'DISTRIBUTION',
    });
    expect(toMessageView(row('EXPLANATION', { hintLevel: 3, requested: true })).meta).toEqual({
      hintLevel: 3,
      requested: true,
    });
    expect(toMessageView(row('NOTICE', { aiUnavailable: 'timeout', correct: false })).meta).toEqual(
      { aiUnavailable: 'timeout', correct: false },
    );
    expect(toMessageView(row('GREETING', null)).meta).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('shows a row with unexpected meta without it, and logs it, instead of failing', () => {
    const view = toMessageView(row('HINT', { hintLevel: 'two', errorType: 'TYPO' }));
    expect(view).toMatchObject({ id: 'm1', kind: 'HINT', content: 'text', meta: null });
    expect(toMessageView(row('FOLLOW_UP', { nextAttemptId: 42 })).meta).toBeNull();
    expect(toMessageView(row('STEP', { stray: true })).meta).toBeNull();
    expect(warn).toHaveBeenCalledTimes(3);
  });
});
