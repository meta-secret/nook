export const MICROSOFT_CONSUMER_MOCK_USERNAME = 'alice@nook.test'

export enum MicrosoftConsumerAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type MicrosoftConsumerAuthSubmission = {
  readonly username: string
  readonly submittedControl: string
  readonly closeActivationCount: number
  readonly recoveryActivationCount: number
  readonly outsideActivationCount: number
  readonly unrelatedFormSubmissionCount: number
}

export class MicrosoftConsumerAuthMockScenario {
  static transition(
    submission: MicrosoftConsumerAuthSubmission,
  ): MicrosoftConsumerAuthTransitionKind {
    return submission.username === MICROSOFT_CONSUMER_MOCK_USERNAME &&
      submission.submittedControl === 'Next' &&
      submission.closeActivationCount === 0 &&
      submission.recoveryActivationCount === 0 &&
      submission.outsideActivationCount === 0 &&
      submission.unrelatedFormSubmissionCount === 0
      ? MicrosoftConsumerAuthTransitionKind.Completed
      : MicrosoftConsumerAuthTransitionKind.Rejected
  }
}
