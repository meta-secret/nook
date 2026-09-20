import { describe, expect, test } from 'bun:test'

import googleTemplate from '../../fixtures/templates/google.json'
import {
  GOOGLE_AUTH_MOCK_PASSWORD,
  GOOGLE_AUTH_MOCK_USERNAME,
  GoogleAuthMockScenario,
  GoogleAuthMockStep,
  GoogleAuthMockTransitionKind,
} from './google-auth-flow'

describe('Google authentication mock', () => {
  test('models the password challenge as selected account plus password only', () => {
    expect(googleTemplate.quirks).toContain('selected-account-display')
    expect(googleTemplate.steps).toHaveLength(2)

    const passwordStep = googleTemplate.steps[1]
    if (!passwordStep) throw new Error('Google password step is missing')

    expect(passwordStep.fields).toEqual([
      {
        type: 'password',
        name: 'Passwd',
        autocomplete: 'current-password',
        placeholder: 'Enter your password',
        'aria-label': 'Enter your password',
      },
    ])
    expect(passwordStep.fields).not.toContainEqual(
      expect.objectContaining({ name: 'identifier' }),
    )
  })

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
