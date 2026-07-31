import { describe, expect, it } from 'vitest'
import {
  CloudKitAuthErrorTranslationKey,
  cloudKitAuthErrorTranslationKey,
} from '$lib/icloud-auth-errors'

describe('cloudKitAuthErrorTranslationKey', () => {
  it('maps AUTHENTICATION_FAILED to origin/token guidance', () => {
    expect(
      cloudKitAuthErrorTranslationKey({
        serverErrorCode: 'AUTHENTICATION_FAILED',
        reason:
          'Authentication failed, please check you have the correct API Token for this container',
      }),
    ).toBe(CloudKitAuthErrorTranslationKey.UnknownError)
  })

  it('maps AUTHENTICATION_REQUIRED to sign-in required', () => {
    expect(
      cloudKitAuthErrorTranslationKey({
        serverErrorCode: 'AUTHENTICATION_REQUIRED',
        reason: 'request needs authorization',
        status: 421,
      }),
    ).toBe(CloudKitAuthErrorTranslationKey.SignInRequired)
  })
})
