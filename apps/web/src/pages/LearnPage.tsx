import { ArrowLeft } from 'lucide-react';
import { Link, useParams } from 'react-router';
import { ProblemSidebar } from '../components/ProblemSidebar';
import { Workspace } from '../components/Workspace';
import { WelcomePanel } from '../components/WelcomePanel';
import { useI18n } from '../i18n/i18n';

export function LearnPage() {
  const { attemptId } = useParams();
  const { t } = useI18n();

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-5 lg:grid-cols-[18rem_minmax(0,1fr)]">
      {/* On phones the list and the workspace are separate screens. */}
      <aside className={`min-w-0 ${attemptId ? 'hidden lg:block' : 'block'}`}>
        <ProblemSidebar />
      </aside>
      <section className={`min-w-0 ${attemptId ? 'block' : 'hidden lg:block'}`}>
        {attemptId ? (
          <>
            <Link
              to="/learn"
              className="mb-3 inline-flex items-center gap-1 text-sm font-bold text-muted lg:hidden"
            >
              <ArrowLeft size={16} aria-hidden /> {t.problems}
            </Link>
            <Workspace key={attemptId} attemptId={attemptId} />
          </>
        ) : (
          <WelcomePanel />
        )}
      </section>
    </div>
  );
}
