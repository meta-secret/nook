import { err, ok, type Result } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  NookLocalFolderHealth,
  NookLocalFolderHealthState,
  NookVaultManager,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
} from '$app-wasm'
import { LOCAL_FOLDER_PROVIDER_TYPE } from '$lib/auth/provider-types'
import {
  configuredLocalFolder,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedLocalFolderDirectory,
  storedLocalFolderHandle,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import type { ProviderActionsContext } from '$lib/vault/action-contexts'
import { VaultState } from '$lib/vault.svelte'
import { ProviderConnectionActions } from '$lib/vault/provider-connection'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  LoginSetupKind,
  StagedRemoteStorageKind,
} from '$lib/vault/state/provider.svelte'

vi.mock('$lib/runtime/log', () => ({
  browserLogRuntime: {
    createLogger: () => ({ info: vi.fn(), warn: vi.fn() }),
  },
}))

type ProviderConnectionOutcome = Result<
  ProviderSyncOutcome,
  VaultStorageFailure
>

type ProviderConnectionScenario = {
  readonly actions: ProviderConnectionActions
  readonly flushRemoteEventOutboxNow: ReturnType<typeof vi.fn>
  readonly state: VaultState
  readonly syncProviderById: ReturnType<typeof vi.fn>
}

type OwnedManager = {
  readonly manager: NookVaultManager
  readonly state: VaultState
}

const ownedManagers: OwnedManager[] = []

function localFolderProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'local-folder-provider',
    type: LOCAL_FOLDER_PROVIDER_TYPE,
    label: 'Local backup',
    localFolder: configuredLocalFolder({
      directoryName: storedLocalFolderDirectory('Vaults'),
      handleId: storedLocalFolderHandle('local-folder-handle'),
    }),
    storeId: scopedProviderVault('vault-1'),
    createdAt: '2026-09-11T00:00:00Z',
  }
}

function vaultState(): VaultState {
  const browserWindow = globalThis.window
  Reflect.deleteProperty(globalThis, 'window')
  try {
    return new VaultState()
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      writable: true,
      value: browserWindow,
    })
  }
}

function providerConnectionScenario(
  synchronize: (
    state: VaultState,
  ) => ProviderConnectionOutcome | Promise<ProviderConnectionOutcome>,
): ProviderConnectionScenario {
  const provider = localFolderProvider()
  const state = vaultState()
  state.isVerifying = false
  state.addProviderOpen = true
  state.providers = [provider]
  state.errorMsg = ''
  state.openActiveVault('vault-1')
  state.activateLoginSetup(LOCAL_FOLDER_PROVIDER_TYPE)
  const manager = new NookVaultManager()
  state.openManager(manager)
  ownedManagers.push({ manager, state })
  const flushRemoteEventOutboxNow = vi.fn(async () =>
    err(new VaultStorageFailure(VaultStorageFailureKind.BrowserCleanupFailed)),
  )
  const syncProviderById = vi.fn(async () => synchronize(state))
  const injectedPorts = {
    stagedRemoteStorageArgs: () => ({
      kind: StagedRemoteStorageKind.Unavailable,
    }),
    ensureProviderSaved: async () => ok(),
    flushRemoteEventOutboxNow,
    syncProviderById,
  } satisfies Pick<
    ProviderActionsContext,
    | 'stagedRemoteStorageArgs'
    | 'ensureProviderSaved'
    | 'flushRemoteEventOutboxNow'
    | 'syncProviderById'
  >
  Object.assign(state, injectedPorts)
  return {
    actions: new ProviderConnectionActions(state),
    flushRemoteEventOutboxNow,
    state,
    syncProviderById,
  }
}

afterEach(() => {
  for (const owned of ownedManagers) {
    owned.state.clearLocalFolderMultipleVaultsIssue()
    owned.state.clearManager()
    owned.manager.free()
  }
  ownedManagers.length = 0
  vi.restoreAllMocks()
})

describe('local-folder provider connection', () => {
  test('synchronizes a healthy folder exactly once without a preflush', async () => {
    const scenario = providerConnectionScenario(() =>
      ok(ProviderSyncOutcome.Synced),
    )

    await scenario.actions.connectAndSyncStagedProvider()

    expect(scenario.flushRemoteEventOutboxNow).not.toHaveBeenCalled()
    expect(scenario.syncProviderById).toHaveBeenCalledExactlyOnceWith({
      providerId: 'local-folder-provider',
      visibility: ProviderSyncVisibility.Quiet,
      failureHandling: ProviderSyncFailureHandling.Propagate,
    })
    expect(scenario.state.loginSetup.kind).toBe(LoginSetupKind.Inactive)
    expect(scenario.state.addProviderOpen).toBe(false)
  })

  test('preserves a staged store mismatch instead of a generic preflush failure', async () => {
    const scenario = providerConnectionScenario((state) => {
      state.errorMsg = 'store-mismatch-staged'
      return ok(ProviderSyncOutcome.ConflictStaged)
    })

    await scenario.actions.connectAndSyncStagedProvider()

    expect(scenario.flushRemoteEventOutboxNow).not.toHaveBeenCalled()
    expect(scenario.syncProviderById).toHaveBeenCalledOnce()
    expect(scenario.state.errorMsg).toBe('store-mismatch-staged')
    expect(scenario.state.loginSetup.kind).toBe(LoginSetupKind.Active)
    expect(scenario.state.addProviderOpen).toBe(true)
  })

  test('preserves a multiple-vault presentation when propagated sync fails', async () => {
    const scenario = providerConnectionScenario((state) => {
      state.reportLocalFolderMultipleVaults(
        NookLocalFolderHealth.multiple_vaults(
          'local-folder-provider',
          'Local backup',
          ['vault-1', 'vault-2'],
          state.t(I18N_KEYS.AuthStorageSyncFailed),
        ),
      )
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })

    await scenario.actions.connectAndSyncStagedProvider()

    expect(scenario.flushRemoteEventOutboxNow).not.toHaveBeenCalled()
    expect(scenario.syncProviderById).toHaveBeenCalledOnce()
    expect(scenario.state.localFolderHealth.state).toBe(
      NookLocalFolderHealthState.MultipleVaults,
    )
    expect(scenario.state.errorMsg).toBe(
      scenario.state.t(I18N_KEYS.AuthStorageLocalFolderMultipleVaultsShort),
    )
    expect(scenario.state.loginSetup.kind).toBe(LoginSetupKind.Active)
    expect(scenario.state.addProviderOpen).toBe(true)
  })

  test('preserves the typed sync failure outside multiple-vault health', async () => {
    const failure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    const scenario = providerConnectionScenario(() => err(failure))

    await scenario.actions.connectAndSyncStagedProvider()

    expect(scenario.flushRemoteEventOutboxNow).not.toHaveBeenCalled()
    expect(scenario.syncProviderById).toHaveBeenCalledOnce()
    expect(scenario.state.localFolderHealth.state).not.toBe(
      NookLocalFolderHealthState.MultipleVaults,
    )
    expect(scenario.state.errorMsg).toBe(
      scenario.state.t(failure.translationKey),
    )
    expect(scenario.state.loginSetup.kind).toBe(LoginSetupKind.Active)
    expect(scenario.state.addProviderOpen).toBe(true)
  })
})
