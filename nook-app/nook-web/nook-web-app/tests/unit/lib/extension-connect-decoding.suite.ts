import { decode_companion_identity_discovery_observation } from '../../../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import type { ExtensionPairedVaultIdentityDiscoveryMessage } from '../../../../nook-web-shared/src/extension/runtime-messages'
import { describe, expect, test, vi } from 'vitest'
import { Effect } from 'effect'
import {
  NookExtensionIdentityHandoffProviderOutcomeState,
  NookVaultClientPolicy,
  VaultCompanionUnlockDecision,
} from '$app-wasm'
import {
  extensionConnectionBrowser,
  PairedExtensionDiscoveryFailureKind,
  IdentityHandoffResponseDecodeFailureKind,
  identityHandoffResponseDecoder,
  companionResponseDecoder,
} from '$lib/extension/connect'
import type { ExtensionRuntimeResponseObject } from '../../../../nook-web-shared/src/vault-app/lib/extension/extension-response-decoders'

interface IdentityHandoffProviderRejectionCase {
  readonly response: ExtensionRuntimeResponseObject
  readonly state: NookExtensionIdentityHandoffProviderOutcomeState
}

describe('extension identity handoff response decoding', () => {
  test('decodes a successful identity handoff response', () => {
    const decoded = Effect.runSync(
      Effect.result(
        identityHandoffResponseDecoder.decode({
          ok: true,
          envelope: 'encrypted-handoff',
          nextNonce: 'nonce-next',
        }),
      ),
    )

    expect(decoded._tag).toBe('Success')
    if (decoded._tag === 'Failure') expect.fail('handoff response must decode')
    expect(decoded.success).toEqual({
      ok: true,
      envelope: 'encrypted-handoff',
      nextNonce: 'nonce-next',
    })
  })

  test('returns a typed failure for a response with an empty next nonce', () => {
    const decoded = Effect.runSync(
      Effect.result(
        identityHandoffResponseDecoder.decode({
          ok: true,
          envelope: 'encrypted-handoff',
          nextNonce: '',
        }),
      ),
    )

    expect(decoded._tag).toBe('Failure')
    if (decoded._tag === 'Failure') {
      expect(decoded.failure.kind).toBe(
        IdentityHandoffResponseDecodeFailureKind.InvalidResponse,
      )
    }
  })

  test('decodes provider rejection reasons through the Rust-owned outcome', () => {
    const rejectionCases: readonly IdentityHandoffProviderRejectionCase[] = [
      {
        response: {
          ok: false,
          reason: 'extension-identity-unavailable',
        },
        state:
          NookExtensionIdentityHandoffProviderOutcomeState.RetryAfterUnlock,
      },
      {
        response: {
          ok: false,
          reason: 'extension-identity-handoff-not-issued',
        },
        state: NookExtensionIdentityHandoffProviderOutcomeState.RepairPairing,
      },
      {
        response: {
          ok: false,
          reason: 'extension-identity-handoff-failed',
        },
        state: NookExtensionIdentityHandoffProviderOutcomeState.Unavailable,
      },
    ]

    for (const rejectionCase of rejectionCases) {
      const decoded = Effect.runSync(
        Effect.result(
          identityHandoffResponseDecoder.decode(rejectionCase.response),
        ),
      )

      expect(decoded._tag).toBe('Success')
      if (decoded._tag === 'Success') {
        expect(decoded.success).toEqual({
          ok: false,
          state: rejectionCase.state,
        })
      }
    }
  })
})

