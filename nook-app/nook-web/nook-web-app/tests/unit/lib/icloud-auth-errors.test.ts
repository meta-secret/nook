import { describe, expect, it } from 'vitest'
import {
  CloudKitAuthErrorTranslationKey,
  CloudKitFailurePresentation,
} from '$lib/auth/icloud/auth-errors'

describe('cloudKitAuthErrorTranslationKey', () => {
  it('maps AUTHENTICATION_FAILED to origin/token guidance', () => {
    expect(
      new CloudKitFailurePresentation({
        serverErrorCode: 'AUTHENTICATION_FAILED',
        reason:
          'Authentication failed, please check you have the correct API Token for this container',
      }).translationKey,
    ).toBe(CloudKitAuthErrorTranslationKey.UnknownError)
  })

  it('maps AUTHENTICATION_REQUIRED to sign-in required', () => {
    expect(
      new CloudKitFailurePresentation({
        serverErrorCode: 'AUTHENTICATION_REQUIRED',
        reason: 'request needs authorization',
        status: 421,
      }).translationKey,
    ).toBe(CloudKitAuthErrorTranslationKey.SignInRequired)
  })
})
