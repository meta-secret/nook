export const APPLE_AUTH_MOCK_USERNAME = 'alice@nook.test'
export const APPLE_AUTH_MOCK_PASSWORD = 'extension-fill-password'

export enum AppleAuthMockStep {
  Identifier = 'identifier',
  Password = 'password',
}

export enum AppleAuthMockTransitionKind {
  Advanced = 'advanced',
  Completed = 'completed',
  Rejected = 'rejected',
}

export type AppleAuthMockState = {
  readonly step: AppleAuthMockStep
  readonly identifier: string
}

export type AppleAuthMockSubmission = {
  readonly state: AppleAuthMockState
  readonly submitter: string
  readonly identifier: string
  readonly password: string
  readonly decoyPassword: string
}

export type AppleAuthMockTransition = {
  readonly kind: AppleAuthMockTransitionKind
  readonly state: AppleAuthMockState
}

export class AppleAuthMockScenario {
  static initialState(): AppleAuthMockState {
    return { step: AppleAuthMockStep.Identifier, identifier: '' }
  }

  static authorizationFrameSource(pageUrl: string): string {
    const authOrigin = new URL(pageUrl).searchParams.get('auth_origin')
    if (!authOrigin) {
      throw new Error('Apple mock auth origin is required.')
    }
    return new URL('/appleauth/auth/authorize/signin', authOrigin).toString()
  }

  static transition(
    submission: AppleAuthMockSubmission,
  ): AppleAuthMockTransition {
    const { state, submitter, identifier, password, decoyPassword } = submission
    if (decoyPassword !== '') {
      return { kind: AppleAuthMockTransitionKind.Rejected, state }
    }
    if (state.step === AppleAuthMockStep.Identifier) {
      if (submitter !== 'continue' || identifier !== APPLE_AUTH_MOCK_USERNAME) {
        return { kind: AppleAuthMockTransitionKind.Rejected, state }
      }
      return {
        kind: AppleAuthMockTransitionKind.Advanced,
        state: { step: AppleAuthMockStep.Password, identifier },
      }
    }
    if (
      submitter === 'sign-in' &&
      state.identifier === APPLE_AUTH_MOCK_USERNAME &&
      identifier === APPLE_AUTH_MOCK_USERNAME &&
      password === APPLE_AUTH_MOCK_PASSWORD
    ) {
      return { kind: AppleAuthMockTransitionKind.Completed, state }
    }
    return { kind: AppleAuthMockTransitionKind.Rejected, state }
  }
}
