import { I18N_KEYS } from '../../../../nook-web-shared/src/generated/i18n-keys'
import { describe, expect, test } from 'vitest'
import {
  DEFAULT_DRIVE_BACKUP_NAME,
  configuredOAuthFile,
  defaultOAuthFileConfig,
  missingOAuthAccessToken,
  oauthAccessToken,
  providerPersistenceDefaults,
  rootGoogleDriveFolder,
  storedGoogleDriveFolder,
  storedOAuthCredential,
  type StorageProvider,
} from '$lib/auth/providers'
import {
  findSharedGrantProvider,
  SharedGrantProviderKind,
  SharedStorageTargetKind,
  shouldFlushSharedDriveGrant,
} from '$lib/vault/password-unlock'

function driveProvider(id: string, folderId: string): StorageProvider {
  const config = {
    ...defaultOAuthFileConfig({
      preset: 'google-drive',
      fileName: DEFAULT_DRIVE_BACKUP_NAME,
    }),
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
      findSharedGrantProvider({
        providers: [privateDrive, otherSharedDrive],
        preset: 'google-drive',
        target: {
          kind: SharedStorageTargetKind.Bound,
          storageTargetId: 'folder-required',
        },
      }),
    ).toEqual({ kind: SharedGrantProviderKind.AuthorizationRequired })
  })

  test('reuses only the provider saved for the granted target', () => {
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
    ).toEqual({
      kind: SharedGrantProviderKind.Existing,
      provider: matchingDrive,
    })
  })

  test('flushes every created Drive target when the owner token is usable', () => {
    const available = oauthAccessToken({
      ...defaultOAuthFileConfig({
        preset: 'google-drive',
        fileName: DEFAULT_DRIVE_BACKUP_NAME,
      }),
      accessToken: storedOAuthCredential('token-owner'),
    })
    const missing = missingOAuthAccessToken()
    expect(
      shouldFlushSharedDriveGrant({
        grant: {
          kind: 'granted',
          note: 'architecture_modes.shared_grant_created',
          target: {
            state: 'identified',
            storageTargetId: 'folder-required',
          },
        },
        accessCredential: available,
      }),
    ).toBe(true)
    expect(
      shouldFlushSharedDriveGrant({
        grant: {
          kind: 'manual-grant-required',
          instructionsKey:
            I18N_KEYS.ArchitectureModesSharedGrantManualInstructions,
          joinerIdentity: 'joiner@example.com',
          target: {
            state: 'identified',
            storageTargetId: 'folder-required',
          },
        },
        accessCredential: available,
      }),
    ).toBe(true)
    expect(
      shouldFlushSharedDriveGrant({
        grant: {
          kind: 'manual-grant-required',
          instructionsKey:
            I18N_KEYS.ArchitectureModesSharedGrantManualInstructions,
          joinerIdentity: 'joiner@example.com',
          target: {
            state: 'identified',
            storageTargetId: 'folder-required',
          },
        },
        accessCredential: missing,
      }),
    ).toBe(false)
  })
})
