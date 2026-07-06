import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  findDuplicateSyncProvider,
  formatDriveStorageRef,
  maskGithubPat,
  providerDefaultLabel,
  providerStorageDetail,
  type StorageProvider,
} from '$lib/auth-providers'

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

    expect(providerStorageDetail(alpha)).toBe('alpha · github_pat_11A…')
    expect(providerStorageDetail(beta)).toBe('beta · github_pat_22C…')
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

  test('distinguishes two Google Drive vault files', () => {
    const personal: StorageProvider = {
      id: 'gd-1',
      type: 'oauth-file',
      label: 'Google Drive · personal.yaml',
      oauthFile: {
        preset: 'google-drive',
        accessToken: 'ya29.test',
        fileName: 'personal.yaml',
        accountEmail: 'me@example.com',
      },
      createdAt: '2026-06-24T00:00:00.000Z',
    }
    const work: StorageProvider = {
      id: 'gd-2',
      type: 'oauth-file',
      label: 'Google Drive · work.yaml',
      oauthFile: {
        preset: 'google-drive',
        accessToken: 'ya29.test',
        fileName: 'work.yaml',
        accountEmail: 'me@example.com',
      },
      createdAt: '2026-06-24T00:00:00.000Z',
    }

    expect(providerStorageDetail(personal)).toBe(
      'personal.yaml · me@example.com',
    )
    expect(providerStorageDetail(work)).toBe('work.yaml · me@example.com')
    expect(providerStorageDetail(personal)).not.toBe(
      providerStorageDetail(work),
    )
  })
})

describe('formatDriveStorageRef', () => {
  test('includes cached file id when present', () => {
    expect(formatDriveStorageRef('abc123', 'work.yaml')).toBe(
      'abc123\twork.yaml',
    )
  })

  test('omits empty file id for new vaults', () => {
    expect(formatDriveStorageRef(undefined, 'work.yaml')).toBe('work.yaml')
    expect(formatDriveStorageRef('', DEFAULT_DRIVE_BACKUP_NAME)).toBe(
      DEFAULT_DRIVE_BACKUP_NAME,
    )
  })

  test('formats without validating draft file names', () => {
    expect(formatDriveStorageRef(' abc ', ' work vault.yaml ')).toBe(
      'abc\twork vault.yaml',
    )
  })
})

describe('providerDefaultLabel', () => {
  test('includes repo name for non-default GitHub repositories', () => {
    expect(providerDefaultLabel('github', 'team-vault')).toBe(
      'GitHub · team-vault',
    )
  })

  test('includes file name for non-default Google Drive vaults', () => {
    expect(providerDefaultLabel('oauth-file', 'work.yaml')).toBe(
      'Google Drive · work.yaml',
    )
    expect(providerDefaultLabel('oauth-file')).toBe('Google Drive')
  })

  test('includes file name for non-default iCloud vaults', () => {
    expect(providerDefaultLabel('oauth-file', 'work.yaml', 'icloud')).toBe(
      'iCloud · work.yaml',
    )
    expect(providerDefaultLabel('oauth-file', undefined, 'icloud')).toBe(
      'iCloud',
    )
  })
})

describe('findDuplicateSyncProvider', () => {
  test('finds an existing GitHub duplicate', () => {
    const existing = githubProvider({
      id: 'gh-existing',
      githubRepo: 'nook-crdt-test-1',
      githubPat: 'github_pat_11AAAAAAAAAA',
    })
    const candidate = githubProvider({
      id: 'gh-new',
      githubRepo: 'nook-crdt-test-1',
      githubPat: 'github_pat_11AAAAAAAAAA',
    })
    expect(findDuplicateSyncProvider([existing], candidate)?.id).toBe(
      'gh-existing',
    )
  })

  test('ignores the excluded provider id', () => {
    const existing = githubProvider({ id: 'gh-self' })
    expect(
      findDuplicateSyncProvider([existing], existing, {
        excludeId: 'gh-self',
      }),
    ).toBeUndefined()
  })

  test('returns undefined when no duplicate exists', () => {
    const existing = githubProvider({
      githubRepo: 'alpha',
      githubPat: 'github_pat_11AAAA',
    })
    const candidate = githubProvider({
      githubRepo: 'beta',
      githubPat: 'github_pat_11AAAA',
    })
    expect(findDuplicateSyncProvider([existing], candidate)).toBeUndefined()
  })
})
