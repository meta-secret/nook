import 'fake-indexeddb/auto'
import { rejects } from 'node:assert/strict'
import { afterAll, beforeAll, describe, expect, spyOn, test } from 'bun:test'
import { Effect } from 'effect'
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
import * as nook_companion_wasm from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import * as nook_wasm from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'
import {
  classify_extension_persistence_databases,
  classify_extension_persistence_stores,
  ExtensionPersistenceArea,
  ExtensionPersistenceDatabaseState,
  ExtensionPersistenceStoreState,
  type ExtensionPersistenceObservation,
  NookCompanionPairingWebsiteProtocol,
  type CompanionPairingWebsiteAuthorization,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import {
  default_password_generation_options,
  generate_password,
  default as initNookWasm,
  companion_pairing_provider_manifest_digest,
  configure_vault_application,
  NookCompanionPairingCandidateFailure,
  type NookCompanionPairingCandidateOutcome,
  NookCompanionPairingCandidateOutcomeState,
  NookCompanionPairingExtensionEndpoint,
  NookExternalEventLogRecords,
  NookPreparedCompanionPairingActivation,
  NookStoredCompanionPairingActivationCandidate,
  NookVaultManager,
  NookSecretFormFields,
  SecretType,
  build_secret_yaml,
  NookPrevalidatedCompanionPairingApproval,
  seal_auth_providers_for_device_public_key,
  VaultApplication,
  type CompanionPairingRequest,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm.js'

type GeneralLoginCompositionContext = {
  readonly self: GeneralLoginCompositionScenario
}

class GeneralLoginCompositionScenario {
  private readonly context: GeneralLoginCompositionContext = { self: this }

  constructor(private readonly manager: NookVaultManager) {}

  readonly verify = Effect.fn(this.context, function* () {
    const first = NookSecretFormFields.login(
      'https://accounts.arbitrary-widget.com/login',
      'synthetic-first',
      'synthetic-first-password',
      '',
    )
    const selected = NookSecretFormFields.login(
      'https://arbitrary-widget.com/login',
      'synthetic-selected',
      'synthetic-selected-password',
      '',
    )
    const tenant = NookSecretFormFields.login(
      'https://www.github.io/login',
      'synthetic-private-tenant',
      'synthetic-private-password',
      '',
    )
    try {
      yield* Effect.tryPromise(() =>
        this.manager.add_secret(
          'secret_General0001',
          SecretType.Login,
          build_secret_yaml(first),
        ),
      )
      yield* Effect.tryPromise(() =>
        this.manager.add_secret(
          'secret_General0002',
          SecretType.Login,
          build_secret_yaml(selected),
        ),
      )
      yield* Effect.tryPromise(() =>
        this.manager.add_secret(
          'secret_General0003',
          SecretType.Login,
          build_secret_yaml(tenant),
        ),
      )
    } finally {
      first.free()
      selected.free()
      tenant.free()
    }

    const reveal = spyOn(this.manager, 'reveal_website_login_for_fill')
    try {
      const accounts = yield* Effect.tryPromise(() =>
        this.manager.list_website_login_accounts(
          'https://checkout.arbitrary-widget.com',
        ),
      )
      try {
        const identities = accounts.map((account) => account.secretId).sort()
        const expected: string[] = ['secret_General0001', 'secret_General0002']
        expect(identities).toEqual(expected)
        expect(reveal).toHaveBeenCalledTimes(0)
        // An explicit picker choice carries only the selected opaque identity.
        const chosenIdentity = 'secret_General0002'
        const credential = yield* Effect.tryPromise(() =>
          this.manager.reveal_website_login_for_fill(
            chosenIdentity,
            'https://checkout.arbitrary-widget.com',
          ),
        )
        try {
          expect(credential.username).toBe('synthetic-selected')
          expect(credential.password).toBe('synthetic-selected-password')
          expect(reveal).toHaveBeenCalledTimes(1)
        } finally {
          credential.free()
        }
      } finally {
        for (const account of accounts) account.free()
      }

      const sameTenant = yield* Effect.tryPromise(() =>
        this.manager.list_website_login_accounts('https://www.github.io'),
      )
      try {
        expect(sameTenant).toHaveLength(1)
        expect(sameTenant[0]?.secretId).toBe('secret_General0003')
        expect(sameTenant[0]?.websiteHost).toBe('github.io')
      } finally {
        for (const account of sameTenant) account.free()
      }

      const unrelated = yield* Effect.tryPromise(() =>
        this.manager.list_website_login_accounts('https://other.github.io'),
      )
      try {
        expect(unrelated).toHaveLength(0)
      } finally {
        for (const account of unrelated) account.free()
      }
      yield* Effect.tryPromise(() =>
        rejects(
          this.manager.reveal_website_login_for_fill(
            'secret_General0003',
            'https://other.github.io',
          ),
          Error,
        ),
      )
    } finally {
      reveal.mockRestore()
    }
  })
}

let extension: NookVaultManager
let extensionOwned = false
let extensionAppId = ''
let extensionSigningPublicKey = ''
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

type CompanionPairingApprovalFixtureRequest = {
  readonly requestId: string
  readonly substituteProvider: boolean
}

class CompanionPairingApprovalFixture {
  static assertManifestPrevalidation(): void {
    for (const [requestId, substituteProvider] of [
      ['pairing-success', false],
      ['pairing-substitution', true],
    ] as const) {
      const request: CompanionPairingApprovalFixtureRequest = {
        requestId,
        substituteProvider,
      }
      if (substituteProvider) {
        expect(() => this.attempt(request)).toThrow('ProviderManifestMismatch')
      } else {
        const admission = this.attempt(request)
        expect(admission).toBeInstanceOf(
          NookPrevalidatedCompanionPairingApproval,
        )
        admission.free()
      }
    }
  }

  static attempt(request: CompanionPairingApprovalFixtureRequest) {
    const { requestId, substituteProvider } = request
    const pairingRequest = {
      requestId,
      nonce: `nonce-${requestId}`,
      issuedAt: 100,
      expiresAt: Number.MAX_SAFE_INTEGER,
      vaultType: 'simple',
      installation: {
        extensionRuntimeId: 'composition-runtime',
        appId: extension.device_id,
        encryptionPublicKey: extension.device_public_key,
        signingPublicKey: extensionSigningPublicKey,
        installationLabel: 'Composition Extension',
      },
      scopes: ['vault-access', 'sync-provider-credentials'],
    } satisfies CompanionPairingRequest
    const extensionProtocol = new NookCompanionPairingExtensionEndpoint(
      pairingRequest,
    )
    const authority = extensionProtocol.take_authority()
    const websiteProtocol = new NookCompanionPairingWebsiteProtocol({
      request: structuredClone(pairingRequest),
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
      request: structuredClone(pairingRequest),
      observedAt: 130,
      vaultStoreId: extension.vaultStoreId,
      vaultName: extension.vaultName,
      approvedAt: 1_788_739_200_000,
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
}

class PairingActivationScenario {
  private static storedCandidate(
    outcome: NookCompanionPairingCandidateOutcome,
  ): NookStoredCompanionPairingActivationCandidate {
    const state = outcome.state
    switch (state) {
      case NookCompanionPairingCandidateOutcomeState.Stored:
        return outcome.into_stored()
      case NookCompanionPairingCandidateOutcomeState.Rejected:
        throw new Error(`candidate storage rejected: ${outcome.into_failure()}`)
      default:
        throw new Error(
          `unreachable candidate outcome: ${state satisfies never}`,
        )
    }
  }

  private static candidateFailure(
    outcome: NookCompanionPairingCandidateOutcome,
  ): NookCompanionPairingCandidateFailure {
    const state = outcome.state
    switch (state) {
      case NookCompanionPairingCandidateOutcomeState.Stored:
        outcome.into_stored().free()
        throw new Error('candidate storage unexpectedly succeeded')
      case NookCompanionPairingCandidateOutcomeState.Rejected:
        return outcome.into_failure()
      default:
        throw new Error(
          `unreachable candidate outcome: ${state satisfies never}`,
        )
    }
  }

  static async run(): Promise<void> {
    const exported = await extension.export_event_log_records_js()
    const eventRecords = exported.to_array()
    exported.free()

    const approvalRequest: CompanionPairingApprovalFixtureRequest = {
      requestId: 'pairing-activation',
      substituteProvider: false,
    }
    const approval = CompanionPairingApprovalFixture.attempt(approvalRequest)
    const records = NookExternalEventLogRecords.from_array(eventRecords)
    const prepared = approval.with_event_log(records)
    expect(prepared).toBeInstanceOf(NookPreparedCompanionPairingActivation)
    const stored = this.storedCandidate(await prepared.commit(extension))
    expect(stored).toBeInstanceOf(NookStoredCompanionPairingActivationCandidate)
    stored.free()
    const replayApprovalRequest: CompanionPairingApprovalFixtureRequest = {
      requestId: 'pairing-activation-replay',
      substituteProvider: false,
    }
    const replayApproval = CompanionPairingApprovalFixture.attempt(
      replayApprovalRequest,
    )
    const replayRecords = NookExternalEventLogRecords.from_array(eventRecords)
    const replay = await replayApproval
      .with_event_log(replayRecords)
      .commit(extension)
    expect(this.candidateFailure(replay)).toBe(
      NookCompanionPairingCandidateFailure.Replay,
    )

    const invalidApprovalRequest: CompanionPairingApprovalFixtureRequest = {
      requestId: 'pairing-activation-empty',
      substituteProvider: false,
    }
    const invalidApproval = CompanionPairingApprovalFixture.attempt(
      invalidApprovalRequest,
    )
    const invalidRecords = NookExternalEventLogRecords.from_array([])
    expect(() => invalidApproval.with_event_log(invalidRecords)).toThrow()
  }
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

let compositionSetup: Promise<void> | false = false

beforeAll(() => {
  compositionSetup = (async () => {
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
    extensionOwned = true
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
    await extension.connect_fresh('local', '', '')
    await extension.set_vault_name('Composition Vault')
    extensionAppId = extension.device_id
    extensionSigningPublicKey = await extension.device_signing_public_key_js()
  })()
  return compositionSetup
})

afterAll(async () => {
  try {
    if (compositionSetup) await compositionSetup
  } finally {
    try {
      if (extensionOwned) {
        extension.free()
        extensionOwned = false
      }
    } finally {
      Object.assign(globalThis, previousIndexedDBRuntime)
    }
  }
})

describe('generated companion protocol composition', () => {
  test('both generated packages project the same four canonical scopes', () => {
    expect([
      nook_companion_wasm.extension_vault_access_scope(),
      nook_companion_wasm.extension_password_filling_scope(),
      nook_companion_wasm.extension_passkey_management_scope(),
      nook_companion_wasm.extension_sync_provider_credentials_scope(),
    ]).toEqual([
      nook_wasm.extension_vault_access_scope(),
      nook_wasm.extension_password_filling_scope(),
      nook_wasm.extension_passkey_management_scope(),
      nook_wasm.extension_sync_provider_credentials_scope(),
    ])
  })
  test('generated companion persistence distinguishes present database and absent store', () => {
    const database: ExtensionPersistenceObservation = {
      area: ExtensionPersistenceArea.Pairing,
      observedNames: ['nook_extension'],
    }
    const stores: ExtensionPersistenceObservation = {
      area: ExtensionPersistenceArea.Pairing,
      observedNames: ['unrelated'],
    }
    expect(classify_extension_persistence_databases(database)).toBe(
      ExtensionPersistenceDatabaseState.Present,
    )
    expect(classify_extension_persistence_stores(stores)).toBe(
      ExtensionPersistenceStoreState.Absent,
    )
  })
  test('generated default options produce a twenty-character password', () => {
    expect(
      generate_password(default_password_generation_options()),
    ).toHaveLength(20)
  })

  test('generated login listing rejects invalid origins as JavaScript errors and allows valid unmatched origins', async () => {
    for (const origin of ['', 'https://']) {
      const listing = extension.list_website_login_accounts(origin)
      await rejects(listing, Error)
      await rejects(listing, /Invalid requesting login origin:/)
    }

    const accounts = await extension.list_website_login_accounts(
      'https://unmatched.example',
    )
    try {
      expect(accounts).toEqual([])
    } finally {
      for (const account of accounts) account.free()
    }
  })

  test('real WASM lists arbitrary sibling logins, reveals the chosen identity and isolates private tenants', () => {
    const scenario = new GeneralLoginCompositionScenario(extension)
    return Effect.runPromise(scenario.verify())
  })

  test('real WASM lists the site-bound kinds matched to an origin as display fields only', async () => {
    const login = NookSecretFormFields.login(
      'https://www.sitelisting.example/login',
      'site-user',
      'site-listing-password',
      '',
    )
    const authenticator = NookSecretFormFields.authenticator(
      'Sitelisting',
      'site-user',
      'https://www.sitelisting.example',
      'JBSWY3DPEHPK3PXP',
      'SHA1',
      '6',
      '30',
      '',
    )
    const apiKey = NookSecretFormFields.api_key(
      'https://www.sitelisting.example',
      'sk-site-listing-key',
      '',
    )
    const added: Array<[string, SecretType, NookSecretFormFields]> = [
      ['secret_SiteLst0001', SecretType.Login, login],
      ['secret_SiteLst0002', SecretType.Authenticator, authenticator],
      ['secret_SiteLst0003', SecretType.ApiKey, apiKey],
    ]
    try {
      for (const [secretId, type, fields] of added) {
        await extension.add_secret(secretId, type, build_secret_yaml(fields))
      }
    } finally {
      for (const [, , fields] of added) fields.free()
    }

    const matches = await extension.list_website_site_secrets(
      'https://www.sitelisting.example',
    )
    expect(
      matches.items.map((item) => [item.kind, item.secret_id]).sort(),
    ).toEqual([
      ['ApiKey', 'secret_SiteLst0003'],
      ['Authenticator', 'secret_SiteLst0002'],
      ['Login', 'secret_SiteLst0001'],
    ])
    const wire = JSON.stringify(matches)
    for (const secret of [
      'site-listing-password',
      'JBSWY3DPEHPK3PXP',
      'sk-site-listing-key',
    ]) {
      expect(wire).not.toContain(secret)
    }
    const unrelated = await extension.list_website_site_secrets(
      'https://unrelated.example',
    )
    expect(unrelated.items).toEqual([])
    await rejects(extension.list_website_site_secrets(''), Error)
  })

  test('resolves stored Sentinel deliveries without borrowing the live manager', async () => {
    const request = extension.sentinel_stored_deliveries_request()
    const resolution = request.resolve()

    expect(extension.device_id).toBe(extensionAppId)
    expect(extension.vaultStoreId).not.toBe('')

    try {
      const deliveries = await resolution
      try {
        expect(deliveries).toEqual([])
      } finally {
        for (const delivery of deliveries) delivery.free()
      }
    } finally {
      request.free()
    }
  })

  test('prevalidates sealed providers and rejects manifest substitution', () => {
    CompanionPairingApprovalFixture.assertManifestPrevalidation()
  })

  test('stores pairing activation through generated owned wrappers', async () => {
    await PairingActivationScenario.run()
  })
})
