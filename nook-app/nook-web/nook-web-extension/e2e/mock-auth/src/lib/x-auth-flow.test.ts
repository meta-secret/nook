import { describe, expect, test } from 'vitest'

import {
  X_AUTH_MOCK_USERNAME,
  X_AUTH_MOCK_LOGIN_PATH,
  X_AUTH_MOCK_ONBOARDING_PATH,
  XAuthMockScenario,
  XAuthMockTransitionKind,
  type XAuthMockSubmission,
} from './x-auth-flow'

describe('X authentication mock', () => {
  const implicitSubmission: XAuthMockSubmission = {
    username: X_AUTH_MOCK_USERNAME,
    hiddenPassword: '',
    alternativeActivationCount: 0,
    continueActivationCount: 0,
    submitterPresent: false,
  }

  test('completes through the form implicit submission path', () => {
    expect(XAuthMockScenario.transition(implicitSubmission)).toBe(
      XAuthMockTransitionKind.Completed,
    )
  })

  test('redirects the public login route to the observed onboarding route', () => {
    expect(X_AUTH_MOCK_LOGIN_PATH).toBe('/i/flow/login')
    expect(X_AUTH_MOCK_ONBOARDING_PATH).toBe('/i/jf/onboarding/web?mode=login')
  })

  test.each([
    ['a different identifier', { username: 'other@nook.test' }],
    ['a filled hidden password', { hiddenPassword: 'unexpected' }],
    ['an alternative activation', { alternativeActivationCount: 1 }],
    ['the visible Continue activation', { continueActivationCount: 1 }],
    ['a semantic submitter', { submitterPresent: true }],
  ])('rejects %s', (_, changed) => {
    expect(
      XAuthMockScenario.transition({ ...implicitSubmission, ...changed }),
    ).toBe(XAuthMockTransitionKind.Rejected)
  })
})
