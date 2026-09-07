export const BOOKING_MOCK_EMAIL = 'alice@nook.test'

export enum BookingAuthControl {
  ContinueWithEmail = 'continue-with-email',
  ContinueWithGoogle = 'continue-with-google',
  ContinueWithApple = 'continue-with-apple',
  ContinueWithFacebook = 'continue-with-facebook',
  RecoverAccount = 'recover-account',
  Unrecognized = 'unrecognized',
}

enum BookingAuthControlLabel {
  ContinueWithEmail = 'Continue with email',
  SignInWithGoogle = 'Sign in with Google',
  SignInWithApple = 'Sign in with Apple',
  SignInWithFacebook = 'Sign in with Facebook',
  RecoverAccount = 'Recover your account',
}

export enum BookingAuthInteractionState {
  Untouched = 'untouched',
  Activated = 'activated',
}

export enum BookingAuthPrimaryActivationState {
  Untouched = 'untouched',
  Activated = 'activated',
  Repeated = 'repeated',
}

export enum BookingAuthEmailMatch {
  Matched = 'matched',
  Different = 'different',
}

export enum BookingAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export enum BookingAuthPresentationState {
  Ready = 'ready',
  Rejected = 'rejected',
}

export type BookingAuthSubmission = {
  readonly email: string
  readonly submittedControl: BookingAuthControl
  readonly primaryActivation: BookingAuthPrimaryActivationState
  readonly googleInteraction: BookingAuthInteractionState
  readonly appleInteraction: BookingAuthInteractionState
  readonly facebookInteraction: BookingAuthInteractionState
  readonly recoveryInteraction: BookingAuthInteractionState
  readonly brandInteraction: BookingAuthInteractionState
  readonly disclosureInteraction: BookingAuthInteractionState
  readonly helpInteraction: BookingAuthInteractionState
  readonly languageInteraction: BookingAuthInteractionState
}

export class BookingAuthMockScenario {
  static submittedControl(label: string): BookingAuthControl {
    switch (label.trim()) {
      case BookingAuthControlLabel.ContinueWithEmail:
        return BookingAuthControl.ContinueWithEmail
      case BookingAuthControlLabel.SignInWithGoogle:
        return BookingAuthControl.ContinueWithGoogle
      case BookingAuthControlLabel.SignInWithApple:
        return BookingAuthControl.ContinueWithApple
      case BookingAuthControlLabel.SignInWithFacebook:
        return BookingAuthControl.ContinueWithFacebook
      case BookingAuthControlLabel.RecoverAccount:
        return BookingAuthControl.RecoverAccount
      default:
        return BookingAuthControl.Unrecognized
    }
  }

  static nextPrimaryActivation(
    current: BookingAuthPrimaryActivationState,
  ): BookingAuthPrimaryActivationState {
    return current === BookingAuthPrimaryActivationState.Untouched
      ? BookingAuthPrimaryActivationState.Activated
      : BookingAuthPrimaryActivationState.Repeated
  }

  static emailMatch(email: string): BookingAuthEmailMatch {
    return email === BOOKING_MOCK_EMAIL
      ? BookingAuthEmailMatch.Matched
      : BookingAuthEmailMatch.Different
  }

  static transition(
    submission: BookingAuthSubmission,
  ): BookingAuthTransitionKind {
    return submission.email === BOOKING_MOCK_EMAIL &&
      submission.submittedControl === BookingAuthControl.ContinueWithEmail &&
      submission.primaryActivation ===
        BookingAuthPrimaryActivationState.Activated &&
      submission.googleInteraction === BookingAuthInteractionState.Untouched &&
      submission.appleInteraction === BookingAuthInteractionState.Untouched &&
      submission.facebookInteraction ===
        BookingAuthInteractionState.Untouched &&
      submission.recoveryInteraction ===
        BookingAuthInteractionState.Untouched &&
      submission.brandInteraction === BookingAuthInteractionState.Untouched &&
      submission.disclosureInteraction ===
        BookingAuthInteractionState.Untouched &&
      submission.helpInteraction === BookingAuthInteractionState.Untouched &&
      submission.languageInteraction === BookingAuthInteractionState.Untouched
      ? BookingAuthTransitionKind.Completed
      : BookingAuthTransitionKind.Rejected
  }
}
