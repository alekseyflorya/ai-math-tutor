import { LOCALES } from '@tutor/shared';
import { useI18n } from '../i18n/i18n';
import { useChangeLocale } from '../lib/auth';

export function LanguageToggle() {
  const { locale } = useI18n();
  const change = useChangeLocale();
  return (
    <div
      className="flex rounded-md border border-line p-0.5 text-xs font-bold"
      role="group"
      aria-label="Language"
    >
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => l !== locale && change.mutate(l)}
          aria-pressed={l === locale}
          className={`rounded px-2 py-1 uppercase transition-colors ${
            l === locale ? 'bg-ink text-paper' : 'text-muted hover:text-text'
          }`}
        >
          {l === 'uk' ? 'УК' : 'EN'}
        </button>
      ))}
    </div>
  );
}
