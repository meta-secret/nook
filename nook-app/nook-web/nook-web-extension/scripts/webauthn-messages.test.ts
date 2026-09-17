import initNookWasm from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
beforeAll(async () => {
  const bytes = await Bun.file(
    new URL(
      '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
      import.meta.url,
    ),
  ).arrayBuffer()
  await initNookWasm({ module_or_path: bytes })
})
import { beforeAll, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  WebsitePasskeyCeremony,
  WebsitePasskeyCredentialSelectionKind,
  type WebsitePasskeyRequestJsonArgs,
  WebsitePasskeyRequestParseKind,
  WebsitePasskeyCancelMessage as WebsitePasskeyCancelMessageSchema,
  WebsitePasskeyOptionsMessage as WebsitePasskeyOptionsMessageSchema,
  WebsitePasskeyPerformMessage as WebsitePasskeyPerformMessageSchema,
} from '../src/lib/webauthn-messages'

const requestJson = JSON.stringify({
  origin: 'https://login.example.com',
  rpId: 'example.com',
  challenge: 'challenge',
  userVerificationRequired: false,
  allowCredentials: [],
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
      Effect.runSync(
        Effect.either(
          WebsitePasskeyOptionsMessageSchema.decode({
            type: 'nook:website-passkey-options',
            payload,
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          WebsitePasskeyPerformMessageSchema.decode({
            type: 'nook:website-passkey-perform',
            payload: { ...payload, vaultStoreId: 'store_test' },
          }),
        ),
      )._tag,
    ).toBe('Right')
    expect(
      Effect.runSync(
        Effect.either(
          WebsitePasskeyCancelMessageSchema.decode({
            type: 'nook:website-passkey-cancel',
            payload: { requestId: payload.requestId },
          }),
        ),
      )._tag,
    ).toBe('Right')
  })

  test('rejects oversized, malformed, and unscoped messages', async () => {
    expect(
      Effect.runSync(
        Effect.either(
          WebsitePasskeyOptionsMessageSchema.decode({
            type: 'nook:website-passkey-options',
            payload: {
              requestId: 'short',
              ceremony: 'get',
              requestJson,
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
    expect(
      Effect.runSync(
        Effect.either(
          WebsitePasskeyPerformMessageSchema.decode({
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
        ),
      )._tag,
    ).toBe('Left')
    expect(
      Effect.runSync(
        Effect.either(
          WebsitePasskeyPerformMessageSchema.decode({
            type: 'nook:website-passkey-perform',
            payload: {
              requestId: 'request-1234567890',
              ceremony: 'get',
              requestJson: 'x'.repeat(65_537),
              vaultStoreId: 'store_test',
            },
          }),
        ),
      )._tag,
    ).toBe('Left')
    const parseArgs = {
      ceremony: WebsitePasskeyCeremony.Get,
      requestJson: '{',
    }
    expect(
      await WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest(
        parseArgs,
      ),
    ).toEqual({
      kind: WebsitePasskeyRequestParseKind.Rejected,
    })
  })

  test('models selected and request-default credential states explicitly', async () => {
    const parseArgs = {
      ceremony: WebsitePasskeyCeremony.Get,
      requestJson,
    }
    const parsed =
      await WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest(
        parseArgs,
      )
    expect(parsed.kind).toBe(WebsitePasskeyRequestParseKind.Parsed)
    if (parsed.kind !== WebsitePasskeyRequestParseKind.Parsed) return

    const requestDefaultsArgs: WebsitePasskeyRequestJsonArgs = {
      request: parsed.request,
      credentialSelection: {
        kind: WebsitePasskeyCredentialSelectionKind.RequestDefaults,
      },
    }
    expect(
      JSON.parse(
        WebsitePasskeyOptionsMessageSchema.websitePasskeyRequestJson(
          requestDefaultsArgs,
        ),
      ),
    ).toEqual(JSON.parse(requestJson))

    const selectedArgs: WebsitePasskeyRequestJsonArgs = {
      request: parsed.request,
      credentialSelection: {
        kind: WebsitePasskeyCredentialSelectionKind.Selected,
        credentialId: 'credential_test',
      },
    }
    expect(
      JSON.parse(
        WebsitePasskeyOptionsMessageSchema.websitePasskeyRequestJson(
          selectedArgs,
        ),
      ),
    ).toEqual({
      origin: 'https://login.example.com',
      rpId: 'example.com',
      challenge: 'challenge',
      userVerificationRequired: false,
      allowCredentials: [{ id: 'credential_test' }],
    })

    const emptySelectionArgs: WebsitePasskeyRequestJsonArgs = {
      request: parsed.request,
      credentialSelection: {
        kind: WebsitePasskeyCredentialSelectionKind.Selected,
        credentialId: '',
      },
    }
    expect(() =>
      WebsitePasskeyOptionsMessageSchema.websitePasskeyRequestJson(
        emptySelectionArgs,
      ),
    ).toThrow('Selected passkey credential ID must not be empty.')
  })
  test('rejects a JSON object missing canonical Rust request fields', async () => {
    const result =
      await WebsitePasskeyOptionsMessageSchema.parsedWebsitePasskeyRequest({
        ceremony: WebsitePasskeyCeremony.Get,
        requestJson: JSON.stringify({
          origin: 'https://example.test',
          rpId: 'example.test',
        }),
      })
    expect(result).toEqual({ kind: WebsitePasskeyRequestParseKind.Rejected })
  })
})
