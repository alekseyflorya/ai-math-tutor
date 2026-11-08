import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Locale, UserView } from '@tutor/shared';
import { useEffect } from 'react';
import { useI18n } from '../i18n/i18n';
import { api, ApiError } from './api';

export function useMe() {
  return useQuery<UserView | null>({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.me();
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60_000,
    retry: false,
  });
}

/** Keeps the UI language in sync with the account (the tutor answers in the account's language). */
export function useLocaleSync(user: UserView | null | undefined) {
  const { locale, setLocale } = useI18n();
  useEffect(() => {
    if (user && user.locale !== locale) setLocale(user.locale);
    // Only on login / user change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
}

export function useChangeLocale() {
  const { setLocale } = useI18n();
  const qc = useQueryClient();
  const me = qc.getQueryData<UserView | null>(['me']);
  return useMutation({
    mutationFn: async (locale: Locale) => {
      setLocale(locale);
      if (me) return api.setLocale(locale);
      return null;
    },
    onSuccess: (user) => {
      if (user) {
        qc.setQueryData(['me'], user);
        void qc.invalidateQueries({ queryKey: ['problems'] });
      }
    },
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: api.logout,
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(['me'], null);
    },
  });
}
