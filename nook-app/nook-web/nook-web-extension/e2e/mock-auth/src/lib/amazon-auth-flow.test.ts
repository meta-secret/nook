import { describe, expect, test } from 'vitest'

import siteShells from '../../fixtures/site-shells.json'
import amazonTemplate from '../../fixtures/templates/amazon.json'
import {
  AMAZON_METADATA_IDENTITY,
  AMAZON_MOCK_EMAIL,
  AmazonAuthMockScenario,
  AmazonAuthTransitionKind,
  type AmazonAuthSubmission,
} from './amazon-auth-flow'

describe('Amazon authentication mock', () => {
  const validSubmission: AmazonAuthSubmission = {
    email: AMAZON_MOCK_EMAIL,
    hiddenPassword: '',
    submittedControl: 'Continue',
    metadataIdentity: AMAZON_METADATA_IDENTITY,
    backdetectSubmissionCount: 0,
    alternativeActivationCount: 0,
  }

  test('completes only through the visible email and Continue control', () => {
    expect(AmazonAuthMockScenario.transition(validSubmission)).toBe(
      AmazonAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different email', { email: 'other@nook.test' }],
    ['a filled hidden password', { hiddenPassword: 'unexpected' }],
    ['a different submitter', { submittedControl: 'Create account' }],
    ['metadata drift', { metadataIdentity: 'changed' }],
    ['a backdetect submission', { backdetectSubmissionCount: 1 }],
    ['an alternative activation', { alternativeActivationCount: 1 }],
  ])('rejects %s', (_, changed) => {
    expect(
      AmazonAuthMockScenario.transition({ ...validSubmission, ...changed }),
    ).toBe(AmazonAuthTransitionKind.Rejected)
  })

  test('maps every exact Amazon sign-in URL to the captured shell', () => {
    expect(amazonTemplate).toMatchObject({
      id: 'amazon',
      steps: [
        {
          fields: [
            {
              id: 'ap_email_login',
              name: 'email',
              type: 'email',
              autocomplete: 'webauthn',
            },
          ],
          submit: { type: 'submit', label: 'Continue' },
        },
      ],
    })
    for (const id of ['amazon', 'kindle', 'primevideo'] as const) {
      expect(siteShells[id]).toMatchObject({
        loginUrl: 'https://www.amazon.com/ap/signin',
        template: 'amazon',
      })
    }
    expect(siteShells.aws.template).toBe('email-first')
    expect(siteShells['amazon-pharmacy'].template).toBe('member-id-password')
  })
})
