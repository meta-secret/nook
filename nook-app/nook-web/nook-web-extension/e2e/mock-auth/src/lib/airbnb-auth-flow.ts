export const AIRBNB_MOCK_IDENTITY = 'alice@nook.test'

export enum AirbnbAuthControl {
  Continue = 'continue',
  ContinueWithGoogle = 'continue-with-google',
  ContinueWithApple = 'continue-with-apple',
  Unrecognized = 'unrecognized',
}

export enum AirbnbAuthInteractionState {
  Untouched = 'untouched',
  Activated = 'activated',
  Repeated = 'repeated',
}

export enum AirbnbAuthIdentityMatch {
  Matched = 'matched',
  Different = 'different',
}

export enum AirbnbAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export enum AirbnbAuthPresentationState {
  Ready = 'ready',
  Rejected = 'rejected',
}

export type AirbnbAuthSubmission = {
  readonly identity: string
  readonly submittedControl: AirbnbAuthControl
  readonly primaryActivation: AirbnbAuthInteractionState
  readonly alternativeActivationCount: number
}

export class AirbnbAuthMockScenario {
  static submittedControl(label: string): AirbnbAuthControl {
    switch (label.trim()) {
      case 'Continue':
        return AirbnbAuthControl.Continue
      case 'Continue with Google':
        return AirbnbAuthControl.ContinueWithGoogle
      case 'Continue with Apple':
        return AirbnbAuthControl.ContinueWithApple
      default:
        return AirbnbAuthControl.Unrecognized
    }
  }

  static nextActivation(
    current: AirbnbAuthInteractionState,
  ): AirbnbAuthInteractionState {
    return current === AirbnbAuthInteractionState.Untouched
      ? AirbnbAuthInteractionState.Activated
      : AirbnbAuthInteractionState.Repeated
  }

  static identityMatch(identity: string): AirbnbAuthIdentityMatch {
    return identity === AIRBNB_MOCK_IDENTITY
      ? AirbnbAuthIdentityMatch.Matched
      : AirbnbAuthIdentityMatch.Different
  }

  static transition(
    submission: AirbnbAuthSubmission,
  ): AirbnbAuthTransitionKind {
    return submission.identity === AIRBNB_MOCK_IDENTITY &&
      submission.submittedControl === AirbnbAuthControl.Continue &&
      submission.primaryActivation === AirbnbAuthInteractionState.Activated &&
      submission.alternativeActivationCount === 0
      ? AirbnbAuthTransitionKind.Completed
      : AirbnbAuthTransitionKind.Rejected
  }
}
