import type { Result } from 'neverthrow'
import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  NookVaultManager,
  NookSyncConflictReviewState,
  type NookProviderVaultDecisionProjection,
  ProviderVaultDecision,
  ProviderVaultDecisionReason,
  ProviderVaultIdentityEligibility,
  VaultSyncConflictKind,
} from '$app-wasm'
import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import ProviderVaultDecisionPanel from '../../../../nook-web-shared/src/vault-app/lib/components/ProviderVaultDecisionPanel.svelte'
import { VaultProviderActions } from '../../../../nook-web-shared/src/vault-app/lib/vault/providers.svelte'
import { ProviderVaultIdentitySelectionKind } from '../../../../nook-web-shared/src/vault-app/lib/vault/provider-vault-decision'
import { SyncConflictActions } from '../../../../nook-web-shared/src/vault-app/lib/vault/sync-resolution'
import { LoginVaultSelectionKind } from '../../../../nook-web-shared/src/vault-app/lib/vault/state/provider.svelte'
import { VaultStateTestFixture } from '../vault-state-test-fixture'
import type { VaultState } from '../../../../nook-web-shared/src/vault-app/lib/vault.svelte'

type ProjectedIdentity = {
  readonly id: string
  readonly eligibility: ProviderVaultIdentityEligibility
}

function projection(
  identities: readonly ProjectedIdentity[],
): NookProviderVaultDecisionProjection {
  return {
    decision: ProviderVaultDecision.AdoptProviderVault,
    reason: ProviderVaultDecisionReason.ReadyToAdopt,
    identities: identities.map((identity) => ({
      identityId: identity.id,
      identityLabel: identity.id,
      isCurrentApp: identity.id === 'personal',
      eligibility: identity.eligibility,
      free: vi.fn(),
      [Symbol.dispose]: vi.fn(),
    })),
    free: vi.fn(),
    [Symbol.dispose]: vi.fn(),
  }
}

function panelVault(
  load: () => Promise<NookProviderVaultDecisionProjection>,
): VaultState {
  const manager = new NookVaultManager()
  manager.provider_vault_decision_request = async () => load()
  const vault = VaultStateTestFixture.create()
  vault.openManager(manager)
  const immediateStorage = async <T, E = Error>(
    operation: () => Result<T, E> | Promise<Result<T, E>>,
  ): Promise<Result<T, E>> => operation()
  vault.enqueueStorage = immediateStorage
  return vault
}

function renderPanel(vault: VaultState, onImport = vi.fn()) {
  return render(ProviderVaultDecisionPanel, {
    vault,
    providerLabel: 'Backup',
    localStoreId: 'store-local',
    remoteStoreId: 'store-provider',
    isBusy: false,
    onImport,
    onCancel: vi.fn(),
  })
}

