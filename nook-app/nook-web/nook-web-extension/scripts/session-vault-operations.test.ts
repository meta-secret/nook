import { err, ok } from 'neverthrow'
import {
  SessionOperationFailure,
  SessionOperationFailureKind,
} from '../src/lib/session-operation-queue'
import { CompanionDiscoveryEndpointKind } from '../src/offscreen/session-vault-operations'
import { describe, expect, test } from 'bun:test'
import {
  DeviceProtectionStatus,
  type AuthProvidersSnapshot,
  type NookExternalEventLogRecords,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { GITHUB_PROVIDER_TYPE } from '../../nook-web-shared/src/vault-app/lib/auth/provider-types'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  CompanionVaultDiscovery,
  type CompanionVaultDiscoveryArgs,
  importExtensionVaultWithDependencies,
  type ImportExtensionVaultDependencies,
  type ImportExtensionVaultWithDependenciesArgs,
  type ExtensionVaultImportManager,
} from '../src/offscreen/session-vault-operations'
import type {
  CompanionExtensionPresence,
  CompanionIdentityDiscoveryObservation,
  NookDiscoveredCompanionExtensionEndpoint,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'

type ImportManagerState = {
  protection: DeviceProtectionStatus
  deviceId: string
  rejectActivation: boolean
  rejectImport: boolean
  operationOrder: string[]
  importedRecords: boolean
  statusFreed: boolean
  replaced: boolean
  saved: boolean
  savedAppId: string
  activatedAppId: string
  activatedAppIds: string[]
  replacedSnapshot: AuthProvidersSnapshot
  savedSnapshot: AuthProvidersSnapshot
}

function githubProvider(): StorageProvider {
  return {
    id: 'github',
    type: GITHUB_PROVIDER_TYPE,
    label: 'Personal GitHub',
    githubPat: { state: 'token', value: 'github_pat_session_secret' },
    githubRepo: { state: 'defaultRepository' },
    oauthFile: { state: 'notApplicable' },
    localFolder: { state: 'notApplicable' },
    storeId: { state: 'unscoped' },
    createdAt: '2026-08-11T00:00:00Z',
    syncCheckpoint: { state: 'neverSynced' },
  }
}

function importRequest(
  provider: StorageProvider,
): ImportExtensionVaultWithDependenciesArgs['message'] {
  return {
    type: ExtensionSessionMessageType.ImportVault,
    payload: {
      vaultStoreId: 'vault',
      deviceId: 'device',
      devicePublicKey: 'public',
      deviceSigningPublicKey: 'signing',
      providers: [provider],
      eventLogRecords: [],
      queue: MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE,
    },
  }
}

function importDependencies(
  provider: StorageProvider,
): ImportExtensionVaultDependencies {
  const records = {} as NookExternalEventLogRecords
  return {
    decodeProviders: () => [provider],
    createRecords: () => records,
  }
}

function importedStatus() {
  return {
    imported: true,
    vaultStoreId: 'vault',
    eventCount: 0,
    heads: [],
    accessGranted: true,
  }
}

function importManager(state: ImportManagerState): ExtensionVaultImportManager {
  return {
    get device_id() {
      return state.deviceId
    },
    import_extension_event_log_records_js: async () => {
      state.operationOrder.push('import')
      state.importedRecords = true
      if (state.rejectImport) throw new Error('import failed')
      return {
        to_object: importedStatus,
        free: () => {
          state.statusFreed = true
        },
      }
    },
    device_protection_status: async () => state.protection,
    replace_auth_providers_for_vault: async (snapshot) => {
      state.replaced = true
      state.replacedSnapshot = snapshot
    },
    save_presealed_auth_providers_snapshot: async (
      ...args: [string, AuthProvidersSnapshot]
    ) => {
      const [appId, snapshot] = args
      state.saved = true
      state.savedAppId = appId
      state.savedSnapshot = snapshot
    },
    activate_local_identity_for_app_id: async (appId: string) => {
      state.operationOrder.push('activate')
      if (state.rejectActivation) throw new Error('activation failed')
      const previousAppId = state.deviceId
      state.activatedAppId = appId
      state.activatedAppIds.push(appId)
      if (state.deviceId !== appId) {
        state.protection = DeviceProtectionStatus.Passkey
      }
      state.deviceId = appId
      return previousAppId
    },
  }
}

function importState(protection: DeviceProtectionStatus): ImportManagerState {
  const emptySnapshot: AuthProvidersSnapshot = {
    providers: [],
    activeVaultStoreId: { state: 'unselected' },
  }
  return {
    protection,
    deviceId: 'device',
    rejectActivation: false,
    rejectImport: false,
    operationOrder: [],
    importedRecords: false,
    statusFreed: false,
    replaced: false,
    saved: false,
    savedAppId: '',
    activatedAppId: '',
    activatedAppIds: [],
    replacedSnapshot: structuredClone(emptySnapshot),
    savedSnapshot: structuredClone(emptySnapshot),
  }
}

describe('extension vault import operations', () => {
  test('replaces the unlocked vault provider snapshot and scrubs credentials', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Unlocked)
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual(
      ok({
        ok: true,
        status: importedStatus(),
      }),
    )
    expect(state.importedRecords).toBe(true)
    expect(state.operationOrder).toEqual(['activate', 'import'])
    expect(state.activatedAppId).toBe('device')
    expect(state.statusFreed).toBe(true)
    expect(state.replaced).toBe(true)
    expect(state.replacedSnapshot.activeVaultStoreId).toEqual({
      state: 'storeId',
      value: 'vault',
    })
    expect(state.saved).toBe(false)
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })

  test('saves the locked vault provider snapshot without requiring unlock', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Pin)
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual(
      ok({
        ok: true,
        status: importedStatus(),
      }),
    )
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(true)
    expect(state.savedAppId).toBe('device')
    expect(state.savedSnapshot.activeVaultStoreId).toEqual({
      state: 'storeId',
      value: 'vault',
    })
    expect(state.operationOrder).toEqual(['activate', 'import'])
    expect(state.activatedAppId).toBe('device')
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })

  test('preserves another unlocked identity instead of rebinding it', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Unlocked)
    state.deviceId = 'other-device'
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Locked)),
    )
    expect(state.importedRecords).toBe(false)
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(false)
    expect(state.activatedAppIds).toEqual([])
    expect(state.operationOrder).toEqual([])
    expect(state.deviceId).toBe('other-device')
    expect(state.protection).toBe(DeviceProtectionStatus.Unlocked)
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })

  test('scrubs decoded provider credentials when event import rejects', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Unlocked)
    state.rejectImport = true
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Failed)),
    )
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(false)
    expect(state.operationOrder).toEqual(['activate', 'import'])
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })

  test('restores the prior locked identity selection when import rejects', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Pin)
    state.deviceId = 'other-device'
    state.rejectImport = true
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Failed)),
    )
    expect(state.activatedAppIds).toEqual(['device', 'other-device'])
    expect(state.operationOrder).toEqual(['activate', 'import', 'activate'])
    expect(state.deviceId).toBe('other-device')
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(false)
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })

  test('aborts before event and provider mutation when identity activation rejects', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Unlocked)
    state.rejectActivation = true
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Failed)),
    )
    expect(state.importedRecords).toBe(false)
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(false)
    expect(state.operationOrder).toEqual(['activate'])
    expect(provider.githubPat).toEqual({ state: 'missing' })
  })
})

