import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { AttemptView, StepView } from '@tutor/shared';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { DICTS } from '../i18n/dict';
import { I18nProvider } from '../i18n/i18n';
import { api, ApiError } from '../lib/api';
import { Workspace } from './Workspace';

/** What the server answers to the next line; each test sets it. */
let serverReply: () => Promise<AttemptView>;

vi.mock('../lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('../lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      attempt: vi.fn(),
      // A plain function, not vi.fn: Vitest reports a rejected promise returned by a mock.
      send: () => serverReply(),
    },
  };
});

const t = DICTS.en;

const step = (input: string, isCorrect: boolean, phase: StepView['phase']): StepView => ({
  id: `s-${input}`,
  index: 0,
  input,
  latex: input,
  isCorrect,
  phase,
});

const solving: AttemptView = {
  id: 'a1',
  equation: '3(x + 4) = 2x + 19',
  latex: '3(x+4)=2x+19',
  variable: 'x',
  title: 'Brackets',
  status: 'IN_PROGRESS',
  mode: 'SOLVING',
  solutionLatex: null,
  check: null,
  hintLevel: 0,
  currentLine: '3(x + 4) = 2x + 19',
  currentLatex: '3(x+4)=2x+19',
  isFollowUp: false,
  targetErrorType: null,
  steps: [],
  messages: [],
  nextAttemptId: null,
  nextAttemptStatus: null,
  parentAttemptId: null,
  understandingVerified: false,
  problemId: null,
};

const checking: AttemptView = {
  ...solving,
  mode: 'CHECKING',
  solutionLatex: 'x = 7',
  currentLine: 'x = 7',
  currentLatex: 'x=7',
  steps: [step('x = 7', true, 'SOLUTION')],
};

/** A server answer the test releases when it wants. */
function deferred() {
  let resolve!: (a: AttemptView) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<AttemptView>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function open(attempt: AttemptView) {
  vi.mocked(api.attempt).mockResolvedValue(attempt);
  const reply = deferred();
  serverReply = () => reply.promise;
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <I18nProvider>
        <MemoryRouter>
          <Workspace attemptId={attempt.id} />
        </MemoryRouter>
      </I18nProvider>
    </QueryClientProvider>,
  );
  const notebook = await screen.findByLabelText(t.notebook);
  const user = userEvent.setup();
  const send = async (text: string) => {
    const input = screen.getByRole('textbox');
    await user.type(input, `${text}{Enter}`);
  };
  return { notebook, reply, send };
}

const marks = (el: HTMLElement) =>
  within(el)
    .queryAllByLabelText(new RegExp(`^(${t.correct}|${t.incorrect})$`))
    .map((m) => m.getAttribute('aria-label'));

const announced = () => document.querySelector('[aria-live="polite"].sr-only')!.textContent;

describe('the verdict in the browser, before the tutor answers', () => {
  it('marks a wrong step at once and announces it, then shows the server answer', async () => {
    const { notebook, reply, send } = await open(solving);
    await send('3x + 4 = 2x + 19');

    expect(marks(notebook)).toEqual([t.incorrect]); // the server has not answered yet
    expect(announced()).toBe(t.verdictWrong);

    reply.resolve({
      ...solving,
      mode: 'REMEDIATION',
      steps: [{ ...step('3x + 4 = 2x + 19', false, 'SOLUTION'), latex: '3x+4=2x+19' }],
    });
    await waitFor(() => expect(announced()).toBe(''));
    expect(marks(notebook)).toEqual([t.incorrect]); // the recorded step, not a second line
    expect(notebook.querySelectorAll('li')).toHaveLength(2);
  });

  it('marks a correct step with a tick', async () => {
    const { notebook, send } = await open(solving);
    await send('3x + 12 = 2x + 19');
    expect(marks(notebook)).toEqual([t.correct]);
    expect(announced()).toBe(t.verdictCorrect);
  });

  it('removes the line and gives the text back when the request fails', async () => {
    const { notebook, reply, send } = await open(solving);
    await send('3x + 12 = 2x + 19');
    expect(marks(notebook)).toHaveLength(1);

    reply.reject(new ApiError(503, 'ERROR', 'down'));
    await waitFor(() => expect(marks(notebook)).toHaveLength(0));
    expect(screen.getByRole('textbox')).toHaveProperty('value', '3x + 12 = 2x + 19');
    expect(screen.getByRole('alert')).toBeTruthy();
  });

  it('while checking, judges the line by substitution into the original equation', async () => {
    const { notebook, send } = await open(checking);
    // A step check against "x = 7" would reject "33 = 33" (no x left); substitution accepts it.
    await send('33 = 33');
    const check = within(notebook).getByLabelText(t.checkBlock);
    expect(marks(check)).toEqual([t.correct]);
  });

  it('while checking, a slip in the check gets a cross', async () => {
    const { notebook, send } = await open(checking);
    await send('33 = 32');
    expect(marks(within(notebook).getByLabelText(t.checkBlock))).toEqual([t.incorrect]);
  });

  it('shows a line that is not a substitution without a mark', async () => {
    const { notebook, send } = await open(checking);
    await send('5 = 5');
    const check = within(notebook).getByLabelText(t.checkBlock);
    expect(check.querySelectorAll('li')).toHaveLength(1);
    expect(marks(check)).toEqual([]);
  });

  it('warns when the server disagrees, and shows the server verdict', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { notebook, reply, send } = await open(solving);
    await send('3x + 12 = 2x + 19');
    reply.resolve({ ...solving, steps: [step('3x + 12 = 2x + 19', false, 'SOLUTION')] });
    await waitFor(() => expect(warn).toHaveBeenCalledTimes(1));
    expect(marks(notebook)).toEqual([t.incorrect]);
  });
});
