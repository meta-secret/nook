import { describe, expect, test } from 'vitest'

import {
  OPENAI_AUTH_MOCK_USERNAME,
  OpenAiAuthMockAuthorizationTargetKind,
  OpenAiAuthMockScenario,
  OpenAiAuthMockTransitionKind,
  type ChatGptAuthMockSubmission,
  type OpenAiAuthMockSubmission,
} from './openai-auth-flow'

describe('OpenAI authentication mock', () => {
  test('binds the ChatGPT identifier submit to the configured OpenAI origin', () => {
    const authorizationTarget = OpenAiAuthMockScenario.authorizationTarget(
      'https://chatgpt.example/auth/login?auth_origin=https%3A%2F%2Fauth.openai.example',
    )
    const submission: ChatGptAuthMockSubmission = {
      submitter: 'chatgpt-continue',
      email: OPENAI_AUTH_MOCK_USERNAME,
      alternativeActivationCount: 0,
      authorizationTarget,
    }

    expect(OpenAiAuthMockScenario.submitChatGpt(submission)).toEqual({
      kind: OpenAiAuthMockTransitionKind.Redirect,
      url: 'https://auth.openai.example/log-in-or-create-account',
    })
  })

  test('rejects a missing authorization origin or touched alternative', () => {
    const authorizationTarget = OpenAiAuthMockScenario.authorizationTarget(
      'https://chatgpt.example/auth/login',
    )
    expect(authorizationTarget).toEqual({
      kind: OpenAiAuthMockAuthorizationTargetKind.Missing,
    })
    const submission: ChatGptAuthMockSubmission = {
      submitter: 'chatgpt-continue',
      email: OPENAI_AUTH_MOCK_USERNAME,
      alternativeActivationCount: 1,
      authorizationTarget,
    }
    expect(OpenAiAuthMockScenario.submitChatGpt(submission)).toEqual({
      kind: OpenAiAuthMockTransitionKind.Rejected,
    })
  })

  test('completes only the exact OpenAI email continuation', () => {
    const submission: OpenAiAuthMockSubmission = {
      submitter: 'openai-continue',
      email: OPENAI_AUTH_MOCK_USERNAME,
      alternativeActivationCount: 0,
    }
    expect(OpenAiAuthMockScenario.submitOpenAi(submission)).toEqual({
      kind: OpenAiAuthMockTransitionKind.Completed,
    })

    const touchedAlternative: OpenAiAuthMockSubmission = {
      ...submission,
      alternativeActivationCount: 1,
    }
    expect(OpenAiAuthMockScenario.submitOpenAi(touchedAlternative)).toEqual({
      kind: OpenAiAuthMockTransitionKind.Rejected,
    })
  })
})
