import { describe, expect, test } from 'bun:test'
import {
  APPLE_AUTH_MOCK_PASSWORD,
  APPLE_AUTH_MOCK_USERNAME,
  AppleAuthMockScenario,
  AppleAuthMockStep,
  AppleAuthMockTransitionKind,
} from './apple-auth-flow'

describe('Apple authentication mock', () => {
  test('binds the outer account shell to the supplied authorization origin', () => {
    expect(
      AppleAuthMockScenario.authorizationFrameSource(
        'http://localhost:4100/account/sign-in?auth_origin=http%3A%2F%2Flocalhost%3A4200',
      ),
    ).toBe('http://localhost:4200/appleauth/auth/authorize/signin')
    expect(() =>
      AppleAuthMockScenario.authorizationFrameSource(
        'http://localhost:4100/account/sign-in',
      ),
    ).toThrow('Apple mock auth origin is required.')
  })

  test('advances the identifier step and completes the password step', () => {
    const identifier = AppleAuthMockScenario.transition({
      state: AppleAuthMockScenario.initialState(),
      submitter: 'continue',
      identifier: APPLE_AUTH_MOCK_USERNAME,
      password: '',
      decoyPassword: '',
    })

    expect(identifier).toEqual({
      kind: AppleAuthMockTransitionKind.Advanced,
      state: {
        step: AppleAuthMockStep.Password,
        identifier: APPLE_AUTH_MOCK_USERNAME,
      },
    })
    expect(
      AppleAuthMockScenario.transition({
        state: identifier.state,
        submitter: 'sign-in',
        identifier: APPLE_AUTH_MOCK_USERNAME,
        password: APPLE_AUTH_MOCK_PASSWORD,
        decoyPassword: '',
      }).kind,
    ).toBe(AppleAuthMockTransitionKind.Completed)
  })

  test.each([
    ['wrong identifier', 'continue', 'other@nook.test', ''],
    ['passkey control', 'passkey', APPLE_AUTH_MOCK_USERNAME, ''],
    ['filled decoy', 'continue', APPLE_AUTH_MOCK_USERNAME, 'decoy'],
  ])(
    'keeps the identifier step on %s',
    (_, submitter, identifier, decoyPassword) => {
      const state = AppleAuthMockScenario.initialState()
      expect(
        AppleAuthMockScenario.transition({
          state,
          submitter,
          identifier,
          password: '',
          decoyPassword,
        }),
      ).toEqual({ kind: AppleAuthMockTransitionKind.Rejected, state })
    },
  )

  test('requires the exact password-stage identity and password', () => {
    const state = {
      step: AppleAuthMockStep.Password,
      identifier: APPLE_AUTH_MOCK_USERNAME,
    }
    expect(
      AppleAuthMockScenario.transition({
        state,
        submitter: 'sign-in',
        identifier: 'other@nook.test',
        password: APPLE_AUTH_MOCK_PASSWORD,
        decoyPassword: '',
      }).kind,
    ).toBe(AppleAuthMockTransitionKind.Rejected)
  })
})
