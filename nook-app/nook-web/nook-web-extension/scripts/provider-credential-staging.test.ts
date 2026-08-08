import { describe, expect, test } from 'bun:test'
import {
  ProviderCredentialStagingKind,
  isStorageProviderCollection,
  scrubProviderCredentials,
  stageProviderCredentials,
} from '../src/lib/provider-credential-staging'

describe('provider credential staging', () => {
  test('copies provider credentials into an owned mutable buffer', () => {
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

    const staging = stageProviderCredentials(source)

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

  test('scrubs a staged copy when queued import work expires', () => {
    const staging = stageProviderCredentials([
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

  test('rejects values outside the serialized external model', () => {
    const staging = stageProviderCredentials([
      { id: 'drive', metadata: new Date() },
    ])

    expect(staging.kind).toBe(ProviderCredentialStagingKind.InvalidInput)
  })

  test('rejects serialized values that are not storage providers', () => {
    const staging = stageProviderCredentials([{ foo: 'bar' }])

    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    expect(isStorageProviderCollection(staging.providers)).toBe(false)
  })

  test('accepts a complete serialized storage provider', () => {
    const staging = stageProviderCredentials([
      {
        id: 'github',
        type: 'github',
        label: 'GitHub',
        githubPat: { state: 'token', value: 'github_pat_secret' },
        githubRepo: { state: 'repository', value: 'nook' },
        oauthFile: { state: 'notApplicable' },
        localFolder: { state: 'notApplicable' },
        storeId: { state: 'unscoped' },
        syncCheckpoint: { state: 'neverSynced' },
        createdAt: '2026-08-08T00:00:00Z',
      },
    ])

    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    expect(isStorageProviderCollection(staging.providers)).toBe(true)
  })

  test('clones __proto__ as an own data property', () => {
    const source = JSON.parse(
      '[{"id":"github","__proto__":{"githubPat":"inherited-secret"}}]',
    )
    const staging = stageProviderCredentials(source)

    expect(staging.kind).toBe(ProviderCredentialStagingKind.Staged)
    if (staging.kind !== ProviderCredentialStagingKind.Staged) return
    const provider = staging.providers[0]
    expect(provider && typeof provider === 'object').toBe(true)
    if (!provider || typeof provider !== 'object') return
    expect(Object.hasOwn(provider, '__proto__')).toBe(true)
    expect('githubPat' in provider).toBe(false)
  })
})
