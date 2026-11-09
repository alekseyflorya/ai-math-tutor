import type {
  ApiErrorBody,
  AttemptSummary,
  AttemptView,
  Locale,
  LoginInput,
  ProblemView,
  ProgressView,
  RegisterInput,
  UserView,
} from '@tutor/shared';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Same-origin JSON client. The session is an httpOnly cookie, so there is no token
 * handling in JS at all; every write is sent as JSON (the API rejects anything else).
 */
async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: method === 'GET' ? undefined : { 'Content-Type': 'application/json' },
    body: method === 'GET' ? undefined : JSON.stringify(body ?? {}),
  });
  if (res.status === 204) return undefined as T;
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const err = (data ?? {}) as Partial<ApiErrorBody>;
    throw new ApiError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText);
  }
  return data as T;
}

export const api = {
  me: () => request<UserView>('GET', '/auth/me'),
  login: (input: LoginInput) => request<UserView>('POST', '/auth/login', input),
  register: (input: RegisterInput) => request<UserView>('POST', '/auth/register', input),
  demo: (locale: Locale) => request<UserView>('POST', '/auth/demo', { locale }),
  logout: () => request<void>('POST', '/auth/logout'),
  setLocale: (locale: Locale) => request<UserView>('PATCH', '/auth/me', { locale }),

  problems: () => request<ProblemView[]>('GET', '/problems'),
  attempts: () => request<AttemptSummary[]>('GET', '/attempts'),
  customAttempts: () => request<AttemptSummary[]>('GET', '/attempts?kind=custom'),
  attempt: (id: string) => request<AttemptView>('GET', `/attempts/${id}`),
  startProblem: (problemId: string, restart = false) =>
    request<AttemptView>('POST', '/attempts', { problemId, restart }),
  startCustom: (equation: string) => request<AttemptView>('POST', '/attempts', { equation }),
  send: (id: string, text: string) =>
    request<AttemptView>('POST', `/attempts/${id}/messages`, { text }),
  hint: (id: string) => request<AttemptView>('POST', `/attempts/${id}/hint`),
  skipCheck: (id: string) => request<AttemptView>('POST', `/attempts/${id}/skip-check`),

  progress: () => request<ProgressView>('GET', '/progress'),
};
