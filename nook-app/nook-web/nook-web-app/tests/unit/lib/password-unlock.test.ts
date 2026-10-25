import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  providerPersistenceDefaults,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  findSharedGrantProvider,
  SharedStorageTargetKind,
} from '$lib/vault/password-unlock'

function driveProvider(id: string, folderId: string): StorageProvider {
  const config = {
    ...defaultOAuthFileConfig({
      preset: 'google-drive',
      fileName: DEFAULT_DRIVE_BACKUP_NAME,
    }),
    accessToken: storedOAuthCredential(`token-${id}`),
    folderId: storedGoogleDriveFolder(folderId),
  }
  return {
    ...providerPersistenceDefaults(),
    id,
    type: 'oauth-file',
    label: 'Google Drive',
    oauthFile: configuredOAuthFile(config),
    syncCheckpoint: { state: 'neverSynced' },
    createdAt: '2026-07-15T00:00:00.000Z',
  }
}

describe('shared enrollment provider selection', () => {
  test('never reuses a token saved for another Drive folder', () => {
    expect(
      findSharedGrantProvider({
        providers: [driveProvider('other', 'folder-other')],
        preset: 'google-drive',
        target: {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: 'folder-required',
        },
      }),
    ).toEqual({ kind: 'authorizationRequired' })
  })

  test('reuses only the provider saved for the invited folder', () => {
    const matchingDrive = driveProvider('matching', 'folder-required')

    expect(
      findSharedGrantProvider({
        providers: [driveProvider('other', 'folder-other'), matchingDrive],
        preset: 'google-drive',
        target: {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: 'folder-required',
        },
      }),
    ).toEqual({ kind: 'existing', provider: matchingDrive })
  })
})
