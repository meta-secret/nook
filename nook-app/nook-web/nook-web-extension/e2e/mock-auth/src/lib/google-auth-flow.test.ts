import { describe, expect, test } from 'bun:test'
import {
  GOOGLE_AUTH_MOCK_PASSWORD,
  GOOGLE_AUTH_MOCK_USERNAME,
  GoogleAuthMockScenario,
  GoogleAuthMockStep,
  GoogleAuthMockTransitionKind,
} from './google-auth-flow'

describe('Google authentication mock', () => {
  test('advances the identifier-first branch and completes its password step', () => {
    const identifier = GoogleAuthMockScenario.transition({
      state: GoogleAuthMockScenario.initialState(),
      submitter: 'identifier-next',
      identifier: GOOGLE_AUTH_MOCK_USERNAME,
      password: '',
      hiddenPassword: '',
    })

    expect(identifier).toEqual({
      kind: GoogleAuthMockTransitionKind.Advanced,
      state: {
        step: GoogleAuthMockStep.Password,
        identifier: GOOGLE_AUTH_MOCK_USERNAME,
      },
    })
    expect(
      GoogleAuthMockScenario.transition({
        state: identifier.state,
        submitter: 'password-next',
        identifier: GOOGLE_AUTH_MOCK_USERNAME,
        password: GOOGLE_AUTH_MOCK_PASSWORD,
        hiddenPassword: '',
      }).kind,
    ).toBe(GoogleAuthMockTransitionKind.Completed)
  })

  test.each([
    ['wrong identifier', 'identifier-next', 'other@nook.test', ''],
    ['wrong control', 'create-account', GOOGLE_AUTH_MOCK_USERNAME, ''],
    [
      'filled hidden password',
      'identifier-next',
      GOOGLE_AUTH_MOCK_USERNAME,
      'decoy',
    ],
  ])(
    'keeps the identifier step on %s',
    (_, submitter, identifier, hiddenPassword) => {
      const initial = GoogleAuthMockScenario.initialState()
      expect(
        GoogleAuthMockScenario.transition({
          state: initial,
          submitter,
          identifier,
          password: '',
          hiddenPassword,
        }),
      ).toEqual({ kind: GoogleAuthMockTransitionKind.Rejected, state: initial })
    },
  )

  test('rejects the wrong password without completing authentication', () => {
    const passwordState = {
      step: GoogleAuthMockStep.Password,
      identifier: GOOGLE_AUTH_MOCK_USERNAME,
    }
    expect(
      GoogleAuthMockScenario.transition({
        state: passwordState,
        submitter: 'password-next',
        identifier: GOOGLE_AUTH_MOCK_USERNAME,
        password: 'wrong-password',
        hiddenPassword: '',
      }),
    ).toEqual({
      kind: GoogleAuthMockTransitionKind.Rejected,
      state: passwordState,
    })
  })
})