describe('provider vault decision panel', () => {
  test('keeps import disabled while evidence is loading or rejected', async () => {
    const loading = renderPanel(panelVault(() => new Promise(() => {})))
    expect(
      loading
        .getByTestId('sync-conflict-import-new-vault-btn')
        .hasAttribute('disabled'),
    ).toBe(true)
    loading.unmount()

    const rejected = renderPanel(
      panelVault(async () => {
        throw new Error('projection unavailable')
      }),
    )
    await waitFor(() =>
      expect(
        rejected.getByText(I18N_KEYS.AuthStorageProviderVaultReasonUnknown),
      ).toBeTruthy(),
    )
    expect(
      rejected
        .getByTestId('sync-conflict-import-new-vault-btn')
        .hasAttribute('disabled'),
    ).toBe(true)
  })

  test('passes the sole prepared identity to import', async () => {
    const onImport = vi.fn()
    const view = renderPanel(
      panelVault(async () =>
        projection([
          {
            id: 'personal',
            eligibility: ProviderVaultIdentityEligibility.LinkedAndPrepared,
          },
        ]),
      ),
      onImport,
    )
    const radio = await view.findByRole('radio')
    if (!(radio instanceof HTMLInputElement))
      expect.fail('identity choice must be a radio input')
    expect(radio.checked).toBe(true)

    await fireEvent.click(
      view.getByTestId('sync-conflict-import-new-vault-btn'),
    )
    expect(onImport).toHaveBeenCalledWith({
      kind: ProviderVaultIdentitySelectionKind.Selected,
      identityId: 'personal',
    })
  })

  test('requires and emits an explicit choice among prepared identities', async () => {
    const onImport = vi.fn()
    const view = renderPanel(
      panelVault(async () =>
        projection(
          ['personal', 'work'].map((id) => ({
            id,
            eligibility: ProviderVaultIdentityEligibility.LinkedAndPrepared,
          })),
        ),
      ),
      onImport,
    )
    const radios = await view.findAllByRole('radio')
    const importButton = view.getByTestId('sync-conflict-import-new-vault-btn')
    expect(importButton.hasAttribute('disabled')).toBe(true)

    const workRadio = radios[1]
    if (!workRadio) expect.fail('work identity choice is required')
    await fireEvent.click(workRadio)
    expect(importButton.hasAttribute('disabled')).toBe(false)
    await fireEvent.click(importButton)
    expect(onImport).toHaveBeenCalledWith({
      kind: ProviderVaultIdentitySelectionKind.Selected,
      identityId: 'work',
    })
  })
})

test('selected local target survives loading the selected identity providers', async () => {
  const identityProvider = { id: 'identity-provider', label: 'Identity B' }
  const openActiveVault = vi.fn()
  const state = VaultStateTestFixture.create()
  state.selectedLoginVault = {
    kind: LoginVaultSelectionKind.Selected,
    storeId: 'store-a',
  }
  state.providers = []
  state.providersLoaded = false
  state.openActiveVault = openActiveVault
  const manager = new NookVaultManager()
  manager.load_auth_providers_snapshot = async () => ({
    providers: [identityProvider],
    activeVaultStoreId: { state: 'storeId', value: 'store-b' },
  })
  state.openManager(manager)
  const request: Parameters<VaultProviderActions['loadProviders']>[0] = {
    options: { ensureLocalRow: false },
  }

  await new VaultProviderActions(state).loadProviders(request)

  expect(state.providers).toEqual([identityProvider])
  expect(openActiveVault).toHaveBeenCalledWith('store-a')
  expect(openActiveVault).not.toHaveBeenCalledWith('store-b')
})

test('clears verification after remote conflict import returns before manager admission', async () => {
  const state = VaultStateTestFixture.create()
  state.syncConflictReview = {
    state: NookSyncConflictReviewState.RequiresDecision,
    conflictKind: VaultSyncConflictKind.StoreId,
    remote_store_id: () => 'store-remote',
    isPendingProvider: false,
    providerLabel: 'Backup',
    remoteYaml: '',
  }
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
  state.providers = [{ id: 'stale-provider' }]
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
  manager.activate_local_identity = async () => {
    calls.push('activate')
  }
  manager.device_protection_status = async () => {
    calls.push('status')
    return DeviceProtectionStatus.Pin
  }
  state.openManager(manager)
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
  manager.activate_local_identity = async () => {}
  manager.device_protection_status = async () => {
    throw new Error('status unavailable')
  }
  state.openManager(manager)
  state.clearIdentityProviderSession = clearIdentityProviderSession
  state.selectLoginVault = selectLoginVault
  state.t = () => 'vault imported; identity selection failed'

  await new SyncConflictActions(state).activateImportedProviderVaultIdentity({
    identityId: 'identity-personal',
    importedStoreId: 'store-a',
  })

  expect(clearIdentityProviderSession).toHaveBeenCalledOnce()
  expect(selectLoginVault).toHaveBeenCalledWith('store-a')
  expect(state.deviceProtectionStatus).toBe(DeviceProtectionStatus.Error)
  expect(state.deviceId).toBe('')
  expect(state.devicePublicKey).toBe('')
  expect(state.errorMsg).toBe('vault imported; identity selection failed')
})
