import { describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  WebsiteAuthenticatorFillMessage as WebsiteAuthenticatorFillMessageSchema,
  WebsiteAuthenticatorOptionsMessage as WebsiteAuthenticatorOptionsMessageSchema,
  WebsiteLoginOptionsMessage as WebsiteLoginOptionsMessageSchema,
  WebsiteLoginRevealMessage as WebsiteLoginRevealMessageSchema,
} from '../src/lib/login-fill-messages'

describe('website login fill runtime messages', () => {
  test('accepts typed options and fill messages', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginOptionsMessageSchema.decode({
            type: 'nook:website-login-options',
            payload: { origin: 'https://login.example.com' },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorOptionsMessageSchema.decode({
            type: 'nook:website-authenticator-options',
            payload: { origin: 'https://login.example.com' },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorFillMessageSchema.decode({
            type: 'nook:website-authenticator-fill',
            payload: {
              origin: 'https://login.example.com',
              vaultStoreId: 'store_test',
              secretId: 'secret_totp',
              authorizationGeneration: 'epoch-7',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginRevealMessageSchema.decode({
            type: 'nook:website-login-fill',
            payload: {
              origin: 'https://login.example.com',
              vaultStoreId: 'store_test',
              secretId: 'secret_test',
              authorizationGeneration: 'epoch-7',
            },
          }),
        ),
      )._tag,
    ).toBe('Success')
  })

  test('rejects malformed messages', () => {
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginOptionsMessageSchema.decode({
            type: 'nook:website-login-options',
            payload: { origin: '' },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteLoginRevealMessageSchema.decode({
            type: 'nook:website-login-fill',
            payload: {
              origin: 'https://login.example.com',
              vaultStoreId: 'store_test',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
    expect(
      Effect.runSync(
        Effect.result(
          WebsiteAuthenticatorFillMessageSchema.decode({
            type: 'nook:website-authenticator-fill',
            payload: {
              origin: 'https://login.example.com',
              vaultStoreId: 'store_test',
            },
          }),
        ),
      )._tag,
    ).toBe('Failure')
  })
})
