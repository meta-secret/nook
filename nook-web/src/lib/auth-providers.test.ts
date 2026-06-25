import { describe, expect, test } from 'vitest'
import {
  maskGithubPat,
  providerDefaultLabel,
  providerStorageDetail,
  type StorageProvider,
} from './auth-providers'

function githubProvider(
  overrides: Partial<StorageProvider> = {},
): StorageProvider {
  return {
    id: 'gh-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: 'nook',
    githubPat: 'github_pat_11AAAAAAAAAA',
    createdAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  }
}

describe('maskGithubPat', () => {
  test('masks fine-grained tokens with github_pat_ prefix', () => {
    expect(maskGithubPat('github_pat_11AAAAAAAAAA')).toBe('github_pat_11A…')
  })

  test('masks classic tokens with shorter prefix', () => {
    expect(maskGithubPat('ghp_1234567890ABCDEF')).toBe('ghp_123456…')
  })

  test('handles missing token', () => {
    expect(maskGithubPat(undefined)).toBe('No token saved')
  })
})

describe('providerStorageDetail', () => {
  test('distinguishes two GitHub repositories', () => {
    const alpha = githubProvider({
      id: 'gh-alpha',
      label: 'GitHub · alpha',
      githubRepo: 'alpha',
      githubPat: 'github_pat_11AAAAbbbb',
    })
    const beta = githubProvider({
      id: 'gh-beta',
      label: 'GitHub · beta',
      githubRepo: 'beta',
      githubPat: 'github_pat_22CCCCdddd',
    })

    expect(providerStorageDetail(alpha)).toBe(
      'alpha/nook-vault.yaml · github_pat_11A…',
    )
    expect(providerStorageDetail(beta)).toBe(
      'beta/nook-vault.yaml · github_pat_22C…',
    )
    expect(providerStorageDetail(alpha)).not.toBe(providerStorageDetail(beta))
  })

  test('never exposes the full token', () => {
    const pat = 'github_pat_11BBBBCCCCDDDDEEEEFFFF'
    const detail = providerStorageDetail(githubProvider({ githubPat: pat }))
    expect(detail).not.toContain(pat)
    expect(detail).toContain('…')
  })

  test('describes local browser storage', () => {
    const local: StorageProvider = {
      id: 'local-1',
      type: 'local',
      label: 'This device',
      createdAt: '2026-06-24T00:00:00.000Z',
    }
    expect(providerStorageDetail(local)).toBe(
      'Vault in browser storage on this device',
    )
  })
})

describe('providerDefaultLabel', () => {
  test('includes repo name for non-default GitHub repositories', () => {
    expect(providerDefaultLabel('github', 'team-vault')).toBe(
      'GitHub · team-vault',
    )
  })
})
