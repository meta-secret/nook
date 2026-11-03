import { err, ok, type Result } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  draft_storage_args,
  NookLocalFolderHealth,
  NookLocalFolderHealthState,
  NookVaultManager,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  type StorageConnection,
} from '$app-wasm'
import { scopedProviderVault, type StorageProvider } from '$lib/auth/providers'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import {
  VaultOperationStale,
  VaultOperationStaleKind,
} from '$lib/runtime/vault-operation-stale'
import type { ProviderActionsContext } from '$lib/vault/action-contexts'
import { VaultState } from '$lib/vault.svelte'
import { ProviderConnectionActions } from '$lib/vault/provider-connection'
import { ProviderConnectionPhase } from '$lib/vault/provider-connection-progress'
import { ProviderSetupKinds } from '$lib/vault/provider-setup-kinds'
import { ProviderSaveOutcome } from '$lib/vault/providers.svelte'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import {
  LoginSetupKind,
  StagedRemoteStorageKind,
} from '$lib/vault/state/provider.svelte'
import { ProviderDraftFixture, ProviderRowFixture } from '../provider-fixtures'

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
  return ProviderRowFixture.localFolder({
    id: 'local-folder-provider',
    storeId: scopedProviderVault('vault-1'),
  })
}

/** The connection a selected local folder hands the manager. */
function localFolderConnection(): StorageConnection {
  const staged = draft_storage_args(ProviderDraftFixture.localFolderSelected())
  switch (staged.state) {
    case 'ready':
      return staged.connection
    case 'incomplete':
      throw new Error(`expected a selected folder, missing ${staged.gap}`)
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
  state.activateLoginSetup(ProviderSetupKinds.LOCAL_FOLDER)
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
    ensureProviderSaved: async () => ok(ProviderSaveOutcome.Saved),
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
  test('silently discards a staged conflict result from a replaced context', async () => {
    const scenario = providerConnectionScenario(() =>
      ok(ProviderSyncOutcome.Synced),
    )
    const assessmentFailure = new VaultStorageFailure(
      VaultStorageFailureKind.OperationFailed,
    )
    vi.spyOn(scenario.state, 'stagedRemoteStorageArgs').mockReturnValue({
      kind: StagedRemoteStorageKind.Available,
      args: localFolderConnection(),
    })
    vi.spyOn(scenario.state, 'assessVaultConnectStatus').mockResolvedValue(
      err(assessmentFailure),
    )
    vi.spyOn(scenario.state, 'stageStagedProviderSyncIssue').mockResolvedValue(
      ok(new VaultOperationStale(VaultOperationStaleKind.ContextReplaced)),
    )

    await scenario.actions.connectAndSyncStagedProvider()

    expect(scenario.state.errorMsg).toBe('')
    expect(scenario.syncProviderById).not.toHaveBeenCalled()
    expect(scenario.state.isVerifying).toBe(false)
  })

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
    expect(scenario.state.providerConnectionPhase).toBe(
      ProviderConnectionPhase.Idle,
    )
  })

  test('shows each running connection step and clears it when done', async () => {
    const seen: ProviderConnectionPhase[] = []
    const scenario = providerConnectionScenario((state) => {
      seen.push(state.providerConnectionPhase)
      return ok(ProviderSyncOutcome.Synced)
    })
    const saved: Pick<ProviderActionsContext, 'ensureProviderSaved'> = {
      ensureProviderSaved: async () => {
        seen.push(scenario.state.providerConnectionPhase)
        return ok(ProviderSaveOutcome.Saved)
      },
    }
    Object.assign(scenario.state, saved)

    await scenario.actions.connectAndSyncStagedProvider()

    // A local folder has no remote outbox to upload.
    expect(seen).toEqual([
      ProviderConnectionPhase.Saving,
      ProviderConnectionPhase.Syncing,
    ])
    expect(scenario.state.providerConnectionPhase).toBe(
      ProviderConnectionPhase.Idle,
    )
  })
})
