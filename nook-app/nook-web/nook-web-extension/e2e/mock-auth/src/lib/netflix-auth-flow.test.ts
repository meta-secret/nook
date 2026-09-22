import { describe, expect, test } from 'vitest'

import siteShells from '../../fixtures/site-shells.json'
import netflixTemplate from '../../fixtures/templates/netflix.json'
import {
  NETFLIX_MOCK_USERNAME,
  NetflixAuthMockScenario,
  NetflixAuthTransitionKind,
  type NetflixAuthSubmission,
} from './netflix-auth-flow'

describe('Netflix authentication mock', () => {
  const continueSubmission: NetflixAuthSubmission = {
    username: NETFLIX_MOCK_USERNAME,
    hiddenPassword: '',
    submittedControl: 'Continue',
    formMethod: 'post',
    formHasAction: false,
    auxiliaryActivationCount: 0,
  }

  test('completes only through the captured identifier form', () => {
    expect(NetflixAuthMockScenario.transition(continueSubmission)).toBe(
      NetflixAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different username', { username: 'other@nook.test' }],
    ['a populated hidden password', { hiddenPassword: 'unexpected' }],
    ['a different control', { submittedControl: 'Get Help' }],
    ['a GET method', { formMethod: 'get' }],
    ['an authored action', { formHasAction: true }],
    ['an auxiliary activation', { auxiliaryActivationCount: 1 }],
  ])('rejects %s', (_, changed) => {
    expect(
      NetflixAuthMockScenario.transition({
        ...continueSubmission,
        ...changed,
      }),
    ).toBe(NetflixAuthTransitionKind.Rejected)
  })

  test('maps only Netflix to the captured stable shell', () => {
    expect(siteShells.netflix).toEqual({
      loginUrl: 'https://www.netflix.com/login',
      source: 'capture',
      template: 'netflix',
    })
    expect(netflixTemplate).toEqual({
      id: 'netflix',
      quirks: [
        'post-form-without-action',
        'responsive-hidden-password',
        'invisible-recaptcha',
        'generated-react-id',
        'data-uia-ownership',
      ],
      steps: [
        {
          fields: [
            {
              type: 'text',
              name: 'userLoginId',
              autocomplete: 'email',
              label: 'Email or mobile number',
              'generated-id': true,
            },
          ],
          submit: { type: 'submit', label: 'Continue' },
        },
      ],
    })
  })
})
