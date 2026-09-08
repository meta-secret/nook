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
  NookCompanionPairingWebsiteProtocol,
  type CompanionPairingWebsiteAuthorization,
  type CompanionExtensionPresence,
  type CompanionIdentityDiscoveryObservation,
  type CompanionIdentityHandoffAuthorization,
  type CompanionIdentityStatusAdmissionRequest,
  type CompanionIdentityStatus,
  type CompanionUnlockedAppKey,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  default as initNookWasm,
  companion_pairing_provider_manifest_digest,
  configure_vault_application,
  NookCompanionExtensionEndpoint,
  NookCompanionPairingExtensionEndpoint,
  NookExternalEventLogRecords,
  NookPreparedCompanionPairingActivation,
  NookVaultManager,
  NookPrevalidatedCompanionPairingApproval,
  seal_auth_providers_for_device_public_key,
  VaultApplication,
  type CompanionPairingRequest,
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

function pairingAttempt(requestId: string, substituteProvider: boolean) {
  const request = {
    requestId,
    nonce: `nonce-${requestId}`,
    issuedAt: 100,
    expiresAt: 200,
    vaultType: 'simple',
    installation: {
      extensionRuntimeId: 'composition-runtime',
      appId: extension.device_id,
      encryptionPublicKey: extension.device_public_key,
      signingPublicKey: unlockedAppKey.appKey.signingPublicKey,
      installationLabel: 'Composition Extension',
    },
    scopes: ['vault-access', 'sync-provider-credentials'],
  } satisfies CompanionPairingRequest
  const extensionProtocol = new NookCompanionPairingExtensionEndpoint(request)
  const authority = extensionProtocol.take_authority()
  extensionProtocol.free()
  const websiteProtocol = new NookCompanionPairingWebsiteProtocol({
    request: structuredClone(request),
    observedAt: 120,
  })
  const providers = seal_auth_providers_for_device_public_key(
    extension.device_public_key,
    {
      providers: [
        {
          id: `github-${requestId}`,
          type: 'github',
          label: 'Composition GitHub',
          githubPat: { state: 'token', value: 'github_pat_pairing_secret' },
          githubRepo: { state: 'defaultRepository' },
          oauthFile: { state: 'notApplicable' },
          localFolder: { state: 'notApplicable' },
          storeId: { state: 'storeId', value: extension.vaultStoreId },
          syncCheckpoint: { state: 'neverSynced' },
          createdAt: '2026-09-07T00:00:00Z',
        },
      ],
      activeVaultStoreId: {
        state: 'storeId',
        value: extension.vaultStoreId,
      },
    },
  )
  const authorization = {
    request: structuredClone(request),
    observedAt: 130,
    vaultStoreId: extension.vaultStoreId,
    vaultName: extension.vaultName,
    approvedAt: '2026-09-07T00:00:00Z',
  } satisfies CompanionPairingWebsiteAuthorization
  const approval = websiteProtocol.authorize(
    authorization,
    companion_pairing_provider_manifest_digest(providers),
  )
  if (approval.kind !== 'approved') {
    throw new Error('expected generated website pairing approval')
  }
  if (substituteProvider) {
    const provider = providers.providers[0]
    if (!provider) throw new Error('expected pairing provider')
    provider.label = 'Substituted Provider'
  }
  return authority.prevalidate(
    extension,
    { approval: approval.approval, observedAt: 150 },
    providers,
  )
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
  await extension.set_vault_name('Composition Vault')

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
    vault_name: extension.vaultName,
    app_key: unlockedAppKey,
  } satisfies CompanionExtensionPresence
})

afterAll(() => {
  extension.free()
  Object.assign(globalThis, previousIndexedDBRuntime)
})

describe('generated companion protocol composition', () => {
  test('prevalidates sealed providers and rejects manifest substitution', () => {
    for (const [requestId, substituteProvider] of [
      ['pairing-success', false],
      ['pairing-substitution', true],
    ] as const) {
      if (substituteProvider) {
        expect(() => pairingAttempt(requestId, true)).toThrow(
          'ProviderManifestMismatch',
        )
      } else {
        const admission = pairingAttempt(requestId, false)
        expect(admission).toBeInstanceOf(
          NookPrevalidatedCompanionPairingApproval,
        )
        admission.free()
      }
    }
  })

  test('prepares pairing activation through generated owned wrappers', async () => {
    const exported = await extension.export_event_log_records_js()
    const eventRecords = exported.to_array()
    exported.free()

    const approval = pairingAttempt('pairing-activation', false)
    const records = NookExternalEventLogRecords.from_array(eventRecords)
    const prepared = approval.with_event_log(records)
    expect(prepared).toBeInstanceOf(NookPreparedCompanionPairingActivation)
    prepared.free()
  })

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
