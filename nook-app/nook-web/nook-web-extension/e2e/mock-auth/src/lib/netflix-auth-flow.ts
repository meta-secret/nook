export const NETFLIX_MOCK_USERNAME = 'alice@nook.test'
export const NETFLIX_MOCK_PASSWORD = 'extension-fill-password'

export enum NetflixAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type NetflixAuthSubmission = {
  readonly username: string
  readonly password: string
  readonly submittedControl: string
  readonly formMethod: string
  readonly formHasAction: boolean
  readonly auxiliaryActivationCount: number
}

export class NetflixAuthMockScenario {
  static transition(
    submission: NetflixAuthSubmission,
  ): NetflixAuthTransitionKind {
    return submission.username === NETFLIX_MOCK_USERNAME &&
      submission.password === NETFLIX_MOCK_PASSWORD &&
      submission.submittedControl === 'Continue' &&
      submission.formMethod === 'post' &&
      !submission.formHasAction &&
      submission.auxiliaryActivationCount === 0
      ? NetflixAuthTransitionKind.Completed
      : NetflixAuthTransitionKind.Rejected
  }
}
