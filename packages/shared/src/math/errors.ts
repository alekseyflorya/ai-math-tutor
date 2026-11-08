export type MathErrorCode =
  | 'EMPTY'
  | 'TOO_LONG'
  | 'NOT_AN_EQUATION'
  | 'MULTIPLE_EQUALS'
  | 'SYNTAX'
  | 'UNSUPPORTED'
  | 'MULTIPLE_VARIABLES'
  | 'WRONG_VARIABLE'
  | 'NONLINEAR'
  | 'DIVISION_BY_ZERO';

/** A problem with what the student typed: shown to them, never a server error. */
export class MathInputError extends Error {
  constructor(
    readonly code: MathErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'MathInputError';
  }
}
