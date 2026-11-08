import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Layout } from './components/Layout';
import { useLocaleSync, useMe } from './lib/auth';
import { LearnPage } from './pages/LearnPage';
import { LoginPage } from './pages/LoginPage';
import { ProgressPage } from './pages/ProgressPage';

export function App() {
  const { data: user, isLoading } = useMe();
  const location = useLocation();
  useLocaleSync(user);

  if (isLoading) {
    return <div className="graph-paper min-h-dvh" aria-busy="true" />;
  }

  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="*"
          element={<Navigate to="/login" replace state={{ from: location.pathname }} />}
        />
      </Routes>
    );
  }

  return (
    <Routes>
      <Route element={<Layout user={user} />}>
        <Route path="/learn" element={<LearnPage />} />
        <Route path="/learn/:attemptId" element={<LearnPage />} />
        <Route path="/progress" element={<ProgressPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/learn" replace />} />
    </Routes>
  );
}
