import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AttemptView } from '@tutor/shared';
import { useNavigate } from 'react-router';
import { api } from './api';

export const useProblems = () => useQuery({ queryKey: ['problems'], queryFn: api.problems });

export const useAttempt = (id: string) =>
  useQuery({ queryKey: ['attempt', id], queryFn: () => api.attempt(id) });

/** Opens (or resumes) a curriculum problem or a custom equation and navigates to it. */
export function useStartAttempt() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  return useMutation({
    mutationFn: (arg: { problemId: string } | { equation: string }) =>
      'problemId' in arg ? api.startProblem(arg.problemId) : api.startCustom(arg.equation),
    onSuccess: (attempt) => {
      qc.setQueryData(['attempt', attempt.id], attempt);
      navigate(`/learn/${attempt.id}`);
    },
  });
}

/** After a turn the server returns the whole updated attempt; progress and lists go stale. */
export function useAttemptUpdate(id: string) {
  const qc = useQueryClient();
  return (attempt: AttemptView) => {
    qc.setQueryData(['attempt', id], attempt);
    if (attempt.status === 'SOLVED') {
      void qc.invalidateQueries({ queryKey: ['problems'] });
    }
    void qc.invalidateQueries({ queryKey: ['progress'] });
  };
}
