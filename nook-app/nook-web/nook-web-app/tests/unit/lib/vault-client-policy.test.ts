import { describe, expect, test } from 'vitest'
import {
  JoinEnrollmentState,
  NookManagerStoreScope,
  NookVaultClientPolicy,
  NookVaultSwitchState,
  UnauthenticatedSyncDecision,
  VaultAccessStatus,
  active_vault_providers,
  providers_visible_while_device_locked,
  staged_oauth_remote_storage_args,
  sync_providers_for_active_vault,
  type AuthProvidersSnapshot,
} from '$app-wasm'
import type { OAuthFilePreset } from '$app-wasm'
import {
  activeVaultScope,
  DEFAULT_DRIVE_BACKUP_NAME,
  defaultOAuthFileConfig,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth/providers'

const providers: StorageProvider[] = [
  {
    ...providerPersistenceDefaults(),
    id: 'local-a',
    type: 'local',
    label: 'This device',
    storeId: scopedProviderVault('store-a'),
    syncCheckpoint: { state: 'neverSynced' as const },
    createdAt: '2026-07-17T00:00:00.000Z',
  },
  {
    ...providerPersistenceDefaults(),
    id: 'github-a',
    type: 'github',
    label: 'GitHub A',
    githubPat: storedGithubPat('pat-a'),
    githubRepo: storedGithubRepository('owner/a'),
    storeId: scopedProviderVault('store-a'),
    syncCheckpoint: { state: 'neverSynced' as const },
    createdAt: '2026-07-17T00:00:00.000Z',
  },
  {
    ...providerPersistenceDefaults(),
    id: 'github-b',
    type: 'github',
    label: 'GitHub B',
    githubPat: storedGithubPat('pat-b'),
    githubRepo: storedGithubRepository('owner/b'),
    storeId: scopedProviderVault('store-b'),
    syncCheckpoint: { state: 'neverSynced' as const },
    createdAt: '2026-07-17T00:00:00.000Z',
  },
]
const snapshot: AuthProvidersSnapshot = {
  providers,
  activeVaultStoreId: activeVaultScope('store-a'),
}

describe('portable vault client policy', () => {
  test('owns automatic unlock and join approval transitions', () => {
    const policy = new NookVaultClientPolicy()
    try {
      expect(policy.should_auto_unlock(false, true, 0, 0, false, false)).toBe(
        true,
      )
      expect(policy.should_auto_unlock(false, true, 0, 1, false, false)).toBe(
        false,
      )
      expect(
        policy.unauthenticated_sync_decision(
          true,
          true,
          VaultAccessStatus.Ready,
          JoinEnrollmentState.Pending,
          false,
        ),
      ).toBe(UnauthenticatedSyncDecision.Approved)
      const switchVault = policy.vault_switch_target(
        ' store-b ',
        true,
        'store-a',
        false,
      )
      expect(switchVault.state).toBe(NookVaultSwitchState.Switch)
      expect(switchVault.target()).toBe('store-b')
      switchVault.free()
      const noSwitch = policy.vault_switch_target(
        'store-a',
        true,
        'store-a',
        false,
      )
      expect(noSwitch.state).toBe(NookVaultSwitchState.NoChange)
      noSwitch.free()
    } finally {
      policy.free()
    }
  })

  test('scopes providers and provider roles to the active vault', () => {
    const scope = NookManagerStoreScope.scoped('store-a')
    try {
      expect(
        active_vault_providers(snapshot, scope).providers.map(
          (provider) => provider.id,
        ),
      ).toEqual(['local-a', 'github-a'])
      expect(
        sync_providers_for_active_vault(snapshot, scope).providers.map(
          (provider) => provider.id,
        ),
      ).toEqual(['github-a'])
      expect(
        providers_visible_while_device_locked(snapshot).providers.map(
          (provider) => provider.id,
        ),
      ).toEqual(['local-a'])
    } finally {
      scope.free()
    }
  })

  test('rejects an invalid OAuth preset without a legacy fallback', () => {
    expect(() =>
      staged_oauth_remote_storage_args({
        ...defaultOAuthFileConfig({
          preset: 'google-drive',
          fileName: DEFAULT_DRIVE_BACKUP_NAME,
        }),
        preset: '' as OAuthFilePreset,
      }),
    ).toThrow('unknown variant ``, expected `google-drive` or `icloud`')
  })
})
