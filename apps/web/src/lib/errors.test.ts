import { API_ERROR_CODES } from '@tutor/shared';
import { describe, expect, it } from 'vitest';
import { DICTS } from '../i18n/dict';
import { ApiError } from './api';
import { errorText, UserFacingError } from './errors';

describe('errorText', () => {
  it('translates API errors by code and never shows the server’s English message', () => {
    const e = new ApiError(409, 'BUSY', 'The tutor is still answering your previous message');
    expect(errorText(e, DICTS.uk)).toBe(DICTS.uk.apiErrors.BUSY);
    expect(errorText(e, DICTS.en)).toBe(DICTS.en.apiErrors.BUSY);
  });

  it('falls back to a generic message for unknown codes and network failures', () => {
    expect(errorText(new ApiError(418, 'TEAPOT', 'I am a teapot'), DICTS.uk)).toBe(
      DICTS.uk.errorGeneric,
    );
    expect(errorText(new TypeError('Failed to fetch'), DICTS.en)).toBe(DICTS.en.errorGeneric);
  });

  it('passes through messages already written for the student', () => {
    expect(errorText(new UserFacingError(DICTS.uk.formInvalidEmail), DICTS.uk)).toBe(
      DICTS.uk.formInvalidEmail,
    );
  });

  it('has a non-empty translation of every API error code in both languages', () => {
    for (const code of API_ERROR_CODES) {
      expect(DICTS.en.apiErrors[code]).toBeTruthy();
      expect(DICTS.uk.apiErrors[code]).toBeTruthy();
    }
  });
});
