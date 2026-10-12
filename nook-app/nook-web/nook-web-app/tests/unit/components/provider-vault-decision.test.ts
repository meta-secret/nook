import { DeviceProtectionStatus, NookVaultManager } from '$app-wasm'
import {
  providerPersistenceDefaults,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'
import { ok } from 'neverthrow'
import { expect, test, vi } from 'vitest'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'
import { ProviderVaultIdentitySelectionKind } from '../../../../nook-web-shared/src/vault-app/lib/vault/provider-vault-decision'
import { VaultProviderActions } from '../../../../nook-web-shared/src/vault-app/lib/vault/providers.svelte'
import { SyncConflictActions } from '../../../../nook-web-shared/src/vault-app/lib/vault/sync-resolution'
import { VaultStateTestFixture } from '../vault-state-test-fixture'

test('selected local target survives loading the selected identity providers', async () => {
  const identityProvider: StorageProvider = {
    ...providerPersistenceDefaults(),
    id: 'identity-provider',
    type: 'github',
    label: 'Identity B',
    githubPat: storedGithubPat('test-pat'),
    githubRepo: storedGithubRepository('identity/repo'),
    createdAt: '2026-01-01T00:00:00Z',
  }
  const openActiveVault = vi.fn()
  const state = VaultStateTestFixture.create()
  state.selectLoginVault('store-a')
  state.providers = []
  state.providersLoaded = false
  state.openActiveVault = openActiveVault
  const manager = new NookVaultManager()
  vi.spyOn(manager, 'load_auth_providers_snapshot').mockResolvedValue({
    providers: [identityProvider],
    activeVaultStoreId: { state: 'storeId', value: 'store-b' },
  })
  state.openManager(manager)
  state.admitManager = vi.fn(() => ok(manager))
  VaultStateTestFixture.runStorageImmediately(state)
  const request: Parameters<VaultProviderActions['loadProviders']>[0] = {
    options: { ensureLocalRow: false },
  }

  const loaded = await new VaultProviderActions(state).loadProviders(request)

  if (loaded.isErr()) throw loaded.error
  expect(loaded.value).toEqual({
    providers: [identityProvider],
    activeVaultStoreId: { state: 'storeId', value: 'store-b' },
  })
  expect(state.providers).toEqual([identityProvider])
  expect(openActiveVault).toHaveBeenCalledWith('store-a')
  expect(openActiveVault).not.toHaveBeenCalledWith('store-b')
})

test('clears verification after remote conflict import returns before manager admission', async () => {
  const state = VaultStateTestFixture.create()
  state.t = (request: Parameters<VaultState['t']>[0]) =>
    typeof request === 'string' ? request : request.key
  state.stageStoreIdSyncConflictForTesting({
    providerLabel: 'Backup',
    localStoreId: 'store-local',
    remoteStoreId: 'store-remote',
  })
  state.isVerifying = false
  state.errorMsg = ''
  state.clearManager()

  await new SyncConflictActions(state).resolveSyncConflictImportRemote({
    identitySelection: {
      kind: ProviderVaultIdentitySelectionKind.NotSelected,
    },
  })

  expect(state.isVerifying).toBe(false)
  expect(state.errorMsg).toBe(I18N_KEYS.ErrorsManagerUninitialized)
})

test('initializes a pristine device without accessing identity-protected providers', () => {
  const applyActiveProviderCredentials = vi.fn()
  const state = VaultStateTestFixture.create()
  state.providers = [
    {
      ...providerPersistenceDefaults(),
      id: 'stale-provider',
      type: 'github',
      label: 'Stale provider',
      createdAt: '2026-01-01T00:00:00Z',
    },
  ]
  state.providersLoaded = false
  state.applyActiveProviderCredentials = applyActiveProviderCredentials
  vi.spyOn(state, 'admitManager').mockImplementation(() => {
    throw new Error('identity-protected provider storage must not be read')
  })

  new VaultProviderActions(state).initializePristineDeviceProviders()

  expect(state.providers).toEqual([])
  expect(state.providersLoaded).toBe(true)
  expect(applyActiveProviderCredentials).not.toHaveBeenCalled()
  expect(state.admitManager).not.toHaveBeenCalled()
})

test('completed import transitions to the selected locked identity', async () => {
  const calls: string[] = []
  const state = VaultStateTestFixture.create()
  state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
  state.deviceProtectionLockedStatus = DeviceProtectionStatus.Passkey
  state.deviceId = 'outgoing-device'
  state.devicePublicKey = 'outgoing-key'
  state.errorMsg = ''
  const manager = new NookVaultManager()
  vi.spyOn(manager, 'activate_local_identity').mockImplementation(async () => {
    calls.push('activate')
  })
  vi.spyOn(manager, 'device_protection_status').mockImplementation(async () => {
    calls.push('status')
    return DeviceProtectionStatus.Pin
  })
  state.openManager(manager)
  state.admitManager = vi.fn(() => ok(manager))
  VaultStateTestFixture.runStorageImmediately(state)
  state.clearIdentityProviderSession = () => calls.push('clear-session')
  state.selectLoginVault = (storeId: string) => calls.push(`select:${storeId}`)
  state.t = () => 'vault imported; identity selection failed'
  const request: Parameters<
    SyncConflictActions['activateImportedProviderVaultIdentity']
  >[0] = {
    identityId: 'identity-personal',
    importedStoreId: 'store-a',
  }

  await new SyncConflictActions(state).activateImportedProviderVaultIdentity(
    request,
  )

  expect(calls).toEqual([
    'activate',
    'clear-session',
    'select:store-a',
    'status',
  ])
  expect(state.deviceProtectionStatus).toBe(DeviceProtectionStatus.Pin)
  expect(state.deviceProtectionLockedStatus).toBe(DeviceProtectionStatus.Pin)
  expect(state.deviceId).toBe('')
  expect(state.devicePublicKey).toBe('')
})

test('activation failure preserves the completed import session', async () => {
  const clearIdentityProviderSession = vi.fn()
  const selectLoginVault = vi.fn()
  const state = VaultStateTestFixture.create()
  state.errorMsg = ''
  const manager = new NookVaultManager()
  manager.activate_local_identity = async () => {
    throw new Error('identity activation failed')
  }
  state.openManager(manager)
  state.clearIdentityProviderSession = clearIdentityProviderSession
  state.selectLoginVault = selectLoginVault
  state.t = () => 'vault imported; identity selection failed'
  const request: Parameters<
    SyncConflictActions['activateImportedProviderVaultIdentity']
  >[0] = {
    identityId: 'identity-personal',
    importedStoreId: 'store-a',
  }

  await new SyncConflictActions(state).activateImportedProviderVaultIdentity(
    request,
  )

  expect(clearIdentityProviderSession).not.toHaveBeenCalled()
  expect(selectLoginVault).not.toHaveBeenCalled()
  expect(state.errorMsg).toBe('vault imported; identity selection failed')
})

test('status failure keeps the activated identity transition fail closed', async () => {
  const clearIdentityProviderSession = vi.fn()
  const selectLoginVault = vi.fn()
  const state = VaultStateTestFixture.create()
  state.deviceProtectionStatus = DeviceProtectionStatus.Unlocked
  state.deviceId = 'outgoing-device'
  state.devicePublicKey = 'outgoing-key'
  state.errorMsg = ''
  const manager = new NookVaultManager()
  vi.spyOn(manager, 'activate_local_identity').mockResolvedValue()
  vi.spyOn(manager, 'device_protection_status').mockImplementation(async () => {
    throw new Error('status unavailable')
  })
  state.openManager(manager)
  state.admitManager = vi.fn(() => ok(manager))
  VaultStateTestFixture.runStorageImmediately(state)
  state.clearIdentityProviderSession = clearIdentityProviderSession
  state.selectLoginVault = selectLoginVault
  state.t = () => 'vault imported; identity selection failed'

  await new SyncConflictActions(state).activateImportedProviderVaultIdentity({
    identityId: 'identity-personal',
    importedStoreId: 'store-a',
  })

  expect(manager.activate_local_identity).toHaveBeenCalledOnce()
  expect(clearIdentityProviderSession).toHaveBeenCalledOnce()
  expect(selectLoginVault).toHaveBeenCalledWith('store-a')
  expect(state.deviceProtectionStatus).toBe(DeviceProtectionStatus.Error)
  expect(state.deviceId).toBe('')
  expect(state.devicePublicKey).toBe('')
  expect(state.errorMsg).toBe('vault imported; identity selection failed')
})
