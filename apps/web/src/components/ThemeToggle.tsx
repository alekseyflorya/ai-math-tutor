import { Monitor, Moon, Sun } from 'lucide-react';
import { useI18n } from '../i18n/i18n';
import { useTheme } from '../lib/theme';

const ICONS = { system: Monitor, light: Sun, dark: Moon } as const;

/** One button that cycles system → light → dark (keeps the header compact on phones). */
export function ThemeToggle() {
  const { t } = useI18n();
  const { theme, cycle } = useTheme();
  const Icon = ICONS[theme];
  const label = `${t.theme}: ${t.themeNames[theme]}`;
  return (
    <button
      type="button"
      onClick={cycle}
      className="rounded-md border border-line p-1.5 text-muted transition-colors hover:text-text"
      aria-label={label}
      title={label}
    >
      <Icon size={16} aria-hidden />
    </button>
  );
}
