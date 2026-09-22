export const TESLA_MOCK_EMAIL = 'alice@nook.test'
export const TESLA_MOCK_PASSWORD = 'extension-fill-password'

export enum TeslaAuthControl {
  Next = 'next',
  SignIn = 'sign-in',
  TroubleSigningIn = 'trouble-signing-in',
  Cancel = 'cancel',
  Unrecognized = 'unrecognized',
}

enum TeslaAuthControlLabel {
  Next = 'Next',
  SignIn = 'Sign In',
  TroubleSigningIn = 'Trouble Signing In?',
  Cancel = 'Cancel',
}

export enum TeslaAuthPrimaryActivationState {
  Untouched = 'untouched',
  Activated = 'activated',
  Repeated = 'repeated',
}

export enum TeslaAuthEmailMatch {
  Matched = 'matched',
  Different = 'different',
}

export enum TeslaAuthPasswordMatch {
  Matched = 'matched',
  Different = 'different',
}

export enum TeslaAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export enum TeslaAuthPresentationState {
  Ready = 'ready',
  Rejected = 'rejected',
}

export type TeslaAuthSubmission = {
  readonly email: string
  readonly submittedControl: TeslaAuthControl
  readonly primaryActivation: TeslaAuthPrimaryActivationState
  readonly auxiliaryActivationCount: number
}

export type TeslaAuthPasswordSubmission = {
  readonly password: string
  readonly submittedControl: TeslaAuthControl
  readonly primaryActivation: TeslaAuthPrimaryActivationState
  readonly auxiliaryActivationCount: number
}

export class TeslaAuthMockScenario {
  static submittedControl(label: string): TeslaAuthControl {
    switch (label.trim()) {
      case TeslaAuthControlLabel.Next:
        return TeslaAuthControl.Next
      case TeslaAuthControlLabel.SignIn:
        return TeslaAuthControl.SignIn
      case TeslaAuthControlLabel.TroubleSigningIn:
        return TeslaAuthControl.TroubleSigningIn
      case TeslaAuthControlLabel.Cancel:
        return TeslaAuthControl.Cancel
      default:
        return TeslaAuthControl.Unrecognized
    }
  }

  static nextPrimaryActivation(
    current: TeslaAuthPrimaryActivationState,
  ): TeslaAuthPrimaryActivationState {
    return current === TeslaAuthPrimaryActivationState.Untouched
      ? TeslaAuthPrimaryActivationState.Activated
      : TeslaAuthPrimaryActivationState.Repeated
  }

  static emailMatch(email: string): TeslaAuthEmailMatch {
    return email === TESLA_MOCK_EMAIL
      ? TeslaAuthEmailMatch.Matched
      : TeslaAuthEmailMatch.Different
  }

  static passwordMatch(password: string): TeslaAuthPasswordMatch {
    return password === TESLA_MOCK_PASSWORD
      ? TeslaAuthPasswordMatch.Matched
      : TeslaAuthPasswordMatch.Different
  }

  static transition(submission: TeslaAuthSubmission): TeslaAuthTransitionKind {
    return submission.email === TESLA_MOCK_EMAIL &&
      submission.submittedControl === TeslaAuthControl.Next &&
      submission.primaryActivation ===
        TeslaAuthPrimaryActivationState.Activated &&
      submission.auxiliaryActivationCount === 0
      ? TeslaAuthTransitionKind.Completed
      : TeslaAuthTransitionKind.Rejected
  }

  static passwordTransition(
    submission: TeslaAuthPasswordSubmission,
  ): TeslaAuthTransitionKind {
    return submission.password === TESLA_MOCK_PASSWORD &&
      submission.submittedControl === TeslaAuthControl.SignIn &&
      submission.primaryActivation ===
        TeslaAuthPrimaryActivationState.Activated &&
      submission.auxiliaryActivationCount === 0
      ? TeslaAuthTransitionKind.Completed
      : TeslaAuthTransitionKind.Rejected
  }
}