enum CompanionVaultOpenOutcome {
  Opened = 'opened',
  Mismatched = 'mismatched',
}

class CompanionVaultDiscoveryScenario {
  readonly operationOrder: string[] = []
  readonly presence = {
    kind: 'unlocked',
    vault_type: 'simple',
    vault_store_id: 'vault',
    vault_name: 'Simple Vault',
    app_key: {
      extensionRuntimeId: 'runtime',
      appKey: {
        appId: 'device',
        encryptionPublicKey: 'public',
        signingPublicKey: 'signing',
        installationLabel: 'Browser',
      },
      nonce: 'nonce',
      scopes: ['vault-access'],
    },
  } satisfies CompanionExtensionPresence

  private readonly discovery = {
    request: {
      requestId: 'request',
      vaultStoreId: 'vault',
      expiresAt: 200,
    },
    observedAt: 100,
  } satisfies CompanionIdentityDiscoveryObservation

  private readonly activeManager: CompanionVaultDiscoveryArgs['activeManager'] =
    {
      open_extension_passkey_vault_js: this.openVault.bind(this),
    }

  private readonly endpoint: CompanionVaultDiscoveryArgs['endpoint'] = {
    kind: CompanionDiscoveryEndpointKind.Initial,
    endpoint: {
      discover: () => new DiscoveredCompanionEndpointFixture(this),
      free: () => {},
    },
  }

