import { describe, expect, test } from 'bun:test'

import siteShells from '../../fixtures/site-shells.json'
import claudeTemplate from '../../fixtures/templates/claude.json'
import {
  CLAUDE_MOCK_EMAIL,
  ClaudeAuthControl,
  ClaudeAuthEmailMatch,
  ClaudeAuthFormActionKind,
  ClaudeAuthFormMethod,
  ClaudeAuthInteractionState,
  ClaudeAuthMockScenario,
  ClaudeAuthTransitionKind,
  type ClaudeAuthSubmission,
} from './claude-auth-flow'

describe('Claude authentication mock', () => {
  const emailSubmission: ClaudeAuthSubmission = {
    email: CLAUDE_MOCK_EMAIL,
    submittedControl: ClaudeAuthControl.ContinueWithEmail,
    formMethod: ClaudeAuthFormMethod.Post,
    formAction: ClaudeAuthFormActionKind.Omitted,
    googleInteraction: ClaudeAuthInteractionState.Untouched,
    ssoInteraction: ClaudeAuthInteractionState.Untouched,
    disclosureInteraction: ClaudeAuthInteractionState.Untouched,
    marketingInteraction: ClaudeAuthInteractionState.Untouched,
  }

  test('completes only through the observed email form', () => {
    expect(ClaudeAuthMockScenario.transition(emailSubmission)).toBe(
      ClaudeAuthTransitionKind.Completed,
    )
  })

  test.each([
    ['a different email', { email: 'other@nook.test' }],
    ['Google', { submittedControl: ClaudeAuthControl.ContinueWithGoogle }],
    ['SSO', { submittedControl: ClaudeAuthControl.ContinueWithSso }],
    [
      'an unrecognized control',
      { submittedControl: ClaudeAuthControl.Unrecognized },
    ],
    ['an unsupported method', { formMethod: ClaudeAuthFormMethod.Unsupported }],
    ['an authored action', { formAction: ClaudeAuthFormActionKind.Authored }],
    [
      'Google activation',
      { googleInteraction: ClaudeAuthInteractionState.Activated },
    ],
    [
      'SSO activation',
      { ssoInteraction: ClaudeAuthInteractionState.Activated },
    ],
    [
      'disclosure activation',
      { disclosureInteraction: ClaudeAuthInteractionState.Activated },
    ],
    [
      'marketing activation',
      { marketingInteraction: ClaudeAuthInteractionState.Activated },
    ],
  ])('rejects %s', (_, changed) => {
    expect(
      ClaudeAuthMockScenario.transition({ ...emailSubmission, ...changed }),
    ).toBe(ClaudeAuthTransitionKind.Rejected)
  })

  test('normalizes email matches and submitted-control labels', () => {
    expect(ClaudeAuthMockScenario.emailMatch(CLAUDE_MOCK_EMAIL)).toBe(
      ClaudeAuthEmailMatch.Matched,
    )
    expect(ClaudeAuthMockScenario.emailMatch('other@nook.test')).toBe(
      ClaudeAuthEmailMatch.Different,
    )
    expect(ClaudeAuthMockScenario.submittedControl('Continue with email')).toBe(
      ClaudeAuthControl.ContinueWithEmail,
    )
    expect(
      ClaudeAuthMockScenario.submittedControl('Continue with Google'),
    ).toBe(ClaudeAuthControl.ContinueWithGoogle)
    expect(ClaudeAuthMockScenario.submittedControl('Continue with SSO')).toBe(
      ClaudeAuthControl.ContinueWithSso,
    )
    expect(ClaudeAuthMockScenario.submittedControl('Primary action')).toBe(
      ClaudeAuthControl.Unrecognized,
    )
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
