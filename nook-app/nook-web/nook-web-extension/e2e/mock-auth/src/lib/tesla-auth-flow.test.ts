import { describe, expect, test } from 'bun:test'

import teslaTemplate from '../../fixtures/templates/tesla.json'
import {
  TESLA_MOCK_EMAIL,
  TESLA_MOCK_PASSWORD,
  TeslaAuthControl,
  TeslaAuthEmailMatch,
  TeslaAuthMockScenario,
  TeslaAuthPasswordMatch,
  TeslaAuthPresentationState,
  TeslaAuthPrimaryActivationState,
  TeslaAuthTransitionKind,
  type TeslaAuthSubmission,
  type TeslaAuthPasswordSubmission,
} from './tesla-auth-flow'

describe('Tesla authentication mock', () => {
  const emailContinuation: TeslaAuthSubmission = {
    email: TESLA_MOCK_EMAIL,
    submittedControl: TeslaAuthControl.Next,
    primaryActivation: TeslaAuthPrimaryActivationState.Activated,
    auxiliaryActivationCount: 0,
  }
  const passwordSubmission: TeslaAuthPasswordSubmission = {
    password: TESLA_MOCK_PASSWORD,
    submittedControl: TeslaAuthControl.SignIn,
    primaryActivation: TeslaAuthPrimaryActivationState.Activated,
    auxiliaryActivationCount: 0,
  }

  test('completes only through the observed email continuation', () => {
    expect(TeslaAuthMockScenario.transition(emailContinuation)).toBe(
      TeslaAuthTransitionKind.Completed,
    )
  })

  test('completes only through the observed password submission', () => {
    expect(TeslaAuthMockScenario.passwordTransition(passwordSubmission)).toBe(
      TeslaAuthTransitionKind.Completed,
    )
    expect(
      TeslaAuthMockScenario.passwordTransition({
        ...passwordSubmission,
        password: 'different-password',
      }),
    ).toBe(TeslaAuthTransitionKind.Rejected)
  })

  test.each([
    ['a different email', { email: 'other@nook.test' }],
    [
      'trouble recovery',
      { submittedControl: TeslaAuthControl.TroubleSigningIn },
    ],
    ['cancellation', { submittedControl: TeslaAuthControl.Cancel }],
    ['an unknown control', { submittedControl: TeslaAuthControl.Unrecognized }],
    [
      'no activation',
      { primaryActivation: TeslaAuthPrimaryActivationState.Untouched },
    ],
    [
      'repeated activation',
      { primaryActivation: TeslaAuthPrimaryActivationState.Repeated },
    ],
    ['auxiliary activation', { auxiliaryActivationCount: 1 }],
  ])('rejects %s', (_, changed) => {
    expect(
      TeslaAuthMockScenario.transition({ ...emailContinuation, ...changed }),
    ).toBe(TeslaAuthTransitionKind.Rejected)
  })

  test('normalizes only observed controls and email evidence', () => {
    expect(TeslaAuthMockScenario.emailMatch(TESLA_MOCK_EMAIL)).toBe(
      TeslaAuthEmailMatch.Matched,
    )
    expect(TeslaAuthMockScenario.emailMatch('other@nook.test')).toBe(
      TeslaAuthEmailMatch.Different,
    )
    expect(TeslaAuthMockScenario.submittedControl(' Next ')).toBe(
      TeslaAuthControl.Next,
    )
    expect(TeslaAuthMockScenario.submittedControl(' Sign In ')).toBe(
      TeslaAuthControl.SignIn,
    )
    expect(TeslaAuthMockScenario.passwordMatch(TESLA_MOCK_PASSWORD)).toBe(
      TeslaAuthPasswordMatch.Matched,
    )
    expect(TeslaAuthMockScenario.submittedControl('Primary action')).toBe(
      TeslaAuthControl.Unrecognized,
    )
    expect(String(TeslaAuthPresentationState.Ready)).toBe('ready')
    expect(String(TeslaAuthPresentationState.Rejected)).toBe('rejected')
  })

  test('catalogs the captured shell without OAuth query values', () => {
    expect(teslaTemplate).toEqual({
      id: 'tesla',
      quirks: [
        'form-method-omitted',
        'form-action-omitted',
        'input-type-omitted',
        'email-webauthn-autocomplete',
        'submit-disabled-until-input',
        'oauth-query-inherited-from-page',
        'password-step-swapped-in-place',
      ],
      steps: [
        {
          fields: [
            {
              name: 'identity',
              autocomplete: 'email webauthn',
              id: 'identity',
              autocapitalize: 'none',
              autocorrect: 'off',
              spellcheck: 'false',
              dir: 'ltr',
            },
          ],
          submit: { type: 'submit', label: 'Next', 'aria-label': 'Next' },
        },
        {
          fields: [
            {
              name: 'password',
              type: 'password',
              autocomplete: 'current-password',
              id: 'password',
              autocapitalize: 'none',
              dir: 'ltr',
            },
          ],
          submit: {
            type: 'submit',
            label: 'Sign In',
            'aria-label': 'Sign In',
          },
        },
      ],
    })
  })
})
