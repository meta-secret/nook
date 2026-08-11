import { describe, expect, test } from 'bun:test'
import {
  DeviceProtectionStatus,
  type AuthProvidersSnapshot,
  type NookExternalEventLogRecords,
  type NookVaultManager,
  type StorageProvider,
} from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import { MESSAGE_DEFAULT_EXTENSION_SESSION_QUEUE } from '../src/offscreen/session-request-adapter'
import {
  importExtensionVaultWithDependencies,
  type ImportExtensionVaultDependencies,
  type ImportExtensionVaultWithDependenciesArgs,
} from '../src/offscreen/session-vault-operations'

type ImportManagerState = {
  protection: DeviceProtectionStatus
  rejectImport: boolean
  importedRecords: boolean
  statusFreed: boolean
  replaced: boolean
  saved: boolean
  replacedSnapshot: AuthProvidersSnapshot
  savedSnapshot: AuthProvidersSnapshot
}

function githubProvider(): StorageProvider {
  return {
    id: 'github',
    type: 'github',
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
  const records = {} as object as NookExternalEventLogRecords
  return {
    decodeProviders: () => [provider],
    createRecords: () => records,
  }
}

function importManager(state: ImportManagerState): NookVaultManager {
  return {
    importExtensionEventLogRecords: async () => {
      state.importedRecords = true
      if (state.rejectImport) throw new Error('import failed')
      return {
        toObject: () => ({ imported: true }),
        free: () => {
          state.statusFreed = true
        },
      }
    },
    deviceProtectionStatus: async () => state.protection,
    replaceAuthProvidersForVault: async (snapshot) => {
      state.replaced = true
      state.replacedSnapshot = snapshot
    },
    savePresealedAuthProviders: async (snapshot: AuthProvidersSnapshot) => {
      state.saved = true
      state.savedSnapshot = snapshot
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
    rejectImport: false,
    importedRecords: false,
    statusFreed: false,
    replaced: false,
    saved: false,
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
    expect(state.savedSnapshot.activeVaultStoreId).toEqual({
      state: 'storeId',
      value: 'vault',
    })
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
    expect(provider).not.toHaveProperty('githubPat')
  })
})
