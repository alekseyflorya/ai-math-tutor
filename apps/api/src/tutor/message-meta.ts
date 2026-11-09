import type {
  ErrorType,
  FeedbackMeta,
  FollowUpMeta,
  HintMeta,
  MessageMeta,
  NoticeMeta,
} from '@tutor/shared';

/** Typed constructors for message meta; the shapes are the contracts in @tutor/shared. */
export const meta = {
  hint: (hintLevel: 1 | 2 | 3, extra: Omit<HintMeta, 'hintLevel'> = {}): HintMeta => ({
    hintLevel,
    ...extra,
  }),
  feedback: (
    fixedErrorType: ErrorType | null,
    extra: Pick<FeedbackMeta, 'checkRequested' | 'checkStep'> = {},
  ): FeedbackMeta => ({ correct: true, fixedErrorType, ...extra }),
  celebration: (checked: boolean): MessageMeta<'CELEBRATION'> => ({ solved: true, checked }),
  followUp: (m: FollowUpMeta): FollowUpMeta => m,
  notice: (m: NoticeMeta): NoticeMeta => m,
  understood: (): MessageMeta<'CHAT'> => ({ understood: true }),
};
