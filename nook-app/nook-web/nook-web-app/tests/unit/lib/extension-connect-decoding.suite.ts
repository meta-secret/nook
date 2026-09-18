import { describe, expect, test } from 'vitest'
import { Effect } from 'effect'
import {
  IdentityHandoffResponseDecodeFailureKind,
  identityHandoffResponseDecoder,
  companionResponseDecoder,
} from '$lib/extension/connect'

describe('extension identity handoff response decoding', () => {
  test('decodes a successful identity handoff response', () => {
    const decoded = Effect.runSync(
      Effect.either(
        identityHandoffResponseDecoder.decode({
          ok: true,
          envelope: 'encrypted-handoff',
          nextNonce: 'nonce-next',
        }),
      ),
    )

    expect(decoded._tag).toBe('Right')
    if (decoded._tag === 'Left') expect.fail('handoff response must decode')
    expect(decoded.right).toEqual({
      ok: true,
      envelope: 'encrypted-handoff',
      nextNonce: 'nonce-next',
    })
  })

  test('returns a typed failure for a response with an empty next nonce', () => {
    const decoded = Effect.runSync(
      Effect.either(
        identityHandoffResponseDecoder.decode({
          ok: true,
          envelope: 'encrypted-handoff',
          nextNonce: '',
        }),
      ),
    )

    expect(decoded._tag).toBe('Left')
    if (decoded._tag === 'Left') {
      expect(decoded.left.kind).toBe(
        IdentityHandoffResponseDecodeFailureKind.InvalidResponse,
      )
    }
  })
})

describe('extension runtime response decoding', () => {
  test('rejects launcher acknowledgements with unrelated fields', () => {
    const decoded = Effect.runSync(
      Effect.either(
        companionResponseDecoder.decodeLauncher({ ok: true, stale: true }),
      ),
    )

    expect(decoded._tag).toBe('Left')
  })

  test('decodes discovery and paired handoff payload objects', () => {
    const discovery = Effect.runSync(
      Effect.either(
        companionResponseDecoder.decodeIdentityDiscovery({
          ok: true,
          status: { status: 'locked' },
        }),
      ),
    )
    const handoff = Effect.runSync(
      Effect.either(
        companionResponseDecoder.decodeIdentityHandoff({
          ok: true,
          response: { encryptedEnvelope: 'sealed' },
        }),
      ),
    )

    expect(discovery._tag).toBe('Right')
    expect(handoff._tag).toBe('Right')
  })

  test('decodes unlock acknowledgements before request binding is checked', () => {
    const decoded = Effect.runSync(
      Effect.either(
        companionResponseDecoder.decodeUnlock({
          ok: true,
          requestId: 'request-1',
          vaultStoreId: 'store_abcdefghijk',
        }),
      ),
    )

    expect(decoded._tag).toBe('Right')
    if (decoded._tag === 'Left') expect.fail('unlock response must decode')
    expect(decoded.right).toEqual({
      ok: true,
      requestId: 'request-1',
      vaultStoreId: 'store_abcdefghijk',
    })
  })
})
