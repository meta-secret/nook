import { describe, expect, test } from 'bun:test'
import {
  DeviceProtectionStatus,
  type AuthProvidersSnapshot,
  type NookExternalEventLogRecords,
  type NookVaultManager,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { GITHUB_PROVIDER_TYPE } from '../../nook-web-shared/src/vault-app/lib/auth/provider-types'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  importExtensionVaultWithDependencies,
  type ImportExtensionVaultDependencies,
  type ImportExtensionVaultWithDependenciesArgs,
} from '../src/offscreen/session-vault-operations'

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
  replacedSnapshot: AuthProvidersSnapshot
  savedSnapshot: AuthProvidersSnapshot
}

function githubProvider(): StorageProvider {
  return {
    id: 'github',
    type: GITHUB_PROVIDER_TYPE,
    label: 'Personal GitHub',
    githubPat: 'github_pat_session_secret',
    githubRepo: { state: 'defaultRepository' },
    oauthFile: { state: 'notApplicable' },
    localFolder: { state: 'notApplicable' },
    storeId: { state: 'unscoped' },
    createdAt: '2026-08-11T00:00:00Z',
  } as StorageProvider
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

function importManager(state: ImportManagerState): NookVaultManager {
  return {
    get device_id() {
      return state.deviceId
    },
    import_extension_event_log_records_js: async () => {
      state.operationOrder.push('import')
      state.importedRecords = true
      if (state.rejectImport) throw new Error('import failed')
      return {
        to_object: () => ({ imported: true }),
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
      state.activatedAppId = appId
      if (state.deviceId !== appId) {
        state.deviceId = ''
        state.protection = DeviceProtectionStatus.Passkey
      }
    },
  } as NookVaultManager
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

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual({
      ok: true,
      status: { imported: true },
    })
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
    expect(provider).not.toHaveProperty('githubPat')
  })

  test('saves the locked vault provider snapshot without requiring unlock', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Pin)
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual({
      ok: true,
      status: { imported: true },
    })
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(true)
    expect(state.savedAppId).toBe('device')
    expect(state.savedSnapshot.activeVaultStoreId).toEqual({
      state: 'storeId',
      value: 'vault',
    })
    expect(state.operationOrder).toEqual(['activate', 'import'])
    expect(state.activatedAppId).toBe('device')
    expect(provider).not.toHaveProperty('githubPat')
  })

  test('rebinds to the granted app when another identity remains unlocked', async () => {
    const provider = githubProvider()
    const state = importState(DeviceProtectionStatus.Unlocked)
    state.deviceId = 'other-device'
    const args: ImportExtensionVaultWithDependenciesArgs = {
      activeManager: importManager(state),
      message: importRequest(provider),
      dependencies: importDependencies(provider),
    }

    await expect(importExtensionVaultWithDependencies(args)).resolves.toEqual({
      ok: true,
      status: { imported: true },
    })
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(true)
    expect(state.savedAppId).toBe('device')
    expect(state.savedSnapshot.activeVaultStoreId).toEqual({
      state: 'storeId',
      value: 'vault',
    })
    expect(state.activatedAppId).toBe('device')
    expect(state.operationOrder).toEqual(['activate', 'import'])
    expect(state.protection).toBe(DeviceProtectionStatus.Passkey)
    expect(provider).not.toHaveProperty('githubPat')
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

    await expect(importExtensionVaultWithDependencies(args)).rejects.toThrow(
      'import failed',
    )
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(false)
    expect(state.operationOrder).toEqual(['activate', 'import'])
    expect(provider).not.toHaveProperty('githubPat')
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

    await expect(importExtensionVaultWithDependencies(args)).rejects.toThrow(
      'activation failed',
    )
    expect(state.importedRecords).toBe(false)
    expect(state.replaced).toBe(false)
    expect(state.saved).toBe(false)
    expect(state.operationOrder).toEqual(['activate'])
    expect(provider).not.toHaveProperty('githubPat')
  })
})
