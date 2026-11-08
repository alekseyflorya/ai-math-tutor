import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { DICTS } from '../i18n/dict';
import { I18nProvider } from '../i18n/i18n';
import { Composer } from './Composer';

const t = DICTS.en;

function setup(onSend: (text: string) => Promise<unknown>) {
  render(
    <I18nProvider>
      <Composer
        busy={false}
        variable="x"
        onSend={onSend}
        onHint={() => {}}
        currentLatex="3(x+4)=2x+19"
      />
    </I18nProvider>,
  );
  return { input: screen.getByLabelText(t.inputPlaceholder), user: userEvent.setup() };
}

describe('Composer', () => {
  it('shows live whether the input will be checked as a step or answered as a question', async () => {
    const { input, user } = setup(() => Promise.resolve());
    await user.type(input, '3x + 12 = 2x + 19');
    expect(screen.getByText(t.inputStep)).toBeTruthy();

    await user.clear(input);
    await user.type(input, 'why do I multiply both terms?');
    expect(screen.getByText(t.inputQuestion)).toBeTruthy();
  });

  it('sends on Enter once and clears the field', async () => {
    const onSend = vi.fn(() => Promise.resolve());
    const { input, user } = setup(onSend);
    await user.type(input, 'x = 7{Enter}');
    expect(onSend).toHaveBeenCalledTimes(1);
    expect(onSend).toHaveBeenCalledWith('x = 7');
    expect((input as HTMLInputElement).value).toBe('');
  });

  it('gives the student their line back when the server rejects it', async () => {
    const { input, user } = setup(() => Promise.reject(new Error('busy')));
    await user.type(input, '3x + 12 = 2x + 19{Enter}');
    await vi.waitFor(() => expect((input as HTMLInputElement).value).toBe('3x + 12 = 2x + 19'));
  });
});
