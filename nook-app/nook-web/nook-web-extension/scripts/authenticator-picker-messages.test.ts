import { describe, expect, test } from 'bun:test'
import {
  isAuthenticatorPickerCancelMessage,
  isAuthenticatorPickerQueryMessage,
  isAuthenticatorPickerSelectMessage,
  isWebsiteAuthenticatorCanceledMessage,
  isWebsiteAuthenticatorPickerOpenMessage,
  isWebsiteAuthenticatorSelectedMessage,
  MAX_AUTHENTICATOR_SEARCH_LENGTH,
} from '../src/lib/authenticator-picker-messages'

describe('authenticator picker messages', () => {
  test('accepts bounded picker requests', () => {
    expect(
      isWebsiteAuthenticatorPickerOpenMessage({
        type: 'nook:website-authenticator-picker-open',
        payload: { origin: 'https://example.test' },
      }),
    ).toBe(true)
    expect(
      isAuthenticatorPickerQueryMessage({
        type: 'nook:authenticator-picker-query',
        payload: { requestId: 'picker-1', query: 'alice' },
      }),
    ).toBe(true)
    expect(
      isAuthenticatorPickerSelectMessage({
        type: 'nook:authenticator-picker-select',
        payload: {
          requestId: 'picker-1',
          vaultStoreId: 'vault-1',
          secretId: 'secret-1',
        },
      }),
    ).toBe(true)
    expect(
      isAuthenticatorPickerCancelMessage({
        type: 'nook:authenticator-picker-cancel',
        payload: { requestId: 'picker-1' },
      }),
    ).toBe(true)
  })

  test('rejects oversized search text and incomplete selections', () => {
    expect(
      isAuthenticatorPickerQueryMessage({
        type: 'nook:authenticator-picker-query',
        payload: {
          requestId: 'picker-1',
          query: 'x'.repeat(MAX_AUTHENTICATOR_SEARCH_LENGTH + 1),
        },
      }),
    ).toBe(false)
    expect(
      isAuthenticatorPickerSelectMessage({
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
      isWebsiteAuthenticatorSelectedMessage({
        type: 'nook:website-authenticator-selected',
        payload: {
          origin: 'https://example.test',
          requestId: 'picker-1',
          account: {
            vaultStoreId: 'vault-1',
            secretId: 'secret-1',
          },
        },
      }),
    ).toBe(true)
    expect(
      isWebsiteAuthenticatorSelectedMessage({
        type: 'nook:website-authenticator-selected',
        payload: {
          origin: 'https://example.test',
          requestId: 'picker-1',
          account: { vaultStoreId: 'vault-1' },
        },
      }),
    ).toBe(false)
    expect(
      isWebsiteAuthenticatorCanceledMessage({
        type: 'nook:website-authenticator-canceled',
        payload: {
          origin: 'https://example.test',
          requestId: 'picker-1',
        },
      }),
    ).toBe(true)
    expect(
      isWebsiteAuthenticatorCanceledMessage({
        type: 'nook:website-authenticator-canceled',
        payload: { origin: 'https://example.test' },
      }),
    ).toBe(false)
  })
})
