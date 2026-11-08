import { Link } from 'react-router';
import { useI18n } from '../i18n/i18n';

export function Logo({ compact }: { compact?: boolean }) {
  const { t } = useI18n();
  return (
    <Link to="/learn" className="flex items-center gap-2 font-serif font-bold text-text">
      <svg width="28" height="28" viewBox="0 0 64 64" aria-hidden>
        <rect width="64" height="64" rx="14" className="fill-surface stroke-line" strokeWidth="2" />
        <path
          d="M8 22h48M8 34h48M8 46h48M22 8v48M34 8v48M46 8v48"
          className="stroke-grid"
          strokeWidth="2"
        />
        <path
          d="M14 33l9 10 22-24"
          fill="none"
          className="stroke-pen"
          strokeWidth="6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className={compact ? 'hidden text-base sm:inline' : 'text-lg'}>{t.appName}</span>
    </Link>
  );
}
