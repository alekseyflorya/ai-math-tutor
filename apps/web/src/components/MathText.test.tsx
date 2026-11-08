import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MathText } from './MathText';

describe('MathText (tutor messages from the model)', () => {
  it('renders $math$ with KaTeX, `code` and **bold**', () => {
    const { container } = render(
      <MathText text="Look at $3(x+4)$: **every** term, e.g. `3x + 12`." />,
    );
    expect(container.querySelector('.katex')).not.toBeNull();
    expect(container.querySelector('strong')?.textContent).toBe('every');
    expect(container.querySelector('code')?.textContent).toBe('3x + 12');
  });

  it('never injects HTML that appears in the text', () => {
    const { container } = render(
      <MathText text={'<img src=x onerror="alert(1)"> and **<b>bold</b>**'} />,
    );
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('b')).toBeNull();
    expect(container.textContent).toContain('<img src=x onerror="alert(1)">');
  });
});
