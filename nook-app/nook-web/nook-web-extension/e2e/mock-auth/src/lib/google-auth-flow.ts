export const GOOGLE_AUTH_MOCK_USERNAME = 'alice@nook.test'
export const GOOGLE_AUTH_MOCK_PASSWORD = 'extension-fill-password'

export enum GoogleAuthMockStep {
  Identifier = 'identifier',
  Password = 'password',
}

export enum GoogleAuthMockTransitionKind {
  Advanced = 'advanced',
  Completed = 'completed',
  Rejected = 'rejected',
}

export type GoogleAuthMockState = {
  readonly step: GoogleAuthMockStep
  readonly identifier: string
}

export type GoogleAuthMockSubmission = {
  readonly state: GoogleAuthMockState
  readonly submitter: string
  readonly identifier: string
  readonly password: string
  readonly hiddenPassword: string
}

export type GoogleAuthMockTransition = {
  readonly kind: GoogleAuthMockTransitionKind
  readonly state: GoogleAuthMockState
}

export class GoogleAuthMockScenario {
  static initialState(): GoogleAuthMockState {
    return { step: GoogleAuthMockStep.Identifier, identifier: '' }
  }

  static transition(
    submission: GoogleAuthMockSubmission,
  ): GoogleAuthMockTransition {
    const { state, submitter, identifier, password, hiddenPassword } =
      submission
    if (hiddenPassword !== '') {
      return { kind: GoogleAuthMockTransitionKind.Rejected, state }
    }
    if (state.step === GoogleAuthMockStep.Identifier) {
      if (
        submitter !== 'identifier-next' ||
        identifier !== GOOGLE_AUTH_MOCK_USERNAME
      ) {
        return { kind: GoogleAuthMockTransitionKind.Rejected, state }
      }
      return {
        kind: GoogleAuthMockTransitionKind.Advanced,
        state: { step: GoogleAuthMockStep.Password, identifier },
      }
    }
    if (
      submitter === 'password-next' &&
      state.identifier === GOOGLE_AUTH_MOCK_USERNAME &&
      password === GOOGLE_AUTH_MOCK_PASSWORD
    ) {
      return { kind: GoogleAuthMockTransitionKind.Completed, state }
    }
    return { kind: GoogleAuthMockTransitionKind.Rejected, state }
  }
}
