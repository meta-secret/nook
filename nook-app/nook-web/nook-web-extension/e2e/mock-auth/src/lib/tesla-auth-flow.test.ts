import { describe, expect, test } from 'bun:test'

import teslaTemplate from '../../fixtures/templates/tesla.json'
import {
  TESLA_MOCK_EMAIL,
  TeslaAuthControl,
  TeslaAuthEmailMatch,
  TeslaAuthInteractionState,
  TeslaAuthMockScenario,
  TeslaAuthPresentationState,
  TeslaAuthPrimaryActivationState,
  TeslaAuthTransitionKind,
  type TeslaAuthSubmission,
} from './tesla-auth-flow'

describe('Tesla authentication mock', () => {
  const emailContinuation: TeslaAuthSubmission = {
    email: TESLA_MOCK_EMAIL,
    submittedControl: TeslaAuthControl.Next,
    primaryActivation: TeslaAuthPrimaryActivationState.Activated,
    troubleInteraction: TeslaAuthInteractionState.Untouched,
    createAccountInteraction: TeslaAuthInteractionState.Untouched,
    languageInteraction: TeslaAuthInteractionState.Untouched,
    homeInteraction: TeslaAuthInteractionState.Untouched,
    privacyInteraction: TeslaAuthInteractionState.Untouched,
    contactInteraction: TeslaAuthInteractionState.Untouched,
  }

  test('completes only through the observed email continuation', () => {
    expect(TeslaAuthMockScenario.transition(emailContinuation)).toBe(
      TeslaAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different email', { email: 'other@nook.test' }],
    [
      'trouble recovery',
      { submittedControl: TeslaAuthControl.TroubleSigningIn },
    ],
    ['account creation', { submittedControl: TeslaAuthControl.CreateAccount }],
    ['an unknown control', { submittedControl: TeslaAuthControl.Unrecognized }],
    [
      'no activation',
      { primaryActivation: TeslaAuthPrimaryActivationState.Untouched },
    ],
    [
      'repeated activation',
      { primaryActivation: TeslaAuthPrimaryActivationState.Repeated },
    ],
    [
      'trouble activation',
      { troubleInteraction: TeslaAuthInteractionState.Activated },
    ],
    [
      'account creation activation',
      { createAccountInteraction: TeslaAuthInteractionState.Activated },
    ],
    [
      'language activation',
      { languageInteraction: TeslaAuthInteractionState.Activated },
    ],
    [
      'home activation',
      { homeInteraction: TeslaAuthInteractionState.Activated },
    ],
    [
      'privacy activation',
      { privacyInteraction: TeslaAuthInteractionState.Activated },
    ],
    [
      'contact activation',
      { contactInteraction: TeslaAuthInteractionState.Activated },
    ],
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
    expect(TeslaAuthMockScenario.submittedControl('Primary action')).toBe(
      TeslaAuthControl.Unrecognized,
    )
    expect(TeslaAuthPresentationState.Ready).toBe('ready')
    expect(TeslaAuthPresentationState.Rejected).toBe('rejected')
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
      ],
      steps: [
        {
          fields: [
            {
              name: 'identity',
              autocomplete: 'email webauthn',
              'aria-label': 'Email',
            },
          ],
          submit: { type: 'submit', label: 'Next' },
        },
      ],
    })
  })
})
