import { describe, expect, test } from 'bun:test'
import {
  ProviderCredentialStagingKind,
  scrubProviderCredentials,
  stageProviderCredentials,
} from '../src/lib/provider-credential-staging'

describe('provider credential staging', () => {
  test('copies provider credentials and scrubs the source immediately', () => {
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
    expect(Object.hasOwn(source[0] ?? {}, 'githubPat')).toBe(false)
    expect(source[1]?.oauthFile?.accessToken).toBe('')
    expect(Object.hasOwn(source[1]?.oauthFile ?? {}, 'refreshToken')).toBe(
      false,
    )
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
})
