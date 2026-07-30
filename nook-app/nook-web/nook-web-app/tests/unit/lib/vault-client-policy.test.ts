import { describe, expect, test } from 'vitest'
import {
  JoinEnrollmentState,
  NookManagerStoreScope,
  NookVaultClientPolicy,
  NookVaultSwitchState,
  UnauthenticatedSyncDecision,
  VaultAccessStatus,
  activeVaultProviders,
  providersVisibleWhileDeviceLocked,
  stagedOauthRemoteStorageArgs,
  syncProvidersForActiveVault,
  type AuthProvidersSnapshot,
} from '$app-wasm'
import type { OAuthFilePreset } from '$app-wasm'
import {
  activeVaultScope,
  defaultOAuthFileConfig,
  providerPersistenceDefaults,
  scopedProviderVault,
  storedGithubPat,
  storedGithubRepository,
  type StorageProvider,
} from '$lib/auth-providers'

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
      expect(policy.shouldAutoUnlock(false, true, 0, 0, false, false)).toBe(
        true,
      )
      expect(policy.shouldAutoUnlock(false, true, 0, 1, false, false)).toBe(
        false,
      )
      expect(
        policy.unauthenticatedSyncDecision(
          true,
          true,
          VaultAccessStatus.Ready,
          JoinEnrollmentState.Pending,
          false,
        ),
      ).toBe(UnauthenticatedSyncDecision.Approved)
      const switchVault = policy.vaultSwitchTarget(
        ' store-b ',
        true,
        'store-a',
        false,
      )
      expect(switchVault.state).toBe(NookVaultSwitchState.Switch)
      expect(switchVault.target()).toBe('store-b')
      switchVault.free()
      const noSwitch = policy.vaultSwitchTarget(
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
        activeVaultProviders(snapshot, scope).providers.map(
          (provider) => provider.id,
        ),
      ).toEqual(['local-a', 'github-a'])
      expect(
        syncProvidersForActiveVault(snapshot, scope).providers.map(
          (provider) => provider.id,
        ),
      ).toEqual(['github-a'])
      expect(
        providersVisibleWhileDeviceLocked(snapshot).providers.map(
          (provider) => provider.id,
        ),
      ).toEqual(['local-a'])
    } finally {
      scope.free()
    }
  })

  test('rejects an invalid OAuth preset without a legacy fallback', () => {
    expect(() =>
      stagedOauthRemoteStorageArgs({
        ...defaultOAuthFileConfig('google-drive'),
        preset: '' as OAuthFilePreset,
      }),
    ).toThrow('unknown variant ``, expected `google-drive` or `icloud`')
  })
})
