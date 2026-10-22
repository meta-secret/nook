import { describe, expect, test } from 'vitest'
import {
  identityUnlockRoute,
  IdentityUnlockRoute,
} from '$lib/components/login/login-unlock-state'

describe('identity card unlock route', () => {
  test('an identity adopted from the paired extension unlocks there, never with a passkey here', () => {
    for (const pinProtected of [false, true])
      expect(
        identityUnlockRoute({ identityKeyInExtension: true, pinProtected }),
      ).toBe(IdentityUnlockRoute.PairedExtension)
  })

  test('an identity keyed on this browser asks for its PIN or passkey', () => {
    expect(
      identityUnlockRoute({
        identityKeyInExtension: false,
        pinProtected: true,
      }),
    ).toBe(IdentityUnlockRoute.Pin)
    expect(
      identityUnlockRoute({
        identityKeyInExtension: false,
        pinProtected: false,
      }),
    ).toBe(IdentityUnlockRoute.Passkey)
  })
})
