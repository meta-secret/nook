export const CLAUDE_MOCK_EMAIL = 'alice@nook.test'

export enum ClaudeAuthControl {
  ContinueWithEmail = 'continue-with-email',
  ContinueWithGoogle = 'continue-with-google',
  ContinueWithSso = 'continue-with-sso',
  Unrecognized = 'unrecognized',
}

enum ClaudeAuthControlLabel {
  ContinueWithEmail = 'Continue with email',
  ContinueWithGoogle = 'Continue with Google',
  ContinueWithSso = 'Continue with SSO',
}

export enum ClaudeAuthFormActionKind {
  Omitted = 'omitted',
  Authored = 'authored',
}

export enum ClaudeAuthFormMethod {
  Post = 'post',
  Unsupported = 'unsupported',
}

export enum ClaudeAuthInteractionState {
  Untouched = 'untouched',
  Activated = 'activated',
}

export enum ClaudeAuthEmailMatch {
  Matched = 'matched',
  Different = 'different',
}

export enum ClaudeAuthTransitionKind {
  Completed = 'completed',
  Rejected = 'rejected',
}

export type ClaudeAuthSubmission = {
  readonly email: string
  readonly submittedControl: ClaudeAuthControl
  readonly formMethod: ClaudeAuthFormMethod
  readonly formAction: ClaudeAuthFormActionKind
  readonly googleInteraction: ClaudeAuthInteractionState
  readonly ssoInteraction: ClaudeAuthInteractionState
  readonly disclosureInteraction: ClaudeAuthInteractionState
  readonly marketingInteraction: ClaudeAuthInteractionState
}

export class ClaudeAuthMockScenario {
  static submittedControl(label: string): ClaudeAuthControl {
    switch (label) {
      case ClaudeAuthControlLabel.ContinueWithEmail:
        return ClaudeAuthControl.ContinueWithEmail
      case ClaudeAuthControlLabel.ContinueWithGoogle:
        return ClaudeAuthControl.ContinueWithGoogle
      case ClaudeAuthControlLabel.ContinueWithSso:
        return ClaudeAuthControl.ContinueWithSso
      default:
        return ClaudeAuthControl.Unrecognized
    }
  }

  static formMethod(form: HTMLFormElement): ClaudeAuthFormMethod {
    return form.method === 'post'
      ? ClaudeAuthFormMethod.Post
      : ClaudeAuthFormMethod.Unsupported
  }

  static formAction(form: HTMLFormElement): ClaudeAuthFormActionKind {
    return form.hasAttribute('action')
      ? ClaudeAuthFormActionKind.Authored
      : ClaudeAuthFormActionKind.Omitted
  }

  static emailMatch(email: string): ClaudeAuthEmailMatch {
    return email === CLAUDE_MOCK_EMAIL
      ? ClaudeAuthEmailMatch.Matched
      : ClaudeAuthEmailMatch.Different
  }

  static transition(
    submission: ClaudeAuthSubmission,
  ): ClaudeAuthTransitionKind {
    return submission.email === CLAUDE_MOCK_EMAIL &&
      submission.submittedControl === ClaudeAuthControl.ContinueWithEmail &&
      submission.formMethod === ClaudeAuthFormMethod.Post &&
      submission.formAction === ClaudeAuthFormActionKind.Omitted &&
      submission.googleInteraction === ClaudeAuthInteractionState.Untouched &&
      submission.ssoInteraction === ClaudeAuthInteractionState.Untouched &&
      submission.disclosureInteraction ===
        ClaudeAuthInteractionState.Untouched &&
      submission.marketingInteraction === ClaudeAuthInteractionState.Untouched
      ? ClaudeAuthTransitionKind.Completed
      : ClaudeAuthTransitionKind.Rejected
  }
}
