import { contextBlock, historyLine, type TutorContext } from './prompts';

const base: TutorContext = {
  locale: 'en',
  problem: '3(x + 4) = 2x + 19',
  currentLine: '3(x + 4) = 2x + 19',
  steps: [],
  mode: 'SOLVING',
  hintLevel: 0,
  activeMistake: null,
  recentDialogue: [],
  isFollowUp: false,
  history: { solvedProblems: 0, mistakes: [] },
};

describe('student history in the prompt context', () => {
  it('summarises earlier mistakes by category with verification status', () => {
    const line = historyLine({
      solvedProblems: 4,
      mistakes: [
        { errorType: 'SIGN_TRANSFER', total: 2, verified: 1 },
        { errorType: 'DISTRIBUTION', total: 1, verified: 0 },
      ],
    });
    expect(line).toBe(
      'Student history: 4 problems solved before; earlier mistakes: SIGN_TRANSFER ×2 (1 later verified as understood), DISTRIBUTION ×1 (not yet verified).',
    );
  });

  it('is part of every turn context', () => {
    expect(contextBlock(base)).toContain('no earlier mistakes on record');
  });
});
