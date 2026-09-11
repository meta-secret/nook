import { err, ok, type Result } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ProviderSyncFailureHandling, ProviderSyncVisibility } from '$app-wasm'
import { LOCAL_FOLDER_PROVIDER_TYPE } from '$lib/auth/provider-types'
import type { StorageProvider } from '$lib/auth/providers'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import { VaultState } from '$lib/vault.svelte'
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
  readonly state: VaultState
  readonly syncProviderById: ReturnType<typeof vi.fn>
}

function localFolderProvider(): StorageProvider {
  return {
    id: 'local-folder-provider',
    type: LOCAL_FOLDER_PROVIDER_TYPE,
    label: 'Local backup',
  } as StorageProvider
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
  vi.spyOn(state, 'hasManager', 'get').mockReturnValue(true)
  vi.spyOn(state, 'syncProviders', 'get').mockReturnValue([provider])
  vi.spyOn(state, 'stagedRemoteStorageArgs').mockReturnValue({
    kind: StagedRemoteStorageKind.Unavailable,
  })
  vi.spyOn(state, 'ensureProviderSaved').mockResolvedValue(ok())
  const flushRemoteEventOutboxNow = vi
    .spyOn(state, 'flushRemoteEventOutboxNow')
    .mockResolvedValue(
      err(
        new VaultStorageFailure(VaultStorageFailureKind.BrowserCleanupFailed),
      ),
    )
  const syncProviderById = vi
    .spyOn(state, 'syncProviderById')
    .mockImplementation(async () => synchronize(state))
  const clearLoginSetup = vi
    .spyOn(state, 'clearLoginSetup')
    .mockImplementation(() => {})
  vi.spyOn(state, 't').mockImplementation((request) =>
    typeof request === 'string' ? request : request.key,
  )
  return {
    actions: new ProviderConnectionActions(state),
    clearLoginSetup,
    flushRemoteEventOutboxNow,
    state,
    syncProviderById,
  }
}

afterEach(() => vi.restoreAllMocks())

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
