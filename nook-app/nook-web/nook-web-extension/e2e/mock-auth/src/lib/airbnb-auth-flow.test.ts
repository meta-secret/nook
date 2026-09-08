import { describe, expect, test } from 'bun:test'

import siteShells from '../../fixtures/site-shells.json'
import airbnbTemplate from '../../fixtures/templates/airbnb.json'
import {
  AIRBNB_MOCK_IDENTITY,
  AirbnbAuthControl,
  AirbnbAuthIdentityMatch,
  AirbnbAuthInteractionState,
  AirbnbAuthMockScenario,
  AirbnbAuthPresentationState,
  AirbnbAuthTransitionKind,
  type AirbnbAuthSubmission,
} from './airbnb-auth-flow'

describe('Airbnb authentication mock', () => {
  const continuation: AirbnbAuthSubmission = {
    identity: AIRBNB_MOCK_IDENTITY,
    submittedControl: AirbnbAuthControl.Continue,
    primaryActivation: AirbnbAuthInteractionState.Activated,
    alternativeActivationCount: 0,
  }

  test('completes only through one local Continue activation', () => {
    expect(AirbnbAuthMockScenario.transition(continuation)).toBe(
      AirbnbAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['different identity', { identity: 'other@nook.test' }],
    ['Google', { submittedControl: AirbnbAuthControl.ContinueWithGoogle }],
    ['Apple', { submittedControl: AirbnbAuthControl.ContinueWithApple }],
    ['unknown control', { submittedControl: AirbnbAuthControl.Unrecognized }],
    [
      'no activation',
      { primaryActivation: AirbnbAuthInteractionState.Untouched },
    ],
    [
      'repeated activation',
      { primaryActivation: AirbnbAuthInteractionState.Repeated },
    ],
    ['alternate activation', { alternativeActivationCount: 1 }],
  ])('rejects %s', (_, changed) => {
    expect(
      AirbnbAuthMockScenario.transition({ ...continuation, ...changed }),
    ).toBe(AirbnbAuthTransitionKind.Rejected)
  })

  test('normalizes only captured controls and identity evidence', () => {
    expect(AirbnbAuthMockScenario.identityMatch(AIRBNB_MOCK_IDENTITY)).toBe(
      AirbnbAuthIdentityMatch.Matched,
    )
    expect(AirbnbAuthMockScenario.identityMatch('other@nook.test')).toBe(
      AirbnbAuthIdentityMatch.Different,
    )
    expect(AirbnbAuthMockScenario.submittedControl(' Continue ')).toBe(
      AirbnbAuthControl.Continue,
    )
    expect(AirbnbAuthMockScenario.submittedControl('Primary')).toBe(
      AirbnbAuthControl.Unrecognized,
    )
    expect(AirbnbAuthPresentationState.Ready).toBe('ready')
    expect(AirbnbAuthPresentationState.Rejected).toBe('rejected')
  })

  test('promotes both Airbnb catalog entries to the captured shell', () => {
    const mapping = {
      loginUrl: 'https://www.airbnb.com/login',
      source: 'capture',
      template: 'airbnb',
    }
    expect(siteShells.airbnb).toEqual(mapping)
    expect(siteShells['airbnb-host']).toEqual(mapping)
    expect(airbnbTemplate).toEqual({
      id: 'airbnb',
      quirks: [
        'form-method-omitted',
        'form-action-omitted',
        'input-name-omitted',
        'visible-associated-label',
        'provider-alternatives-outside-form',
      ],
      steps: [
        {
          fields: [
            {
              type: 'text',
              inputmode: 'email',
              autocomplete: 'tel-national',
              label: 'Phone number or email',
            },
          ],
          submit: { type: 'submit', label: 'Continue' },
        },
      ],
    })
  })
})
