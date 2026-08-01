import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  DriveFileIdentityKind,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  findDuplicateSyncProvider,
  findDuplicateSyncProviderExcluding,
  formatDriveStorageRef,
  GithubPatDisplayKind,
  maskGithubPat,
  providerDefaultLabel,
  providerPersistenceDefaults,
  providerStorageDetail,
  storedGithubPat,
  storedGithubRepository,
  storedOAuthAccountEmail,
  storedOAuthCredential,
  storedOAuthRemoteFileName,
  type StorageProvider,
} from '$lib/auth/providers'
import { NookDuplicateSyncProviderState } from '$app-wasm'

function githubProvider(
  overrides: Partial<StorageProvider> = {},
): StorageProvider {
  return {
    ...providerPersistenceDefaults(),
    id: 'gh-1',
    type: 'github',
    label: 'GitHub',
    githubRepo: storedGithubRepository('nook'),
    githubPat: storedGithubPat('github_pat_11AAAAAAAAAA'),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-06-24T00:00:00.000Z',
    ...overrides,
  }
}

describe('maskGithubPat', () => {
  test('masks fine-grained tokens with github_pat_ prefix', () => {
    expect(
      maskGithubPat({
        kind: GithubPatDisplayKind.Stored,
        pat: 'github_pat_11AAAAAAAAAA',
      }),
    ).toBe('github_pat_11A…')
  })

  test('masks classic tokens with shorter prefix', () => {
    expect(
      maskGithubPat({
        kind: GithubPatDisplayKind.Stored,
        pat: 'ghp_1234567890ABCDEF',
      }),
    ).toBe('ghp_123456…')
  })

  test('handles missing token', () => {
    expect(maskGithubPat({ kind: GithubPatDisplayKind.NoToken })).toBe(
      'No token saved',
    )
  })
})

