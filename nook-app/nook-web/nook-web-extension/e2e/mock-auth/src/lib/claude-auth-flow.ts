export const CLAUDE_MOCK_EMAIL = 'alice@nook.test'

export enum ClaudeAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type ClaudeAuthSubmission = {
  readonly email: string
  readonly submittedControl: string
  readonly formMethod: string
  readonly formHasAction: boolean
  readonly googleActivationCount: number
  readonly ssoActivationCount: number
  readonly disclosureActivationCount: number
  readonly marketingActivationCount: number
}

export class ClaudeAuthMockScenario {
  static transition(
    submission: ClaudeAuthSubmission,
  ): ClaudeAuthTransitionKind {
    return submission.email === CLAUDE_MOCK_EMAIL &&
      submission.submittedControl === 'Continue with email' &&
      submission.formMethod === 'post' &&
      !submission.formHasAction &&
      submission.googleActivationCount === 0 &&
      submission.ssoActivationCount === 0 &&
      submission.disclosureActivationCount === 0 &&
      submission.marketingActivationCount === 0
      ? ClaudeAuthTransitionKind.Completed
      : ClaudeAuthTransitionKind.Rejected
  }
}
