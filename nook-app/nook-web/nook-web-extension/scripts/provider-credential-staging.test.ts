import { describe, expect, test } from 'bun:test'
import {
  type ProviderCredentialCleanupArgs,
  ProviderCredentialStagingKind,
  runWithProviderCredentialCleanup,
  scrubProviderCredentials,
  stageProviderCredentials,
  type SerializedStorageProvider,
} from '../src/lib/provider-credential-staging'
import type { StorageProvider } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'

async function stageFixture(providers: SerializedStorageProvider[]) {
  const args: Parameters<typeof stageProviderCredentials>[0] = {
    providers,
    decode: async (candidate) =>
      structuredClone(candidate) as StorageProvider[],
  }
  return stageProviderCredentials(args)
}

describe('provider credential staging', () => {
  test('copies provider credentials into decoded domain providers', async () => {
    const source = [
      {
        id: 'github',
        githubPat: 'github_pat_secret',
      },
      {
        id: 'drive',
        oauthFile: {
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
          fileName: 'nook-events',
        },
      },
    ]

    const staging = await stageFixture(source)

    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    expect(staging.providers).toEqual([
      {
        id: 'github',
        githubPat: 'github_pat_secret',
      },
      {
        id: 'drive',
        oauthFile: {
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
          fileName: 'nook-events',
        },
      },
    ])
    expect(source[0]?.githubPat).toBe('github_pat_secret')
    expect(source[1]?.oauthFile?.accessToken).toBe('access-secret')
    expect(source[1]?.oauthFile?.refreshToken).toBe('refresh-secret')
  })

  test('scrubs decoded providers when queued import work expires', async () => {
    const staging = await stageFixture([
      {
        id: 'drive',
        oauthFile: {
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
        },
      },
    ])

    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    scrubProviderCredentials(staging.providers)

    expect(staging.providers[0]).toEqual({
      id: 'drive',
      oauthFile: {
        accessToken: '',
      },
    })
    expect(
      (staging.providers[0] as { oauthFile?: unknown }).oauthFile,
    ).not.toHaveProperty('refreshToken')
  })

  test('scrubs an IPC snapshot after a successful handoff', async () => {
    const providers = [{ githubPat: 'github_pat_snapshot_secret' }]
    let observedDuringHandoff = ''
    const args: ProviderCredentialCleanupArgs<{ ok: boolean }> = {
      providers,
      operation: async () => {
        observedDuringHandoff = ((v) => (v ? v : ''))(providers[0]?.githubPat)
        return { ok: true }
      },
    }

    await expect(runWithProviderCredentialCleanup(args)).resolves.toEqual({
      ok: true,
    })
    expect(observedDuringHandoff).toBe('github_pat_snapshot_secret')
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('scrubs an IPC snapshot after a failed handoff', async () => {
    const providers = [{ githubPat: 'github_pat_failed_snapshot' }]
    const args: ProviderCredentialCleanupArgs<never> = {
      providers,
      operation: async () => {
        throw new Error('handoff failed')
      },
    }

    await expect(runWithProviderCredentialCleanup(args)).rejects.toThrow(
      'handoff failed',
    )
    expect(providers[0]).not.toHaveProperty('githubPat')
  })

  test('continues scrubbing after a malformed oauth provider', () => {
    const providers = [
      { oauthFile: 'malformed' },
      { oauthFile: { config: 'malformed' } },
      { githubPat: 'github_pat_following_secret' },
    ] as StorageProvider[]

    scrubProviderCredentials(providers)

    expect(providers[2]).not.toHaveProperty('githubPat')
  })

  test('rejects values outside the serialized external model', async () => {
    const source = [
      {
        id: 'github',
        githubPat: 'github_pat_rejected_secret',
        metadata: new Date(),
      },
    ]
    const staging = await stageFixture(source)

    expect(staging.kind).toBe(ProviderCredentialStagingKind.InvalidInput)
    scrubProviderCredentials(source)
    expect(source[0]).not.toHaveProperty('githubPat')
  })

  test('rejects __proto__ outside the provider contract', async () => {
    const source = JSON.parse(
      '[{"id":"github","__proto__":{"githubPat":"inherited-secret"}}]',
    )
    const staging = await stageFixture(source)

    expect(staging.kind).toBe(ProviderCredentialStagingKind.InvalidInput)
  })
})