describe('extension runtime response decoding', () => {
  test('rejects launcher acknowledgements with unrelated fields', () => {
    const decoded = Effect.runSync(
      Effect.result(
        companionResponseDecoder.decodeLauncher({ ok: true, stale: true }),
      ),
    )

    expect(decoded._tag).toBe('Failure')
  })

  test('decodes discovery and paired handoff payload objects', () => {
    const discovery = Effect.runSync(
      Effect.result(
        companionResponseDecoder.decodeIdentityDiscovery({
          ok: true,
          status: { status: 'locked' },
        }),
      ),
    )
    const handoff = Effect.runSync(
      Effect.result(
        companionResponseDecoder.decodeIdentityHandoff({
          ok: true,
          response: { encryptedEnvelope: 'sealed' },
        }),
      ),
    )

    expect(discovery._tag).toBe('Success')
    expect(handoff._tag).toBe('Success')
  })

  test('decodes unlock acknowledgements before request binding is checked', () => {
    const decoded = Effect.runSync(
      Effect.result(
        companionResponseDecoder.decodeUnlock({
          ok: true,
          requestId: 'request-1',
          vaultStoreId: 'store_abcdefghijk',
        }),
      ),
    )

    expect(decoded._tag).toBe('Success')
    if (decoded._tag === 'Failure') expect.fail('unlock response must decode')
    expect(decoded.success).toEqual({
      ok: true,
      requestId: 'request-1',
      vaultStoreId: 'store_abcdefghijk',
    })
  })
})

describe('admitted companion startup discovery', () => {
  test('preserves provider absence separately from delivery failure', async () => {
    const absent =
      await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
        'store_test',
      )
    expect(absent.isErr()).toBe(true)
    if (absent.isErr())
      expect(absent.error.kind).toBe(
        PairedExtensionDiscoveryFailureKind.NotInstalled,
      )
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-123',
    )
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) => args[2](),
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const failed =
      await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
        'store_test',
      )
    expect(failed.isErr()).toBe(true)
    if (failed.isErr())
      expect(failed.error.kind).toBe(
        PairedExtensionDiscoveryFailureKind.Delivery,
      )
    expect(sendMessage).toHaveBeenCalledOnce()
  })

  test('does not reinterpret malformed or unbound responses as semantic absence', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-123',
    )
    const sendMessage = vi.fn(
      (...args: [string, unknown, (response?: unknown) => void]) =>
        args[2]({ ok: true, status: 'malformed' }),
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const malformed =
      await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
        'store_test',
      )
    expect(malformed.isErr()).toBe(true)
    if (malformed.isErr())
      expect(malformed.error.kind).toBe(
        PairedExtensionDiscoveryFailureKind.Decode,
      )
    sendMessage.mockImplementation((...args) =>
      args[2]({
        ok: true,
        status: {
          status: 'locked',
          request_id: 'wrong-request',
          vault_store_id: 'store_test',
        },
      }),
    )
    const rejected =
      await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
        'store_test',
      )
    expect(rejected.isErr()).toBe(true)
    if (rejected.isErr())
      expect(rejected.error.kind).toBe(
        PairedExtensionDiscoveryFailureKind.Admission,
      )
    expect(sendMessage).toHaveBeenCalledTimes(2)
  })

  test('preserves canonical locked status for the real Rust unlock decision', async () => {
    document.documentElement.setAttribute(
      'data-nook-extension-runtime-id',
      'extension-123',
    )
    const sendMessage = vi.fn(
      (
        ...args: [
          string,
          ExtensionPairedVaultIdentityDiscoveryMessage,
          (response?: unknown) => void,
        ]
      ) => {
        const request = decode_companion_identity_discovery_observation(
          args[1].payload,
        ).request
        args[2]({
          ok: true,
          status: {
            status: 'locked',
            request_id: request.requestId,
            vault_store_id: request.vaultStoreId,
          },
        })
      },
    )
    vi.stubGlobal('chrome', { runtime: { sendMessage } })
    const admitted =
      await extensionConnectionBrowser.discoverAdmittedPairedExtensionIdentity(
        'store_test',
      )
    expect(admitted.isOk()).toBe(true)
    if (admitted.isOk()) {
      expect(admitted.value.canonicalStatus.status).toBe('locked')
      expect(
        new NookVaultClientPolicy().companion_unlock_decision(
          admitted.value.canonicalStatus,
        ),
      ).toBe(VaultCompanionUnlockDecision.CompanionDevice)
      expect(admitted.value.discovery.status).toBe('locked')
    }
    expect(sendMessage).toHaveBeenCalledOnce()
  })
})
