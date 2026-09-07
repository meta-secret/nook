import { describe, expect, test } from 'bun:test'

import siteShells from '../../fixtures/site-shells.json'
import claudeTemplate from '../../fixtures/templates/claude.json'
import {
  CLAUDE_MOCK_EMAIL,
  ClaudeAuthMockScenario,
  ClaudeAuthTransitionKind,
  type ClaudeAuthSubmission,
} from './claude-auth-flow'

describe('Claude authentication mock', () => {
  const emailSubmission: ClaudeAuthSubmission = {
    email: CLAUDE_MOCK_EMAIL,
    submittedControl: 'Continue with email',
    formMethod: 'post',
    formHasAction: false,
    googleActivationCount: 0,
    ssoActivationCount: 0,
    disclosureActivationCount: 0,
    marketingActivationCount: 0,
  }

  test('completes only through the observed email form', () => {
    expect(ClaudeAuthMockScenario.transition(emailSubmission)).toBe(
      ClaudeAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different email', { email: 'other@nook.test' }],
    ['Google', { submittedControl: 'Continue with Google' }],
    ['SSO', { submittedControl: 'Continue with SSO' }],
    ['a GET method', { formMethod: 'get' }],
    ['an authored action', { formHasAction: true }],
    ['Google activation', { googleActivationCount: 1 }],
    ['SSO activation', { ssoActivationCount: 1 }],
    ['disclosure activation', { disclosureActivationCount: 1 }],
    ['marketing activation', { marketingActivationCount: 1 }],
  ])('rejects %s', (_, changed) => {
    expect(
      ClaudeAuthMockScenario.transition({ ...emailSubmission, ...changed }),
    ).toBe(ClaudeAuthTransitionKind.Rejected)
  })

  test('maps the Anthropic catalog shell to the stable Claude capture', () => {
    expect(siteShells['anthropic-console']).toEqual({
      loginUrl: 'https://claude.ai/login',
      source: 'capture',
      template: 'claude',
    })
    expect(claudeTemplate).toEqual({
      id: 'claude',
      quirks: [
        'post-form-without-action',
        'provider-alternatives-outside-form',
      ],
      steps: [
        {
          fields: [
            {
              type: 'email',
              name: 'email',
              autocomplete: 'email',
              'aria-label': 'Email',
            },
          ],
          submit: { type: 'submit', label: 'Continue with email' },
        },
      ],
    })
  })
})
