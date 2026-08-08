import { describe, expect, test } from 'bun:test'
import {
  ProviderCredentialStagingKind,
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
    const source = [
      {
        id: 'github',
        githubPat: 'github_pat_rejected_secret',
        metadata: new Date(),
      },
    ]
    const staging = stageProviderCredentials(source)

    expect(staging.kind).toBe(ProviderCredentialStagingKind.InvalidInput)
    scrubProviderCredentials(source)
    expect(source[0]).not.toHaveProperty('githubPat')
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
