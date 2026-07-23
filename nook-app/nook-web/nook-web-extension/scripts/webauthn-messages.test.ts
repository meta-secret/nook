import { describe, expect, test } from 'bun:test'
import {
  isWebsitePasskeyCancelMessage,
  isWebsitePasskeyOptionsMessage,
  isWebsitePasskeyPerformMessage,
  parsedWebsitePasskeyRequest,
} from '../src/lib/webauthn-messages'

const requestJson = JSON.stringify({
  origin: 'https://login.example.com',
  rpId: 'example.com',
})

describe('website passkey runtime messages', () => {
  test('accepts bounded typed lookup and perform messages', () => {
    const payload = {
      requestId: 'request-1234567890',
      ceremony: 'get',
      requestJson,
      expiresAt: Date.now() + 60_000,
    }
    expect(
      isWebsitePasskeyOptionsMessage({
        type: 'nook:website-passkey-options',
        payload,
      }),
    ).toBe(true)
    expect(
      isWebsitePasskeyPerformMessage({
        type: 'nook:website-passkey-perform',
        payload: { ...payload, vaultStoreId: 'store_test' },
      }),
    ).toBe(true)
    expect(
      isWebsitePasskeyCancelMessage({
        type: 'nook:website-passkey-cancel',
        payload: { requestId: payload.requestId },
      }),
    ).toBe(true)
  })

  test('rejects oversized, malformed, and unscoped messages', () => {
    expect(
      isWebsitePasskeyOptionsMessage({
        type: 'nook:website-passkey-options',
        payload: {
          requestId: 'short',
          ceremony: 'get',
          requestJson,
        },
      }),
    ).toBe(false)
    expect(
      isWebsitePasskeyPerformMessage({
        type: 'nook:website-passkey-perform',
        payload: {
          requestId: 'request-1234567890',
          ceremony: 'get',
          requestJson: 'x'.repeat(65_537),
          vaultStoreId: 'store_test',
        },
      }),
    ).toBe(false)
    expect(parsedWebsitePasskeyRequest('{')).toBeUndefined()
  })
})
