import 'fake-indexeddb/auto'
import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
} from 'fake-indexeddb'
import { companionWasmReady } from '../../nook-web-shared/src/extension/companion-ready'
import {
  admit_companion_handoff_response,
  admit_companion_identity_status,
  type CompanionExtensionPresence,
  type CompanionIdentityDiscoveryObservation,
  type CompanionIdentityHandoffAuthorization,
  type CompanionIdentityStatusAdmissionRequest,
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
const previousIndexedDBRuntime = {
  IDBCursor: globalThis.IDBCursor,
  IDBCursorWithValue: globalThis.IDBCursorWithValue,
  IDBDatabase: globalThis.IDBDatabase,
  IDBFactory: globalThis.IDBFactory,
  IDBIndex: globalThis.IDBIndex,
  IDBKeyRange: globalThis.IDBKeyRange,
  IDBObjectStore: globalThis.IDBObjectStore,
  IDBOpenDBRequest: globalThis.IDBOpenDBRequest,
  IDBRequest: globalThis.IDBRequest,
  IDBTransaction: globalThis.IDBTransaction,
  IDBVersionChangeEvent: globalThis.IDBVersionChangeEvent,
  indexedDB: globalThis.indexedDB,
}
const compositionIndexedDBRuntime = {
  IDBCursor,
  IDBCursorWithValue,
  IDBDatabase,
  IDBFactory,
  IDBIndex,
  IDBKeyRange,
  IDBObjectStore,
  IDBOpenDBRequest,
  IDBRequest,
  IDBTransaction,
  IDBVersionChangeEvent,
  indexedDB: new IDBFactory(),
}

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
  const endpoint = new NookCompanionExtensionEndpoint(structuredClone(presence))
  const observation = discovery(requestId)
  const status = endpoint.discover(structuredClone(observation))
  const admissionRequest = {
    discovery: structuredClone(observation),
    status: structuredClone(status),
    observedAt: 110,
  } satisfies CompanionIdentityStatusAdmissionRequest
  const admission = admit_companion_identity_status(
    structuredClone(admissionRequest),
  )
  if (admission.kind !== 'accepted') {
    throw new Error('expected the generated discovery admission to succeed')
  }
  const website = new NookVaultManager()
  const begin = {
    transaction: structuredClone(admission.transaction),
    context: {
      kind: 'paired-vault',
      vault_store_id: extension.vaultStoreId,
    },
  } satisfies CompanionWebsiteHandoffBegin
  const request = website.begin_companion_identity_handoff(
    structuredClone(begin),
  )
  const authorization = {
    request: structuredClone(request),
    observedAt: 120,
    presence: structuredClone(presence),
  } satisfies CompanionIdentityHandoffAuthorization
  return { authorization, endpoint, request, website }
}

