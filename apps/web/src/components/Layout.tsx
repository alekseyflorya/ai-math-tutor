import type { UserView } from '@tutor/shared';
import { BarChart3, BookOpen, LogOut } from 'lucide-react';
import { NavLink, Outlet } from 'react-router';
import { useI18n } from '../i18n/i18n';
import { useLogout } from '../lib/auth';
import { LanguageToggle } from './LanguageToggle';
import { Logo } from './Logo';

export function Layout({ user }: { user: UserView }) {
  const { t } = useI18n();
  const logout = useLogout();
  const link = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm font-bold transition-colors ${
      isActive ? 'bg-ink-soft text-ink' : 'text-muted hover:text-text'
    }`;

  return (
    <div className="flex min-h-dvh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-paper/90 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4">
          <Logo compact />
          <nav className="ml-2 flex items-center gap-1" aria-label="Main">
            <NavLink to="/learn" className={link}>
              <BookOpen size={16} aria-hidden /> <span className="hidden sm:inline">{t.learn}</span>
            </NavLink>
            <NavLink to="/progress" className={link}>
              <BarChart3 size={16} aria-hidden />{' '}
              <span className="hidden sm:inline">{t.progress}</span>
            </NavLink>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <LanguageToggle />
            <span
              className="hidden max-w-40 truncate text-sm text-muted md:inline"
              title={user.email ?? undefined}
            >
              {user.name}
              {user.isDemo && (
                <span className="ml-1.5 rounded bg-pen-soft px-1.5 py-0.5 text-xs font-bold text-pen">
                  {t.demoBadge}
                </span>
              )}
            </span>
            <button
              type="button"
              onClick={() => logout.mutate()}
              className="rounded-md p-2 text-muted transition-colors hover:bg-paper-2 hover:text-text"
              aria-label={t.logout}
              title={t.logout}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-5">
        <Outlet />
      </main>
    </div>
  );
}
