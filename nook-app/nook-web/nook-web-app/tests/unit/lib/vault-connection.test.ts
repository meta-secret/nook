import { err, ok, type Result } from 'neverthrow'
import { afterEach, describe, expect, test, vi } from 'vitest'
import {
  GITHUB_PROVIDER_TYPE,
  activeVaultScope,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
  unselectedVaultScope,
} from '$lib/auth/providers'
import {
  NookVaultManager,
  ProviderSyncFailureHandling,
  ProviderSyncFreshness,
  ProviderSyncVisibility,
} from '$app-wasm'
import { VaultAccessStatus } from '$lib/nook'
import type { VaultState } from '$lib/vault.svelte'
import { VaultConnectionActions } from '$lib/vault/connection'
import { VaultSessionUnlockOutcome } from '$lib/vault/session'
import {
  OAuthRemoteReferenceSyncKind,
  ProviderSaveOutcome,
} from '$lib/vault/providers.svelte'
import { ProviderSyncOutcome } from '$lib/vault/provider-sync.svelte'
import {
  OAuthTokenFreshnessKind,
  RosterHydrationKind,
} from '$lib/vault/action-contexts'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import {
  VaultStorageFailure,
  VaultStorageFailureKind,
} from '$lib/runtime/storage-failure'

type ConnectionScenario = {
  readonly manager: NookVaultManager
  readonly state: VaultState
  readonly assessVaultConnectStatus: ReturnType<typeof vi.fn>
  readonly syncProviderById: ReturnType<typeof vi.fn>
}

const ownedScenarios: ConnectionScenario[] = []

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

function connectionScenario(
  syncOutcome: ProviderSyncOutcome,
): ConnectionScenario {
  const state = VaultStateTestFixture.create()
  const manager = new NookVaultManager()
  const provider = githubProvider()
  let assessmentCount = 0
  const assessVaultConnectStatus = vi.fn<
    VaultState['assessVaultConnectStatus']
  >(async () => {
    assessmentCount += 1
    return ok(
      assessmentCount === 1
        ? VaultAccessStatus.JoinPending
        : VaultAccessStatus.Ready,
    )
  })
  const syncProviderById = vi.fn<VaultState['syncProviderById']>(async () =>
    ok(syncOutcome),
  )

  state.openManager(manager)
  state.openActiveVault('joiner-store')
  state.providers = [provider]
  state.isInitializing = false
  state.isVerifying = false
  state.isAuthenticated = false
  state.localVaultPresent = false
  state.initDeviceIdentity = vi.fn(async () =>
    ok({ deviceId: 'joiner-device', devicePublicKey: 'joiner-public-key' }),
  )
  state.ensureOAuthTokensFresh = vi.fn<VaultState['ensureOAuthTokensFresh']>(
    async () => ok({ kind: OAuthTokenFreshnessKind.NotConfigured }),
  )
  state.syncProviderById = syncProviderById
  state.assessVaultConnectStatus = assessVaultConnectStatus
  state.handleRemoteVaultAssessStatus = vi.fn(async () => false)
  state.loadSecretPage = vi.fn<VaultState['loadSecretPage']>(async () =>
    ok({
      displayedSecretCount: 0,
      totalSecretCount: 0,
      pageOffset: 0,
      query: '',
    }),
  )
  state.syncOAuthRemoteRefFromManager = vi.fn(() =>
    ok({ kind: OAuthRemoteReferenceSyncKind.NotApplicable }),
  )
  state.ensureProviderSaved = vi.fn<VaultState['ensureProviderSaved']>(
    async () => ok(ProviderSaveOutcome.Saved),
  )
  state.loadProviders = vi.fn<VaultState['loadProviders']>(async () =>
    ok({
      providers: [provider],
      activeVaultStoreId: activeVaultScope('joiner-store'),
    }),
  )
  state.promoteSessionVaultToLocalIfNeeded = vi.fn<
    VaultState['promoteSessionVaultToLocalIfNeeded']
  >(async () =>
    ok({
      snapshot: {
        providers: [provider],
        activeVaultStoreId: unselectedVaultScope(),
      },
      localVaultPresent: false,
    }),
  )
  state.refreshPasswordEntriesList = vi.fn(async () => ok({ entries: [] }))
  state.hydrateMultiDeviceState = vi.fn<VaultState['hydrateMultiDeviceState']>(
    async () => ok({ kind: RosterHydrationKind.Skipped }),
  )
  state.markVaultUnlocked = vi.fn(() => {
    state.isAuthenticated = true
    return ok(VaultSessionUnlockOutcome.Unlocked)
  })
  state.syncFromStorage = vi.fn<VaultState['syncFromStorage']>(async () =>
    ok(ProviderSyncOutcome.Synced),
  )
  const immediateStorage = async <Value, Failure = Error>(
    operation: () => Result<Value, Failure> | Promise<Result<Value, Failure>>,
  ): Promise<Result<Value, Failure>> => operation()
  state.enqueueStorage = immediateStorage
  state.startIdleSessionTracking = vi.fn()
  state.startVaultSync = vi.fn()
  state.dismissSuccess = vi.fn()
  state.showSuccess = vi.fn()
  state.resolveErrorMessage = (message: string) => message
  manager.connect = vi.fn(async () => [])

  const scenario = {
    manager,
    state,
    assessVaultConnectStatus,
    syncProviderById,
  }
  ownedScenarios.push(scenario)
  return scenario
}

afterEach(() => {
  for (const scenario of ownedScenarios) {
    scenario.state.clearManager()
    scenario.manager.free()
  }
  ownedScenarios.length = 0
  vi.restoreAllMocks()
})

describe('vault connection', () => {
  test('keeps an old post-unlock sync failure out of a replacement session', async () => {
    const scenario = connectionScenario(ProviderSyncOutcome.Synced)
    scenario.state.syncFromStorage = vi.fn(async () => {
      scenario.state.sessionEpoch += 1
      return err(
        new VaultStorageFailure(VaultStorageFailureKind.OperationFailed),
      )
    })

    await new VaultConnectionActions(scenario.state).loadDb()

    expect(scenario.state.isAuthenticated).toBe(true)
    expect(scenario.state.errorMsg).toBe('')
  })

  test.each([
    ['a skipped sync', ProviderSyncOutcome.Skipped],
    ['a captured sync failure', ProviderSyncOutcome.FailureCaptured],
  ] as const)(
    '%s still re-assesses the remote join provider',
    async (_, outcome) => {
      const scenario = connectionScenario(outcome)

      await new VaultConnectionActions(scenario.state).loadDb()

      expect(scenario.syncProviderById).toHaveBeenCalledExactlyOnceWith({
        providerId: 'joiner-provider',
        visibility: ProviderSyncVisibility.Quiet,
        failureHandling: ProviderSyncFailureHandling.Capture,
      })
      expect(scenario.assessVaultConnectStatus).toHaveBeenCalledTimes(2)
      expect(scenario.assessVaultConnectStatus).toHaveBeenNthCalledWith(1)
      expect(scenario.assessVaultConnectStatus).toHaveBeenNthCalledWith(2, {
        mode: 'github',
        pat: 'github-token',
        repo: 'owner/vault',
      })
      expect(scenario.manager.connect).toHaveBeenCalledWith(
        'github',
        'github-token',
        'owner/vault',
      )
      expect(scenario.state.markVaultUnlocked).toHaveBeenCalledOnce()
      expect(scenario.state.isAuthenticated).toBe(true)
      expect(scenario.state.syncFromStorage).toHaveBeenCalledWith(
        ProviderSyncFreshness.Forced,
      )
    },
  )
})
