import { describe, expect, test } from 'vitest'

import siteShells from '../../fixtures/site-shells.json'
import consumerTemplate from '../../fixtures/templates/microsoft-consumer.json'
import enterpriseTemplate from '../../fixtures/templates/microsoft.json'
import {
  MICROSOFT_CONSUMER_MOCK_USERNAME,
  MicrosoftConsumerAuthMockScenario,
  MicrosoftConsumerAuthTransitionKind,
  type MicrosoftConsumerAuthSubmission,
} from './microsoft-consumer-auth-flow'

describe('Microsoft consumer authentication mock', () => {
  const nextSubmission: MicrosoftConsumerAuthSubmission = {
    username: MICROSOFT_CONSUMER_MOCK_USERNAME,
    submittedControl: 'Next',
    closeActivationCount: 0,
    recoveryActivationCount: 0,
    outsideActivationCount: 0,
    unrelatedFormSubmissionCount: 0,
  }

  test('completes only through the semantic Next submission', () => {
    expect(MicrosoftConsumerAuthMockScenario.transition(nextSubmission)).toBe(
      MicrosoftConsumerAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different identifier', { username: 'other@nook.test' }],
    ['a different submitter', { submittedControl: 'Close' }],
    ['Close', { closeActivationCount: 1 }],
    ['username recovery', { recoveryActivationCount: 1 }],
    ['an outside link', { outsideActivationCount: 1 }],
    ['the unrelated empty form', { unrelatedFormSubmissionCount: 1 }],
  ])('rejects %s', (_, changed) => {
    expect(
      MicrosoftConsumerAuthMockScenario.transition({
        ...nextSubmission,
        ...changed,
      }),
    ).toBe(MicrosoftConsumerAuthTransitionKind.Rejected)
  })

  test('keeps the consumer catalog shell distinct from enterprise Microsoft', () => {
    expect(siteShells.microsoft).toEqual({
      loginUrl: 'https://login.live.com/',
      source: 'capture',
      template: 'microsoft-consumer',
    })
    expect(consumerTemplate).toMatchObject({
      id: 'microsoft-consumer',
      steps: [
        {
          fields: [
            {
              type: 'email',
              id: 'usernameEntry',
              autocomplete: 'username webauthn',
            },
          ],
          submit: { type: 'submit', label: 'Next' },
        },
      ],
    })
    expect(enterpriseTemplate.id).toBe('microsoft')
    expect(enterpriseTemplate.steps[0]).toMatchObject({
      fields: [
        {
          type: 'email',
          name: 'loginfmt',
          id: 'i0116',
        },
      ],
    })
  })
})
