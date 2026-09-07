export const TESLA_MOCK_EMAIL = 'alice@nook.test'

export enum TeslaAuthControl {
  Next = 'next',
  TroubleSigningIn = 'trouble-signing-in',
  CreateAccount = 'create-account',
  Unrecognized = 'unrecognized',
}

enum TeslaAuthControlLabel {
  Next = 'Next',
  TroubleSigningIn = 'Trouble Signing In?',
  CreateAccount = 'Create Account',
}

export enum TeslaAuthInteractionState {
  Untouched = 'untouched',
  Activated = 'activated',
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
  readonly troubleInteraction: TeslaAuthInteractionState
  readonly createAccountInteraction: TeslaAuthInteractionState
  readonly languageInteraction: TeslaAuthInteractionState
  readonly homeInteraction: TeslaAuthInteractionState
  readonly privacyInteraction: TeslaAuthInteractionState
  readonly contactInteraction: TeslaAuthInteractionState
}

export class TeslaAuthMockScenario {
  static submittedControl(label: string): TeslaAuthControl {
    switch (label.trim()) {
      case TeslaAuthControlLabel.Next:
        return TeslaAuthControl.Next
      case TeslaAuthControlLabel.TroubleSigningIn:
        return TeslaAuthControl.TroubleSigningIn
      case TeslaAuthControlLabel.CreateAccount:
        return TeslaAuthControl.CreateAccount
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

  static transition(submission: TeslaAuthSubmission): TeslaAuthTransitionKind {
    return submission.email === TESLA_MOCK_EMAIL &&
      submission.submittedControl === TeslaAuthControl.Next &&
      submission.primaryActivation ===
        TeslaAuthPrimaryActivationState.Activated &&
      submission.troubleInteraction === TeslaAuthInteractionState.Untouched &&
      submission.createAccountInteraction ===
        TeslaAuthInteractionState.Untouched &&
      submission.languageInteraction === TeslaAuthInteractionState.Untouched &&
      submission.homeInteraction === TeslaAuthInteractionState.Untouched &&
      submission.privacyInteraction === TeslaAuthInteractionState.Untouched &&
      submission.contactInteraction === TeslaAuthInteractionState.Untouched
      ? TeslaAuthTransitionKind.Completed
      : TeslaAuthTransitionKind.Rejected
  }
}
