import { describe, expect, test } from 'bun:test'
import {
  WebsiteAuthenticatorFillMessage as WebsiteAuthenticatorFillMessageSchema,
  WebsiteAuthenticatorOptionsMessage as WebsiteAuthenticatorOptionsMessageSchema,
  WebsiteLoginOptionsMessage as WebsiteLoginOptionsMessageSchema,
  WebsiteLoginRevealMessage as WebsiteLoginRevealMessageSchema,
} from '../src/lib/login-fill-messages'

describe('website login fill runtime messages', () => {
  test('accepts typed options and fill messages', () => {
    expect(
      WebsiteLoginOptionsMessageSchema.is({
        type: 'nook:website-login-options',
        payload: { origin: 'https://login.example.com' },
      }),
    ).toBe(true)
    expect(
      WebsiteAuthenticatorOptionsMessageSchema.is({
        type: 'nook:website-authenticator-options',
        payload: { origin: 'https://login.example.com' },
      }),
    ).toBe(true)
    expect(
      WebsiteAuthenticatorFillMessageSchema.is({
        type: 'nook:website-authenticator-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
          secretId: 'secret_totp',
          authorizationGeneration: 'epoch-7',
        },
      }),
    ).toBe(true)
    expect(
      WebsiteLoginRevealMessageSchema.is({
        type: 'nook:website-login-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
          secretId: 'secret_test',
          authorizationGeneration: 'epoch-7',
        },
      }),
    ).toBe(true)
  })

  test('rejects malformed messages', () => {
    expect(
      WebsiteLoginOptionsMessageSchema.is({
        type: 'nook:website-login-options',
        payload: { origin: '' },
      }),
    ).toBe(false)
    expect(
      WebsiteLoginRevealMessageSchema.is({
        type: 'nook:website-login-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
        },
      }),
    ).toBe(false)
    expect(
      WebsiteAuthenticatorFillMessageSchema.is({
        type: 'nook:website-authenticator-fill',
        payload: {
          origin: 'https://login.example.com',
          vaultStoreId: 'store_test',
        },
      }),
    ).toBe(false)
  })
})
