import { describe, expect, test } from 'bun:test'
import {
  isWebsitePasskeyCancelMessage,
  isWebsitePasskeyOptionsMessage,
  isWebsitePasskeyPerformMessage,
  parsedWebsitePasskeyRequest,
  websitePasskeyRequestJson,
  WebsitePasskeyCeremony,
  WebsitePasskeyCredentialSelectionKind,
  type WebsitePasskeyRequestJsonArgs,
  WebsitePasskeyRequestParseKind,
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
          requestJson,
          expiresAt: Date.now() + 60_000,
          vaultStoreId: 'store_test',
          credentialId: '',
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
    const parseArgs = {
      ceremony: WebsitePasskeyCeremony.Get,
      requestJson: '{',
    }
    expect(parsedWebsitePasskeyRequest(parseArgs)).toEqual({
      kind: WebsitePasskeyRequestParseKind.Rejected,
    })
  })

  test('models selected and request-default credential states explicitly', () => {
    const parseArgs = {
      ceremony: WebsitePasskeyCeremony.Get,
      requestJson,
    }
    const parsed = parsedWebsitePasskeyRequest(parseArgs)
    expect(parsed.kind).toBe(WebsitePasskeyRequestParseKind.Parsed)
    if (parsed.kind !== WebsitePasskeyRequestParseKind.Parsed) return

    const requestDefaultsArgs: WebsitePasskeyRequestJsonArgs = {
      request: parsed.request,
      credentialSelection: {
        kind: WebsitePasskeyCredentialSelectionKind.RequestDefaults,
      },
    }
    expect(websitePasskeyRequestJson(requestDefaultsArgs)).toBe(requestJson)

    const selectedArgs: WebsitePasskeyRequestJsonArgs = {
      request: parsed.request,
      credentialSelection: {
        kind: WebsitePasskeyCredentialSelectionKind.Selected,
        credentialId: 'credential_test',
      },
    }
    expect(JSON.parse(websitePasskeyRequestJson(selectedArgs))).toEqual({
      origin: 'https://login.example.com',
      rpId: 'example.com',
      allowCredentials: [{ id: 'credential_test' }],
    })

    const emptySelectionArgs: WebsitePasskeyRequestJsonArgs = {
      request: parsed.request,
      credentialSelection: {
        kind: WebsitePasskeyCredentialSelectionKind.Selected,
        credentialId: '',
      },
    }
    expect(() => websitePasskeyRequestJson(emptySelectionArgs)).toThrow(
      'Selected passkey credential ID must not be empty.',
    )
  })
})
