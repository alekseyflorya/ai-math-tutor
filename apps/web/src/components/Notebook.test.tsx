import { render, screen } from '@testing-library/react';
import type { AttemptView, StepView } from '@tutor/shared';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../i18n/dict';
import { I18nProvider } from '../i18n/i18n';
import { Notebook } from './Notebook';

const t = DICTS.en;
const step = (input: string, phase: StepView['phase'], isCorrect = true): StepView => ({
  id: input,
  input,
  latex: input,
  isCorrect,
  index: 0,
  phase,
});
const attempt = (over: Partial<AttemptView>): AttemptView =>
  ({
    latex: '3(x+4)=2x+19',
    mode: 'SOLVING',
    check: null,
    steps: [],
    ...over,
  }) as AttemptView;

describe('Notebook', () => {
  it('shows no check block while solving', () => {
    render(
      <I18nProvider>
        <Notebook attempt={attempt({ steps: [step('3x+12=2x+19', 'SOLUTION')] })} />
      </I18nProvider>,
    );
    expect(screen.queryByLabelText(t.checkBlock)).toBeNull();
  });

  it('puts the check under its own heading, with the outcome', () => {
    render(
      <I18nProvider>
        <Notebook
          attempt={attempt({
            check: 'DONE',
            steps: [step('x=7', 'SOLUTION'), step('33=32', 'CHECK', false), step('33=33', 'CHECK')],
          })}
        />
      </I18nProvider>,
    );
    const block = screen.getByLabelText(t.checkBlock);
    expect(block.textContent).toContain(t.checkDone);
    expect(block.querySelectorAll('li')).toHaveLength(2);
  });
});
