import { describe, expect, test } from 'bun:test'
import {
  isWebsiteAuthenticatorFillMessage,
  isWebsiteAuthenticatorOptionsMessage,
  isWebsiteLoginOptionsMessage,
  isWebsiteLoginRevealMessage,
} from '../src/lib/login-fill-messages'

describe('website login fill runtime messages', () => {
  test('accepts typed options and fill messages', () => {
    expect(
      isWebsiteLoginOptionsMessage({
        type: 'nook:website-login-options',
        payload: { origin: 'https://login.example.com' },
      }),
    ).toBe(true)
    expect(
      isWebsiteAuthenticatorOptionsMessage({
        type: 'nook:website-authenticator-options',
        payload: { origin: 'https://login.example.com' },
      }),
    ).toBe(true)
    expect(
      isWebsiteAuthenticatorFillMessage({
        type: 'nook:website-authenticator-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
          secretId: 'secret_totp',
        },
      }),
    ).toBe(true)
    expect(
      isWebsiteLoginRevealMessage({
        type: 'nook:website-login-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
          secretId: 'secret_test',
        },
      }),
    ).toBe(true)
  })

  test('rejects malformed messages', () => {
    expect(
      isWebsiteLoginOptionsMessage({
        type: 'nook:website-login-options',
        payload: { origin: '' },
      }),
    ).toBe(false)
    expect(
      isWebsiteLoginRevealMessage({
        type: 'nook:website-login-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
        },
      }),
    ).toBe(false)
    expect(
      isWebsiteAuthenticatorFillMessage({
        type: 'nook:website-authenticator-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
        },
      }),
    ).toBe(false)
  })
})
