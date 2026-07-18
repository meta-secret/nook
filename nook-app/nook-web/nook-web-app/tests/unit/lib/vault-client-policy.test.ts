import { describe, expect, test } from 'vitest'
import {
  JoinEnrollmentState,
  NookVaultClientPolicy,
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
    expect(
      (activeVaultProviders(providers, 'store-a') as typeof providers).map(
        (provider) => provider.id,
      ),
    ).toEqual(['local-a', 'github-a'])
    expect(
      (syncProvidersForActiveVault(
        providers,
        'store-a',
      ) as typeof providers).map((provider) => provider.id),
    ).toEqual(['github-a'])
    expect(
      (providersVisibleWhileDeviceLocked(providers) as typeof providers).map(
        (provider) => provider.id,
      ),
    ).toEqual(['local-a'])
  })

  test('normalizes a legacy Google Drive draft before manager connection', () => {
    const args = stagedRemoteStorageArgs(
      'oauth-file',
      undefined,
      'nook-events',
      {
        preset: '',
        accessToken: 'token',
        fileId: 'file-id',
        fileName: 'stored-name',
      },
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
