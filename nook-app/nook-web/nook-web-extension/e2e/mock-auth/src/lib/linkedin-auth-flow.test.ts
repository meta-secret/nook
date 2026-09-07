import { describe, expect, test } from 'vitest'

import siteShells from '../../fixtures/site-shells.json'
import linkedInTemplate from '../../fixtures/templates/linkedin.json'
import {
  LINKEDIN_MOCK_PASSWORD,
  LINKEDIN_MOCK_USERNAME,
  LinkedInAuthMockScenario,
  LinkedInAuthTransitionKind,
  type LinkedInAuthSubmission,
} from './linkedin-auth-flow'

describe('LinkedIn authentication mock', () => {
  const signIn: LinkedInAuthSubmission = {
    username: LINKEDIN_MOCK_USERNAME,
    password: LINKEDIN_MOCK_PASSWORD,
    hiddenUsername: '',
    hiddenPassword: '',
    signInActivationCount: 1,
    alternativeActivationCount: 0,
    keepSignedInChecked: true,
  }

  test('completes only through the visible combined credential surface', () => {
    expect(LinkedInAuthMockScenario.transition(signIn)).toBe(
      LinkedInAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different username', { username: 'other@nook.test' }],
    ['a different password', { password: 'different-password' }],
    ['a changed hidden username', { hiddenUsername: 'unexpected' }],
    ['a changed hidden password', { hiddenPassword: 'unexpected' }],
    ['no primary activation', { signInActivationCount: 0 }],
    ['two primary activations', { signInActivationCount: 2 }],
    ['an alternative activation', { alternativeActivationCount: 1 }],
    ['changed retention', { keepSignedInChecked: false }],
  ])('rejects %s', (_, changed) => {
    expect(LinkedInAuthMockScenario.transition({ ...signIn, ...changed })).toBe(
      LinkedInAuthTransitionKind.Rejected,
    )
  })

  test('keeps only the exact consumer mapping on the faithful shell', () => {
    expect(siteShells.linkedin).toEqual({
      loginUrl: 'https://www.linkedin.com/login/',
      source: 'capture',
      template: 'linkedin',
    })
    for (const id of [
      'linkedin-learning',
      'linkedin-recruiter',
      'linkedin-sales-nav',
    ] as const) {
      expect(siteShells[id].template).toBe('email-password')
    }
    expect(linkedInTemplate).toMatchObject({
      id: 'linkedin',
      quirks: ['formless', 'responsive-duplicate'],
      steps: [
        {
          fields: [
            { type: 'email', autocomplete: 'username' },
            { type: 'password', autocomplete: 'current-password' },
          ],
          submit: { type: 'button', label: 'Sign in' },
        },
      ],
    })
    expect(
      linkedInTemplate.steps[0]?.fields.every(
        (field) => !('id' in field) && !('name' in field),
      ),
    ).toBe(true)
  })
})
