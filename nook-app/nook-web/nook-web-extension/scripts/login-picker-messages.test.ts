import { describe, expect, test } from 'bun:test'
import {
  isLoginPickerCancelMessage,
  isLoginPickerQueryMessage,
  isLoginPickerSelectMessage,
  isWebsiteLoginCanceledMessage,
  isWebsiteLoginPickerOpenMessage,
  isWebsiteLoginSelectedMessage,
  MAX_LOGIN_SEARCH_LENGTH,
} from '../src/lib/login-picker-messages'

describe('login picker runtime messages', () => {
  test('accepts open messages with a non-empty origin', () => {
    expect(
      isWebsiteLoginPickerOpenMessage({
        type: 'nook:website-login-picker-open',
        payload: { origin: 'https://login.example.test' },
      }),
    ).toBe(true)
    expect(
      isWebsiteLoginPickerOpenMessage({
        type: 'nook:website-login-picker-open',
        payload: { origin: '' },
      }),
    ).toBe(false)
  })

  test('bounds query length and requires a request id', () => {
    expect(
      isLoginPickerQueryMessage({
        type: 'nook:login-picker-query',
        payload: { requestId: 'req-1', query: 'alice' },
      }),
    ).toBe(true)
    expect(
      isLoginPickerQueryMessage({
        type: 'nook:login-picker-query',
        payload: {
          requestId: 'req-1',
          query: 'a'.repeat(MAX_LOGIN_SEARCH_LENGTH + 1),
        },
      }),
    ).toBe(false)
  })

  test('requires select and cancel identity fields', () => {
    expect(
      isLoginPickerSelectMessage({
        type: 'nook:login-picker-select',
        payload: {
          requestId: 'req-1',
          vaultStoreId: 'vault-1',
          secretId: 'secret-1',
        },
      }),
    ).toBe(true)
    expect(
      isLoginPickerCancelMessage({
        type: 'nook:login-picker-cancel',
        payload: { requestId: 'req-1' },
      }),
    ).toBe(true)
  })

  test('accepts selected and canceled page callbacks', () => {
    expect(
      isWebsiteLoginSelectedMessage({
        type: 'nook:website-login-selected',
        payload: {
          origin: 'https://login.example.test',
          requestId: 'req-1',
          account: {
            vaultStoreId: 'vault-1',
            secretId: 'secret-1',
            authorizationGeneration: 'epoch-7',
          },
        },
      }),
    ).toBe(true)
    expect(
      isWebsiteLoginCanceledMessage({
        type: 'nook:website-login-canceled',
        payload: {
          origin: 'https://login.example.test',
          requestId: 'req-1',
        },
      }),
    ).toBe(true)
  })
})
