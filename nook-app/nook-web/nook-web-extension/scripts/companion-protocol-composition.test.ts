import 'fake-indexeddb/auto'
import { beforeAll, describe, expect, test } from 'bun:test'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  NookCompanionExtensionProtocol,
  admit_companion_handoff_response,
  admit_companion_identity_status,
  type CompanionExtensionPresence,
  type CompanionIdentityDiscoveryObservation,
  type CompanionIdentityStatus,
  type CompanionUnlockedAppKey,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  default as initNookWasm,
  configure_vault_application,
  NookCompanionExtensionEndpoint,
  NookVaultManager,
  VaultApplication,
  type CompanionIdentityHandoffResponse,
  type CompanionWebsiteHandoffBegin,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'

let extension: NookVaultManager
let presence: CompanionExtensionPresence
let unlockedAppKey: CompanionUnlockedAppKey

function discovery(requestId: string): CompanionIdentityDiscoveryObservation {
  return {
    request: {
      requestId,
      vaultStoreId: extension.vaultStoreId,
      expiresAt: 200,
    },
    observedAt: 100,
  } satisfies CompanionIdentityDiscoveryObservation
}

function beginHandoff(requestId: string) {
  const protocol = new NookCompanionExtensionProtocol(structuredClone(presence))
  const observation = discovery(requestId)
  const status = protocol.discover(structuredClone(observation))
  const website = new NookVaultManager()
  const begin = {
    discovery: structuredClone(observation),
    status: structuredClone(status),
    context: {
      kind: 'paired-vault',
      vault_store_id: extension.vaultStoreId,
    },
  } satisfies CompanionWebsiteHandoffBegin
  const request = website.begin_companion_identity_handoff(
    structuredClone(begin),
  )
  const endpoint = new NookCompanionExtensionEndpoint(structuredClone(presence))
  return { endpoint, request, website }
}

beforeAll(async () => {
  const nookWasmBytes = await Bun.file(
    new URL(
      '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm_bg.wasm',
      import.meta.url,
    ),
  ).arrayBuffer()
  await Promise.all([
    companionWasmReady,
    initNookWasm({ module_or_path: nookWasmBytes }),
  ])
  configure_vault_application(VaultApplication.Extension)
  extension = new NookVaultManager()
  await extension.delete_local_browser_data()
  const setup = await extension.begin_device_protection()
  try {
    await extension.finish_device_protection(
      new Uint8Array(32).fill(7),
      setup.userHandle,
      setup.prfInput,
      new Uint8Array(32).fill(11),
    )
  } finally {
    setup.free()
  }
  const records = await extension.connect_fresh('local', '', '')
  for (const record of records) record.free()

  unlockedAppKey = {
    extensionRuntimeId: 'composition-runtime',
    appKey: {
      appId: extension.device_id,
      encryptionPublicKey: extension.device_public_key,
      signingPublicKey: await extension.device_signing_public_key_js(),
      installationLabel: 'Composition Extension',
    },
    nonce: 'composition-nonce',
    scopes: ['vault-access'],
  } satisfies CompanionUnlockedAppKey
  presence = {
    kind: 'unlocked',
    vault_type: 'simple',
    vault_store_id: extension.vaultStoreId,
    vault_name: 'Composition Vault',
    app_key: unlockedAppKey,
  } satisfies CompanionExtensionPresence
})

describe('generated companion protocol composition', () => {
  test('completes discovery, atomic authorization and sealing, and website finish', async () => {
    const { endpoint, request, website } = beginHandoff('request-success')
    const response = await endpoint.authorize_and_seal(
      extension,
      structuredClone(request),
    )
    const admission = admit_companion_handoff_response(
      structuredClone(response),
    )
    expect(admission.kind).toBe('accepted')
    if (admission.kind !== 'accepted') {
      throw new Error('expected the generated response admission to succeed')
    }

    await website.finish_companion_identity_handoff(
      structuredClone(admission.response),
    )

    expect(response.encryptedEnvelope).toContain('BEGIN AGE ENCRYPTED FILE')
    expect(website.device_id).toBe(extension.device_id)
    expect(website.device_public_key).toBe(extension.device_public_key)
    expect(await website.device_signing_public_key_js()).toBe(
      unlockedAppKey.appKey.signingPublicKey,
    )
  })

  test('rejects malformed values and mismatched discovery correlation in Rust', () => {
    const invalidStatus = {
      status: 'unlocked',
      request_id: '',
      vault_store_id: extension.vaultStoreId,
      app_key: structuredClone(unlockedAppKey),
    } satisfies CompanionIdentityStatus
    expect(admit_companion_identity_status(invalidStatus)).toEqual({
      kind: 'rejected',
      failure: 'invalid-value',
    })

    const malformed: unknown = { status: 'unlocked' }
    expect(() =>
      Reflect.apply(admit_companion_identity_status, undefined, [malformed]),
    ).toThrow()

    const handoff = beginHandoff('request-malformed-response')
    expect(
      admit_companion_handoff_response({
        request: handoff.request,
        encryptedEnvelope: '',
      } satisfies CompanionIdentityHandoffResponse),
    ).toEqual({ kind: 'rejected', failure: 'invalid-value' })

    const protocol = new NookCompanionExtensionProtocol(
      structuredClone(presence),
    )
    const observation = discovery('request-correlation')
    const status = protocol.discover(structuredClone(observation))
    observation.request.requestId = 'request-other'
    const mismatched = {
      discovery: observation,
      status,
      context: {
        kind: 'paired-vault',
        vault_store_id: extension.vaultStoreId,
      },
    } satisfies CompanionWebsiteHandoffBegin

    expect(() =>
      new NookVaultManager().begin_companion_identity_handoff(mismatched),
    ).toThrow('does not match the active request')
  })

  test('rejects an app-key mismatch, replay, and forged response', async () => {
    const first = beginHandoff('request-replay')
    const mismatchedRequest = structuredClone(first.request)
    mismatchedRequest.expectedAppKey.appId = 'app-mismatch'
    await expect(
      first.endpoint.authorize_and_seal(extension, mismatchedRequest),
    ).rejects.toThrow('does not match the discovered installation')

    const response = await first.endpoint.authorize_and_seal(
      extension,
      structuredClone(first.request),
    )
    await expect(
      first.endpoint.authorize_and_seal(
        extension,
        structuredClone(first.request),
      ),
    ).rejects.toThrow('already consumed')

    const forged = structuredClone(
      response,
    ) satisfies CompanionIdentityHandoffResponse
    forged.request.requestId = 'request-forged'
    await expect(
      first.website.finish_companion_identity_handoff(forged),
    ).rejects.toThrow('does not match the active request')
    await expect(
      first.website.finish_companion_identity_handoff(
        structuredClone(response),
      ),
    ).rejects.toThrow('not pending')
  })
})
