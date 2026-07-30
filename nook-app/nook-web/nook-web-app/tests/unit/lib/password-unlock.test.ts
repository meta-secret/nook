import { describe, expect, test } from 'vitest'
import {
  configuredOAuthFile,
  defaultOAuthFileConfig,
  missingOAuthAccessToken,
  oauthAccessToken,
  providerPersistenceDefaults,
  rootGoogleDriveFolder,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type StorageProvider,
} from '$lib/auth-providers'
import {
  findSharedGrantProvider,
  SharedGrantProviderKind,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
} from '$lib/vault/password-unlock'

function driveProvider(id: string, folderId: string): StorageProvider {
  const config = {
    ...defaultOAuthFileConfig('google-drive'),
    accessToken: storedOAuthCredential(`token-${id}`),
    folderId: folderId
      ? storedGoogleDriveFolder(folderId)
      : rootGoogleDriveFolder(),
    driveMode: folderId ? ('shared' as const) : ('private' as const),
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
    const privateDrive = driveProvider('private', '')
    const otherSharedDrive = driveProvider('other', 'folder-other')

    expect(
      findSharedGrantProvider(
        [privateDrive, otherSharedDrive],
        'google-drive',
        {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: 'folder-required',
        },
      ),
    ).toEqual({ kind: SharedGrantProviderKind.AuthorizationRequired })
  })

  test('reuses only the provider saved for the granted target', () => {
    const matchingDrive = driveProvider('matching', 'folder-required')

    expect(
      findSharedGrantProvider(
        [driveProvider('other', 'folder-other'), matchingDrive],
        'google-drive',
        {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: 'folder-required',
        },
      ),
    ).toEqual({
      kind: SharedGrantProviderKind.Existing,
      provider: matchingDrive,
    })
  })

  test('flushes every created Drive target when the owner token is usable', () => {
    const available = oauthAccessToken({
      ...defaultOAuthFileConfig('google-drive'),
      accessToken: storedOAuthCredential('token-owner'),
    })
    const missing = missingOAuthAccessToken()
    try {
      expect(
        shouldFlushSharedDriveGrant(
          {
            kind: 'granted',
            note: 'architecture_modes.shared_grant_created',
            target: {
              state: 'identified',
              storageTargetId: 'folder-required',
            },
          },
          available,
        ),
      ).toBe(true)
      expect(
        shouldFlushSharedDriveGrant(
          {
            kind: 'manual-grant-required',
            instructionsKey:
              'architecture_modes.shared_grant_manual_instructions',
            joinerIdentity: 'joiner@example.com',
            target: {
              state: 'identified',
              storageTargetId: 'folder-required',
            },
          },
          available,
        ),
      ).toBe(true)
      expect(
        shouldFlushSharedDriveGrant(
          {
            kind: 'manual-grant-required',
            instructionsKey:
              'architecture_modes.shared_grant_manual_instructions',
            joinerIdentity: 'joiner@example.com',
            target: {
              state: 'identified',
              storageTargetId: 'folder-required',
            },
          },
          missing,
        ),
      ).toBe(false)
    } finally {
      available.free()
      missing.free()
    }
  })
})