beforeAll(async () => {
  Object.assign(globalThis, compositionIndexedDBRuntime)
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

afterAll(() => {
  Object.assign(globalThis, previousIndexedDBRuntime)
})

describe('generated companion protocol composition', () => {
  test('completes discovery, atomic authorization and sealing, and website finish', async () => {
    const { authorization, endpoint, website } = beginHandoff('request-success')
    const response = await endpoint.authorize_and_seal(
      extension,
      structuredClone(authorization),
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
    const invalidAdmission = {
      discovery: discovery('request-invalid'),
      status: invalidStatus,
      observedAt: 110,
    } satisfies CompanionIdentityStatusAdmissionRequest
    expect(admit_companion_identity_status(invalidAdmission)).toEqual({
      kind: 'rejected',
      failure: 'invalid-value',
    })

    const malformed: unknown = { status: 'unlocked' }
    expect(() =>
      Reflect.apply(admit_companion_identity_status, globalThis, [malformed]),
    ).toThrow()

    const handoff = beginHandoff('request-malformed-response')
    expect(
      admit_companion_handoff_response({
        request: handoff.request,
        encryptedEnvelope: '',
      } satisfies CompanionIdentityHandoffResponse),
    ).toEqual({ kind: 'rejected', failure: 'invalid-value' })
    const staleResponse = {
      request: structuredClone(handoff.request),
      encryptedEnvelope: 'sealed',
    } satisfies CompanionIdentityHandoffResponse
    staleResponse.request.transaction.discovery.request.expiresAt =
      staleResponse.request.transaction.admittedAt
    expect(admit_companion_handoff_response(staleResponse)).toEqual({
      kind: 'rejected',
      failure: 'discovery-expired',
    })

    const endpoint = new NookCompanionExtensionEndpoint(
      structuredClone(presence),
    )
    const observation = discovery('request-correlation')
    const status = endpoint.discover(structuredClone(observation))
    endpoint.free()
    const admission = admit_companion_identity_status({
      discovery: structuredClone(observation),
      status: structuredClone(status),
      observedAt: 110,
    })
    if (admission.kind !== 'accepted') {
      throw new Error('expected correlated discovery admission')
    }
    admission.transaction.discovery.request.requestId = 'request-other'
    const mismatched = {
      transaction: admission.transaction,
      context: {
        kind: 'paired-vault',
        vault_store_id: extension.vaultStoreId,
      },
    } satisfies CompanionWebsiteHandoffBegin

    expect(() =>
      new NookVaultManager().begin_companion_identity_handoff(mismatched),
    ).toThrow('does not match the active request')
  })

  test('rejects unrelated and stale status admission in Rust', () => {
    const endpoint = new NookCompanionExtensionEndpoint(
      structuredClone(presence),
    )
    const observation = discovery('request-admission')
    const unrelated = endpoint.discover(structuredClone(observation))
    unrelated.request_id = 'request-other'
    expect(
      admit_companion_identity_status({
        discovery: structuredClone(observation),
        status: unrelated,
        observedAt: 110,
      }),
    ).toEqual({ kind: 'rejected', failure: 'request-mismatch' })

    const wrongVault = endpoint.discover(structuredClone(observation))
    wrongVault.vault_store_id = 'vault-other'
    expect(
      admit_companion_identity_status({
        discovery: structuredClone(observation),
        status: wrongVault,
        observedAt: 110,
      }),
    ).toEqual({ kind: 'rejected', failure: 'request-mismatch' })

    const exact = endpoint.discover(structuredClone(observation))
    endpoint.free()
    expect(
      admit_companion_identity_status({
        discovery: structuredClone(observation),
        status: exact,
        observedAt: 200,
      }),
    ).toEqual({ kind: 'rejected', failure: 'discovery-expired' })
  })

  test('consumes mismatched and replayed authorization', async () => {
    const first = beginHandoff('request-replay')
    const mismatched = structuredClone(first.authorization)
    if (mismatched.request.transaction.status.status !== 'unlocked') {
      throw new Error('expected unlocked transaction')
    }
    mismatched.request.transaction.status.app_key.appKey.appId = 'app-mismatch'
    await expect(
      first.endpoint.authorize_and_seal(extension, mismatched),
    ).rejects.toThrow()
    await expect(
      first.endpoint.authorize_and_seal(
        extension,
        structuredClone(first.authorization),
      ),
    ).rejects.toThrow()
  })

  test('consumes stale authorization and concurrent discovery', async () => {
    const stale = beginHandoff('request-stale')
    stale.authorization.observedAt = 200
    await expect(
      stale.endpoint.authorize_and_seal(
        extension,
        structuredClone(stale.authorization),
      ),
    ).rejects.toThrow()
    await expect(
      stale.endpoint.authorize_and_seal(
        extension,
        structuredClone(stale.authorization),
      ),
    ).rejects.toThrow()

    const concurrent = beginHandoff('request-concurrent')
    expect(() =>
      concurrent.endpoint.discover(discovery('request-other')),
    ).toThrow()
    await expect(
      concurrent.endpoint.authorize_and_seal(
        extension,
        structuredClone(concurrent.authorization),
      ),
    ).rejects.toThrow()
  })

  test('rejects replay and a forged response at retained website state', async () => {
    const first = beginHandoff('request-forged-response')

    const response = await first.endpoint.authorize_and_seal(
      extension,
      structuredClone(first.authorization),
    )
    await expect(
      first.endpoint.authorize_and_seal(
        extension,
        structuredClone(first.authorization),
      ),
    ).rejects.toThrow()

    const forged = structuredClone(
      response,
    ) satisfies CompanionIdentityHandoffResponse
    forged.request.transaction.discovery.request.requestId = 'request-forged'
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
