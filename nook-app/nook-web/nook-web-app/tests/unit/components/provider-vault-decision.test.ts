import { fireEvent, render, waitFor } from '@testing-library/svelte'
import { describe, expect, test, vi } from 'vitest'
import {
  DeviceProtectionStatus,
  type NookProviderVaultDecisionProjection,
  type NookVaultManager,
  ProviderVaultDecision,
  ProviderVaultDecisionReason,
  ProviderVaultIdentityEligibility,
} from '$app-wasm'
import type {
  ProviderActionsContext,
  SyncActionsContext,
} from '../../../../nook-web-shared/src/vault-app/lib/vault/action-contexts'
import ProviderVaultDecisionPanel from '../../../../nook-web-shared/src/vault-app/lib/components/ProviderVaultDecisionPanel.svelte'
import { loadProviders } from '../../../../nook-web-shared/src/vault-app/lib/vault/providers.svelte'
import { ProviderVaultIdentitySelectionKind } from '../../../../nook-web-shared/src/vault-app/lib/vault/provider-vault-decision'
import { activateImportedProviderVaultIdentity } from '../../../../nook-web-shared/src/vault-app/lib/vault/sync-resolution'
import { LoginVaultSelectionKind } from '../../../../nook-web-shared/src/vault-app/lib/vault/state/provider.svelte'
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
    })),
    free: vi.fn(),
  } as unknown as NookProviderVaultDecisionProjection
}

function panelVault(
  load: () => Promise<NookProviderVaultDecisionProjection>,
): VaultState {
  const manager = {
    provider_vault_decision_request: load,
  } as unknown as NookVaultManager
  return {
    enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
    requireManager: () => manager,
    t: (request: string | { readonly key: string }) =>
      typeof request === 'string' ? request : request.key,
  } as unknown as VaultState
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
        rejected.getByText('auth_storage.provider_vault_reason_unknown'),
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
    expect((radio as HTMLInputElement).checked).toBe(true)

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

    await fireEvent.click(radios[1]!)
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
  const state = {
    selectedLoginVault: {
      kind: LoginVaultSelectionKind.Selected,
      storeId: 'store-a',
    },
    providers: [],
    providersLoaded: false,
    openActiveVault,
    enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
    requireManager: () => ({
      load_auth_providers_snapshot: async () => ({
        providers: [identityProvider],
        activeVaultStoreId: { state: 'storeId', value: 'store-b' },
      }),
    }),
  } as unknown as ProviderActionsContext
  const request: Parameters<typeof loadProviders>[0] = {
    state,
    options: { ensureLocalRow: false },
  }

  await loadProviders(request)

  expect(state.providers).toEqual([identityProvider])
  expect(openActiveVault).toHaveBeenCalledWith('store-a')
  expect(openActiveVault).not.toHaveBeenCalledWith('store-b')
})

test('completed import transitions to the selected locked identity', async () => {
  const calls: string[] = []
  const state = {
    deviceProtectionStatus: DeviceProtectionStatus.Unlocked,
    deviceProtectionLockedStatus: DeviceProtectionStatus.Passkey,
    deviceId: 'outgoing-device',
    devicePublicKey: 'outgoing-key',
    errorMsg: '',
    enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
    requireManager: () => ({
      activate_local_identity: async () => {
        calls.push('activate')
      },
      device_protection_status: async () => {
        calls.push('status')
        return DeviceProtectionStatus.Pin
      },
    }),
    clearIdentityProviderSession: () => calls.push('clear-session'),
    selectLoginVault: (storeId: string) => calls.push(`select:${storeId}`),
    t: () => 'vault imported; identity selection failed',
  } as unknown as SyncActionsContext
  const request: Parameters<typeof activateImportedProviderVaultIdentity>[0] = {
    state,
    identityId: 'identity-personal',
    importedStoreId: 'store-a',
  }

  await activateImportedProviderVaultIdentity(request)

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
  const state = {
    errorMsg: '',
    enqueueStorage: (operation: () => Promise<void>) => operation(),
    requireManager: () => ({
      activate_local_identity: async () => {
        throw new Error('identity activation failed')
      },
    }),
    clearIdentityProviderSession,
    selectLoginVault,
    t: () => 'vault imported; identity selection failed',
  } as unknown as SyncActionsContext
  const request: Parameters<typeof activateImportedProviderVaultIdentity>[0] = {
    state,
    identityId: 'identity-personal',
    importedStoreId: 'store-a',
  }

  await activateImportedProviderVaultIdentity(request)

  expect(clearIdentityProviderSession).not.toHaveBeenCalled()
  expect(selectLoginVault).not.toHaveBeenCalled()
  expect(state.errorMsg).toBe('vault imported; identity selection failed')
})

test('status failure keeps the activated identity transition fail closed', async () => {
  const clearIdentityProviderSession = vi.fn()
  const selectLoginVault = vi.fn()
  const state = {
    deviceProtectionStatus: DeviceProtectionStatus.Unlocked,
    deviceId: 'outgoing-device',
    devicePublicKey: 'outgoing-key',
    errorMsg: '',
    enqueueStorage: async <T>(operation: () => T | Promise<T>) => operation(),
    requireManager: () => ({
      activate_local_identity: async () => {},
      device_protection_status: async () => {
        throw new Error('status unavailable')
      },
    }),
    clearIdentityProviderSession,
    selectLoginVault,
    t: () => 'vault imported; identity selection failed',
  } as unknown as SyncActionsContext

  await activateImportedProviderVaultIdentity({
    state,
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