describe('providerStorageDetail', () => {
  test('distinguishes two GitHub repositories', () => {
    const alpha = githubProvider({
      id: 'gh-alpha',
      label: 'GitHub · alpha',
      githubRepo: storedGithubRepository('alpha'),
      githubPat: storedGithubPat('github_pat_11AAAAbbbb'),
    })
    const beta = githubProvider({
      id: 'gh-beta',
      label: 'GitHub · beta',
      githubRepo: storedGithubRepository('beta'),
      githubPat: storedGithubPat('github_pat_22CCCCdddd'),
    })

    expect(providerStorageDetail(alpha)).toBe('alpha · github_pat_11A…')
    expect(providerStorageDetail(beta)).toBe('beta · github_pat_22C…')
    expect(providerStorageDetail(alpha)).not.toBe(providerStorageDetail(beta))
  })

  test('never exposes the full token', () => {
    const pat = 'github_pat_11BBBBCCCCDDDDEEEEFFFF'
    const detail = providerStorageDetail(
      githubProvider({ githubPat: storedGithubPat(pat) }),
    )
    expect(detail).not.toContain(pat)
    expect(detail).toContain('…')
  })

  test('describes local browser storage', () => {
    const local: StorageProvider = {
      ...providerPersistenceDefaults(),
      id: 'local-1',
      type: 'local',
      label: 'This device',
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-06-24T00:00:00.000Z',
    }
    expect(providerStorageDetail(local)).toBe(
      'Vault in browser storage on this device',
    )
  })

  test('distinguishes two Google Drive vault files', () => {
    const personal: StorageProvider = {
      ...providerPersistenceDefaults(),
      id: 'gd-1',
      type: 'oauth-file',
      label: 'Google Drive · personal.yaml',
      oauthFile: configuredOAuthFile({
        ...defaultOAuthFileConfig('google-drive'),
        accessToken: storedOAuthCredential('ya29.test'),
        fileName: storedOAuthRemoteFileName('personal.yaml'),
        accountEmail: storedOAuthAccountEmail('me@example.com'),
      }),
      syncCheckpoint: { state: 'neverSynced' },
      createdAt: '2026-06-24T00:00:00.000Z',
    }
    const work: StorageProvider = {
      ...providerPersistenceDefaults(),
      id: 'gd-2',
      type: 'oauth-file',
      label: 'Google Drive · work.yaml',
      oauthFile: configuredOAuthFile({
        ...defaultOAuthFileConfig('google-drive'),
        accessToken: storedOAuthCredential('ya29.test'),
        fileName: storedOAuthRemoteFileName('work.yaml'),
        accountEmail: storedOAuthAccountEmail('me@example.com'),
      }),
      syncCheckpoint: { state: 'neverSynced' },
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
    expect(
      formatDriveStorageRef(
        { kind: DriveFileIdentityKind.Existing, fileId: 'abc123' },
        'work.yaml',
      ),
    ).toBe('abc123\twork.yaml')
  })

  test('omits empty file id for new vaults', () => {
    expect(
      formatDriveStorageRef({ kind: DriveFileIdentityKind.New }, 'work.yaml'),
    ).toBe('work.yaml')
    expect(
      formatDriveStorageRef(
        { kind: DriveFileIdentityKind.New },
        DEFAULT_DRIVE_BACKUP_NAME,
      ),
    ).toBe(DEFAULT_DRIVE_BACKUP_NAME)
  })

  test('formats without validating draft file names', () => {
    expect(
      formatDriveStorageRef(
        { kind: DriveFileIdentityKind.Existing, fileId: ' abc ' },
        ' work vault.yaml ',
      ),
    ).toBe('abc\twork vault.yaml')
  })
})

describe('providerDefaultLabel', () => {
  test('includes repo name for non-default GitHub repositories', () => {
    expect(providerDefaultLabel('github', { detail: 'team-vault' })).toBe(
      'GitHub · team-vault',
    )
  })

  test('includes file name for non-default Google Drive vaults', () => {
    expect(providerDefaultLabel('oauth-file', { detail: 'work.yaml' })).toBe(
      'Google Drive · work.yaml',
    )
    expect(providerDefaultLabel('oauth-file')).toBe('Google Drive')
  })

  test('includes file name for non-default iCloud vaults', () => {
    expect(
      providerDefaultLabel('oauth-file', {
        detail: 'work.yaml',
        oauthPreset: 'icloud',
      }),
    ).toBe('iCloud · work.yaml')
    expect(providerDefaultLabel('oauth-file', { oauthPreset: 'icloud' })).toBe(
      'iCloud',
    )
  })
})

describe('findDuplicateSyncProvider', () => {
  test('finds an existing GitHub duplicate', () => {
    const existing = githubProvider({
      id: 'gh-existing',
      githubRepo: storedGithubRepository('nook-crdt-test-1'),
      githubPat: storedGithubPat('github_pat_11AAAAAAAAAA'),
    })
    const candidate = githubProvider({
      id: 'gh-new',
      githubRepo: storedGithubRepository('nook-crdt-test-1'),
      githubPat: storedGithubPat('github_pat_11AAAAAAAAAA'),
    })
    expect(findDuplicateSyncProvider([existing], candidate)).toEqual({
      state: NookDuplicateSyncProviderState.Duplicate,
      provider: existing,
    })
  })

  test('ignores the excluded provider id', () => {
    const existing = githubProvider({ id: 'gh-self' })
    expect(
      findDuplicateSyncProviderExcluding([existing], existing, 'gh-self'),
    ).toEqual({ state: NookDuplicateSyncProviderState.Unique })
  })

  test('returns the unique state when no duplicate exists', () => {
    const existing = githubProvider({
      githubRepo: storedGithubRepository('alpha'),
      githubPat: storedGithubPat('github_pat_11AAAA'),
    })
    const candidate = githubProvider({
      githubRepo: storedGithubRepository('beta'),
      githubPat: storedGithubPat('github_pat_11AAAA'),
    })
    expect(findDuplicateSyncProvider([existing], candidate)).toEqual({
      state: NookDuplicateSyncProviderState.Unique,
    })
  })
})
