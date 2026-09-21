export const AMAZON_MOCK_EMAIL = 'alice@nook.test'
export const AMAZON_METADATA_IDENTITY =
  'appAction=SIGNIN_CLAIM_COLLECT|subPageType=FullPageUnifiedClaimCollect|claimCollectionWorkflow=unified|metadata1=captured-metadata|claimType=|countryCode=|isServerSideRouting=true|emailOnlyClaim=false|webAuthnGetArbForAutofill=mock-webauthn-arb|webAuthnGetParametersForAutofill=mock-webauthn-parameters|webAuthnChallengeIdForAutofill=mock-webauthn-challenge|openid.ns=http://specs.openid.net/auth/2.0|openid.mode=checkid_setup|openid.return_to=https://www.amazon.com/?ref_=nav_ya_signin|openid.assoc_handle=usflex|openid.identity=http://specs.openid.net/auth/2.0/identifier_select|openid.claimed_id=http://specs.openid.net/auth/2.0/identifier_select|signalUnknownCredentialUnifiedAuthWeblabActive=true|anti-csrftoken-a2z=mock-csrf'

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
