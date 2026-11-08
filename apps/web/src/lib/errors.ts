import { isApiErrorCode } from '@tutor/shared';
import type { Dict } from '../i18n/dict';
import { ApiError } from './api';

/** An error whose message is already written for the student (e.g. form validation). */
export class UserFacingError extends Error {}

/**
 * What to show the student for any failure. API errors are translated by their stable code;
 * the server's English `message` is never shown, so the UI stays in the chosen language.
 */
export function errorText(e: unknown, t: Dict): string {
  if (e instanceof UserFacingError) return e.message;
  if (e instanceof ApiError && isApiErrorCode(e.code)) return t.apiErrors[e.code];
  return t.errorGeneric;
}
