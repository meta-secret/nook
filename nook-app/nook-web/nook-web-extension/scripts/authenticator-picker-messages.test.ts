import { describe, expect, test } from 'bun:test'
import {
  MAX_AUTHENTICATOR_SEARCH_LENGTH,
  AuthenticatorPickerCancelMessage as AuthenticatorPickerCancelMessageSchema,
  AuthenticatorPickerQueryMessage as AuthenticatorPickerQueryMessageSchema,
  AuthenticatorPickerSelectMessage as AuthenticatorPickerSelectMessageSchema,
  WebsiteAuthenticatorCanceledMessage as WebsiteAuthenticatorCanceledMessageSchema,
  WebsiteAuthenticatorPickerOpenMessage as WebsiteAuthenticatorPickerOpenMessageSchema,
  WebsiteAuthenticatorSelectedMessage as WebsiteAuthenticatorSelectedMessageSchema,
} from '../src/lib/authenticator-picker-messages'

describe('authenticator picker messages', () => {
  test('accepts bounded picker requests', () => {
    expect(
      WebsiteAuthenticatorPickerOpenMessageSchema.is({
        type: 'nook:website-authenticator-picker-open',
        payload: { origin: 'https://example.test' },
      }),
    ).toBe(true)
    expect(
      AuthenticatorPickerQueryMessageSchema.is({
        type: 'nook:authenticator-picker-query',
        payload: { requestId: 'picker-1', query: 'alice' },
      }),
    ).toBe(true)
    expect(
      AuthenticatorPickerSelectMessageSchema.is({
        type: 'nook:authenticator-picker-select',
        payload: {
          requestId: 'picker-1',
          vaultStoreId: 'vault-1',
          secretId: 'secret-1',
        },
      }),
    ).toBe(true)
    expect(
      AuthenticatorPickerCancelMessageSchema.is({
        type: 'nook:authenticator-picker-cancel',
        payload: { requestId: 'picker-1' },
      }),
    ).toBe(true)
  })

  test('rejects oversized search text and incomplete selections', () => {
    expect(
      AuthenticatorPickerQueryMessageSchema.is({
        type: 'nook:authenticator-picker-query',
        payload: {
          requestId: 'picker-1',
          query: 'x'.repeat(MAX_AUTHENTICATOR_SEARCH_LENGTH + 1),
        },
      }),
    ).toBe(false)
    expect(
      AuthenticatorPickerSelectMessageSchema.is({
        type: 'nook:authenticator-picker-select',
        payload: {
          requestId: 'picker-1',
          vaultStoreId: '',
          secretId: 'secret-1',
        },
      }),
    ).toBe(false)
  })

  test('accepts only complete background selections', () => {
    expect(
      WebsiteAuthenticatorSelectedMessageSchema.is({
        type: 'nook:website-authenticator-selected',
        payload: {
          origin: 'https://example.test',
          requestId: 'picker-1',
          account: {
            vaultStoreId: 'vault-1',
            secretId: 'secret-1',
            authorizationGeneration: 'epoch-7',
          },
        },
      }),
    ).toBe(true)
    expect(
      WebsiteAuthenticatorSelectedMessageSchema.is({
        type: 'nook:website-authenticator-selected',
        payload: {
          origin: 'https://example.test',
          requestId: 'picker-1',
          account: { vaultStoreId: 'vault-1' },
        },
      }),
    ).toBe(false)
    expect(
      WebsiteAuthenticatorCanceledMessageSchema.is({
        type: 'nook:website-authenticator-canceled',
        payload: {
          origin: 'https://example.test',
          requestId: 'picker-1',
        },
      }),
    ).toBe(true)
    expect(
      WebsiteAuthenticatorCanceledMessageSchema.is({
        type: 'nook:website-authenticator-canceled',
        payload: { origin: 'https://example.test' },
      }),
    ).toBe(false)
  })
})
