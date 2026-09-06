export const X_AUTH_MOCK_USERNAME = 'alice@nook.test'
export const X_AUTH_MOCK_LOGIN_PATH = '/i/flow/login'
export const X_AUTH_MOCK_ONBOARDING_PATH = '/i/jf/onboarding/web?mode=login'

export enum XAuthMockTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type XAuthMockSubmission = {
  readonly username: string
  readonly hiddenPassword: string
  readonly alternativeActivationCount: number
  readonly continueActivationCount: number
  readonly submitterPresent: boolean
}

export class XAuthMockScenario {
  static transition(submission: XAuthMockSubmission): XAuthMockTransitionKind {
    return submission.username === X_AUTH_MOCK_USERNAME &&
      submission.hiddenPassword === '' &&
      submission.alternativeActivationCount === 0 &&
      submission.continueActivationCount === 0 &&
      !submission.submitterPresent
      ? XAuthMockTransitionKind.Completed
      : XAuthMockTransitionKind.Rejected
  }
}
