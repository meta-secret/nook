import { describe, expect, test } from 'bun:test'
import {
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

    const staged = stageProviderCredentials(source)

    expect(staged).toEqual([
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
    const staged = stageProviderCredentials([
      {
        id: 'drive',
        oauthFile: {
          accessToken: 'access-secret',
          refreshToken: 'refresh-secret',
        },
      },
    ])

    scrubProviderCredentials(staged)

    expect(staged?.[0]).toEqual({
      id: 'drive',
      oauthFile: {
        accessToken: '',
      },
    })
    expect(staged?.[0]?.oauthFile).not.toHaveProperty('refreshToken')
  })
})
