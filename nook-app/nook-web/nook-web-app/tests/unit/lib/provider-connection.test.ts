import { err, ok, type Result } from 'neverthrow'
import { describe, expect, test, vi } from 'vitest'
import { ProviderSyncFailureHandling, ProviderSyncVisibility } from '$app-wasm'
import { LOCAL_FOLDER_PROVIDER_TYPE } from '$lib/auth/provider-types'
import type { StorageProvider } from '$lib/auth/providers'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import type { ProviderActionsContext } from '$lib/vault/action-contexts'
import { ProviderConnectionActions } from '$lib/vault/provider-connection'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import { StagedRemoteStorageKind } from '$lib/vault/state/provider.svelte'

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
  readonly clearLoginSetup: ReturnType<typeof vi.fn>
  readonly flushRemoteEventOutboxNow: ReturnType<typeof vi.fn>
  readonly state: ProviderActionsContext
  readonly syncProviderById: ReturnType<typeof vi.fn>
}

function localFolderProvider(): StorageProvider {
  return {
    id: 'local-folder-provider',
    type: LOCAL_FOLDER_PROVIDER_TYPE,
    label: 'Local backup',
  } as StorageProvider
}

function providerConnectionScenario(
  synchronize: (
    state: ProviderActionsContext,
  ) => ProviderConnectionOutcome | Promise<ProviderConnectionOutcome>,
): ProviderConnectionScenario {
  const provider = localFolderProvider()
  const clearLoginSetup = vi.fn()
  const flushRemoteEventOutboxNow = vi.fn(async () =>
    err(new VaultStorageFailure(VaultStorageFailureKind.BrowserCleanupFailed)),
  )
  const context = { current: {} as ProviderActionsContext }
  const syncProviderById = vi.fn(async () => synchronize(context.current))
  const state = {
    hasManager: true,
    isVerifying: false,
    addProviderOpen: true,
    providers: [provider],
    syncProviders: [provider],
    errorMsg: '',
    stagedRemoteStorageArgs: () => ({
      kind: StagedRemoteStorageKind.Unavailable,
    }),
    ensureProviderSaved: async () => ok(),
    flushRemoteEventOutboxNow,
    syncProviderById,
    clearLoginSetup,
    t: (request) => (typeof request === 'string' ? request : request.key),
  } as ProviderActionsContext
  context.current = state
  return {
    actions: new ProviderConnectionActions(state),
    clearLoginSetup,
    flushRemoteEventOutboxNow,
    state,
    syncProviderById,
  }
}

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
    expect(scenario.clearLoginSetup).toHaveBeenCalledOnce()
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
    expect(scenario.clearLoginSetup).not.toHaveBeenCalled()
    expect(scenario.state.addProviderOpen).toBe(true)
  })

  test('preserves a multiple-vault presentation instead of a generic preflush failure', async () => {
    const scenario = providerConnectionScenario((state) => {
      state.errorMsg = 'multiple-vaults-staged'
      return ok(ProviderSyncOutcome.FailureCaptured)
    })

    await scenario.actions.connectAndSyncStagedProvider()

    expect(scenario.flushRemoteEventOutboxNow).not.toHaveBeenCalled()
    expect(scenario.syncProviderById).toHaveBeenCalledOnce()
    expect(scenario.state.errorMsg).toBe('multiple-vaults-staged')
    expect(scenario.clearLoginSetup).not.toHaveBeenCalled()
    expect(scenario.state.addProviderOpen).toBe(true)
  })
})
