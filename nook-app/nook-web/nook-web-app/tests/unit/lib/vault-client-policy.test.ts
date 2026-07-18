import { describe, expect, test } from 'vitest'
import {
  JoinEnrollmentState,
  NookVaultClientPolicy,
  NookOAuthFileConfigValue,
  NookStorageProviderList,
  UnauthenticatedSyncDecision,
  VaultAccessStatus,
  activeVaultProviders,
  providersVisibleWhileDeviceLocked,
  stagedRemoteStorageArgs,
  syncProvidersForActiveVault,
} from '$app-wasm'

const providers = [
  {
    id: 'local-a',
    type: 'local',
    label: 'This device',
    storeId: 'store-a',
    createdAt: '2026-07-17T00:00:00.000Z',
  },
  {
    id: 'github-a',
    type: 'github',
    label: 'GitHub A',
    githubPat: 'pat-a',
    githubRepo: 'owner/a',
    storeId: 'store-a',
    createdAt: '2026-07-17T00:00:00.000Z',
  },
  {
    id: 'github-b',
    type: 'github',
    label: 'GitHub B',
    githubPat: 'pat-b',
    githubRepo: 'owner/b',
    storeId: 'store-b',
    createdAt: '2026-07-17T00:00:00.000Z',
  },
]

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
          VaultAccessStatus.Ready,
          JoinEnrollmentState.Pending,
          false,
        ),
      ).toBe(UnauthenticatedSyncDecision.Approved)
      expect(policy.vaultSwitchTarget(' store-b ', 'store-a', false)).toBe(
        'store-b',
      )
      expect(policy.vaultSwitchTarget('store-a', 'store-a', false)).toBe(
        undefined,
      )
    } finally {
      policy.free()
    }
  })

  test('scopes providers and provider roles to the active vault', () => {
    const providerValues = NookStorageProviderList.fromArray(providers)
    try {
      const active = activeVaultProviders(providerValues, 'store-a')
      const sync = syncProvidersForActiveVault(providerValues, 'store-a')
      const locked = providersVisibleWhileDeviceLocked(providerValues)
      try {
        expect(
          (active.toArray() as typeof providers).map((provider) => provider.id),
        ).toEqual(['local-a', 'github-a'])
        expect(
          (sync.toArray() as typeof providers).map((provider) => provider.id),
        ).toEqual(['github-a'])
        expect(
          (locked.toArray() as typeof providers).map((provider) => provider.id),
        ).toEqual(['local-a'])
      } finally {
        active.free()
        sync.free()
        locked.free()
      }
    } finally {
      providerValues.free()
    }
  })

  test('normalizes a legacy Google Drive draft before manager connection', () => {
    const config = NookOAuthFileConfigValue.fromObject({
      preset: '',
      accessToken: 'token',
      fileId: 'file-id',
      fileName: 'stored-name',
    })
    const args = stagedRemoteStorageArgs(
      'oauth-file',
      undefined,
      'nook-events',
      config,
    )
    expect(args).toBeDefined()
    try {
      expect(args?.mode).toBe('google-drive')
      expect(args?.repo).toBe('file-id\tnook-events')
    } finally {
      args?.free()
    }
  })
})
