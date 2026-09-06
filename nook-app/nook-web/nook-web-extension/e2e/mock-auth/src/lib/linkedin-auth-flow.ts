export const LINKEDIN_MOCK_USERNAME = 'alice@nook.test'
export const LINKEDIN_MOCK_PASSWORD = 'extension-fill-password'

export enum LinkedInAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type LinkedInAuthSubmission = {
  readonly username: string
  readonly password: string
  readonly hiddenUsername: string
  readonly hiddenPassword: string
  readonly signInActivationCount: number
  readonly alternativeActivationCount: number
  readonly keepSignedInChecked: boolean
}

export class LinkedInAuthMockScenario {
  static transition(
    submission: LinkedInAuthSubmission,
  ): LinkedInAuthTransitionKind {
    return submission.username === LINKEDIN_MOCK_USERNAME &&
      submission.password === LINKEDIN_MOCK_PASSWORD &&
      submission.hiddenUsername === '' &&
      submission.hiddenPassword === '' &&
      submission.signInActivationCount === 1 &&
      submission.alternativeActivationCount === 0 &&
      submission.keepSignedInChecked
      ? LinkedInAuthTransitionKind.Completed
      : LinkedInAuthTransitionKind.Rejected
  }
}