  constructor(private readonly openOutcome: CompanionVaultOpenOutcome) {}

  private async openVault(
    ...args: [string, string, string, string]
  ): Promise<void> {
    const [vaultStoreId, deviceId, devicePublicKey, deviceSigningPublicKey] =
      args
    this.operationOrder.push(
      `open:${vaultStoreId}:${deviceId}:${devicePublicKey}:${deviceSigningPublicKey}`,
    )
    if (this.openOutcome === CompanionVaultOpenOutcome.Mismatched) {
      throw new Error('ActiveExtensionVaultMismatch')
    }
  }

  reportUnlocked(): ReturnType<
    Extract<
      CompanionVaultDiscoveryArgs['endpoint'],
      { kind: CompanionDiscoveryEndpointKind.Initial }
    >['endpoint']['discover']
  >['status'] {
    this.operationOrder.push('discover')
    return {
      status: 'unlocked',
      request_id: 'request',
      vault_store_id: 'vault',
      app_key: this.presence.app_key,
    }
  }

  discover() {
    const companionDiscoveryArgs: CompanionVaultDiscoveryArgs = {
      activeManager: this.activeManager,
      endpoint: this.endpoint,
      presence: this.presence,
    }
    const companionDiscovery = new CompanionVaultDiscovery(
      companionDiscoveryArgs,
    )
    return companionDiscovery.discover(this.discovery)
  }
}

class DiscoveredCompanionEndpointFixture implements NookDiscoveredCompanionExtensionEndpoint {
  constructor(private readonly scenario: CompanionVaultDiscoveryScenario) {}

  get status(): NookDiscoveredCompanionExtensionEndpoint['status'] {
    return this.scenario.reportUnlocked()
  }

  authorize_and_seal(
    ..._args: Parameters<
      NookDiscoveredCompanionExtensionEndpoint['authorize_and_seal']
    >
  ): ReturnType<
    NookDiscoveredCompanionExtensionEndpoint['authorize_and_seal']
  > {
    void _args
    throw new Error('Authorization is outside this discovery scenario')
  }

  rediscover(
    ..._args: Parameters<NookDiscoveredCompanionExtensionEndpoint['rediscover']>
  ): NookDiscoveredCompanionExtensionEndpoint {
    void _args
    return this
  }

  free(): void {}

  [Symbol.dispose](): void {
    this.free()
  }
}

describe('companion discovery vault restoration', () => {
  test('reopens a persisted paired vault before reporting unlocked after restart', async () => {
    const scenario = new CompanionVaultDiscoveryScenario(
      CompanionVaultOpenOutcome.Opened,
    )

    const discovery = await scenario.discover()
    expect(discovery.isOk()).toBe(true)
    if (discovery.isErr()) return
    const discovered = discovery.value
    const status = discovered.status

    expect(status.status).toBe('unlocked')
    expect(scenario.operationOrder).toEqual([
      'open:vault:device:public:signing',
      'discover',
    ])
  })

  test('does not report unlocked when Rust rejects the persisted vault identity', async () => {
    const scenario = new CompanionVaultDiscoveryScenario(
      CompanionVaultOpenOutcome.Mismatched,
    )

    await expect(scenario.discover()).resolves.toEqual(
      err(new SessionOperationFailure(SessionOperationFailureKind.Failed)),
    )
    expect(scenario.operationOrder).toEqual([
      'open:vault:device:public:signing',
    ])
  })
})
