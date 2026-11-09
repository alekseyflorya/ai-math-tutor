import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserView } from '@tutor/shared';
import { MemoryRouter, useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { App } from './App';
import { DICTS } from './i18n/dict';
import { I18nProvider } from './i18n/i18n';

const t = DICTS.en;
const user: UserView = { id: 'u1', name: 'Demo', email: null, isDemo: true, locale: 'en' };
let loggedIn = true;

// Plain functions, not vi.fn: what the server answers depends on whether we are logged in.
vi.mock('./lib/api', async (importOriginal) => {
  const real = await importOriginal<typeof import('./lib/api')>();
  return {
    ...real,
    api: {
      ...real.api,
      me: () =>
        loggedIn ? Promise.resolve(user) : Promise.reject(new real.ApiError(401, 'X', 'no')),
      logout: () => {
        loggedIn = false;
        return Promise.resolve();
      },
      // Pages stay on their skeletons: only the header (and its Log out) matters here.
      progress: () => new Promise(() => {}),
      problems: () => new Promise(() => {}),
      customAttempts: () => new Promise(() => {}),
      attempt: () => new Promise(() => {}),
    },
  };
});

function Where() {
  return <span data-testid="path">{useLocation().pathname}</span>;
}

describe('logging out', () => {
  // Log out lives in the shared header, so it must work the same from every page.
  it.each(['/learn', '/learn/a1', '/progress'])('opens the login page from %s', async (path) => {
    loggedIn = true;
    render(
      <QueryClientProvider
        client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
      >
        <I18nProvider>
          <MemoryRouter initialEntries={[path]}>
            <App />
            <Where />
          </MemoryRouter>
        </I18nProvider>
      </QueryClientProvider>,
    );
    await userEvent.setup().click(await screen.findByRole('button', { name: t.logout }));

    await waitFor(() => expect(screen.getByTestId('path').textContent).toBe('/login'));
    expect(await screen.findByRole('button', { name: t.signIn })).toBeTruthy();
    expect(screen.queryByRole('button', { name: t.logout })).toBeNull();
  });
});
