import { err, ok } from 'neverthrow'
import * as wasmModule from '$app-wasm'
import {
  NookVaultManager,
  NookVaultSyncAccessState,
  ProviderSyncFailureHandling,
  ProviderSyncVisibility,
  type NookVaultSyncResult,
} from '$app-wasm'
import {
  GITHUB_PROVIDER_TYPE,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'
import { VaultStorageSynchronization } from '$lib/nook'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'
import {
  ProviderSyncActions,
  ProviderSyncOutcome,
} from '$lib/vault/provider-sync.svelte'
import { VaultState } from '$lib/vault.svelte'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { VaultAccessStatus } from '$lib/nook'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

type ProviderSyncScenario = {
  readonly manager: NookVaultManager
  readonly state: VaultState
  readonly secretRefresh: ReturnType<typeof vi.fn>
  readonly syncResult: NookVaultSyncResult
}

const ownedScenarios: ProviderSyncScenario[] = []

function githubProvider(): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'joiner-provider',
    type: GITHUB_PROVIDER_TYPE,
    label: 'Joiner GitHub',
    githubPat: storedGithubPat('github-token'),
    githubRepo: storedGithubRepository('owner/vault'),
    storeId: scopedProviderVault('joiner-store'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-09-12T00:00:00Z',
  }
}

function approvedSyncResult(): NookVaultSyncResult {
  return {
    accessState: NookVaultSyncAccessState.Assessed,
    accessStatus: VaultAccessStatus.Ready,
    changed: true,
    pendingJoins: [],
    secrets: [],
    vaultMembers: [],
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
}

function providerSyncScenario(authenticated: boolean): ProviderSyncScenario {
  vi.spyOn(wasmModule, 'read_local_vault_yaml').mockResolvedValue('vault-yaml')
  const manager = new NookVaultManager()
  const state = VaultStateTestFixture.create()
  const syncResult = approvedSyncResult()
  const secretRefresh = vi.fn(async () =>
    authenticated
      ? ok()
      : err(new VaultStorageFailure(VaultStorageFailureKind.OperationFailed)),
  )

  state.openManager(manager)
  state.providers = [githubProvider()]
  state.isAuthenticated = authenticated
  state.enqueueStorage = vi.fn(async (operation) => operation())
  state.applyVaultSyncResult = vi.fn((result) => {
    result.free()
    return ok()
  })
  state.refreshSecretsFromSession = secretRefresh
  state.refreshReplacementConflicts = vi.fn(async () => ok())
  state.updateProviderSyncMetadata = vi.fn(async () => ok())
  state.hydrateMultiDeviceState = vi.fn(async () => ok())
  vi.spyOn(VaultStorageSynchronization.prototype, 'run').mockResolvedValue(
    ok(syncResult),
  )
  ownedScenarios.push({ manager, state, secretRefresh, syncResult })
  return { manager, state, secretRefresh, syncResult }
}

afterEach(() => {
  for (const scenario of ownedScenarios) {
    scenario.state.clearManager()
    scenario.manager.free()
  }
  ownedScenarios.length = 0
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe('provider synchronization', () => {
  test('completes an approved unauthenticated join without hydrating locked secrets', async () => {
    const scenario = providerSyncScenario(false)

    const synchronized = await new ProviderSyncActions(
      scenario.state,
    ).syncProviderById({
      providerId: 'joiner-provider',
      visibility: ProviderSyncVisibility.Quiet,
      failureHandling: ProviderSyncFailureHandling.Capture,
    })
    expect(synchronized).toEqual(ok(ProviderSyncOutcome.Synced))
    expect(scenario.secretRefresh).not.toHaveBeenCalled()
    expect(scenario.state.hydrateMultiDeviceState).not.toHaveBeenCalled()
  })

  test('hydrates secrets for an authenticated provider sync', async () => {
    const scenario = providerSyncScenario(true)

    const synchronized = await new ProviderSyncActions(
      scenario.state,
    ).syncProviderById({
      providerId: 'joiner-provider',
      visibility: ProviderSyncVisibility.Quiet,
      failureHandling: ProviderSyncFailureHandling.Capture,
    })

    expect(synchronized).toEqual(ok(ProviderSyncOutcome.Synced))
    expect(scenario.secretRefresh).toHaveBeenCalledOnce()
    expect(scenario.state.hydrateMultiDeviceState).toHaveBeenCalledOnce()
  })
})
