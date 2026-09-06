export const AMAZON_MOCK_EMAIL = 'alice@nook.test'
export const AMAZON_METADATA_IDENTITY =
  'appAction=SIGNIN_PWD_COLLECT|openid.mode=checkid_setup'

export enum AmazonAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type AmazonAuthSubmission = {
  readonly email: string
  readonly hiddenPassword: string
  readonly submittedControl: string
  readonly metadataIdentity: string
  readonly backdetectSubmissionCount: number
  readonly alternativeActivationCount: number
}

export class AmazonAuthMockScenario {
  static transition(
    submission: AmazonAuthSubmission,
  ): AmazonAuthTransitionKind {
    return submission.email === AMAZON_MOCK_EMAIL &&
      submission.hiddenPassword === '' &&
      submission.submittedControl === 'Continue' &&
      submission.metadataIdentity === AMAZON_METADATA_IDENTITY &&
      submission.backdetectSubmissionCount === 0 &&
      submission.alternativeActivationCount === 0
      ? AmazonAuthTransitionKind.Completed
      : AmazonAuthTransitionKind.Rejected
  }
}
