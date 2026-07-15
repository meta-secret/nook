import { describe, expect, test } from 'vitest'
import type { StorageProvider } from '$lib/auth-providers'
import {
  findSharedGrantProvider,
  shouldFlushSharedDriveGrant,
} from '$lib/vault/password-unlock'

function driveProvider(id: string, folderId: string): StorageProvider {
  return {
    id,
    type: 'oauth-file',
    label: 'Google Drive',
    oauthFile: {
      preset: 'google-drive',
      accessToken: `token-${id}`,
      folderId,
      driveMode: folderId ? 'shared' : 'private',
      fileName: 'nook-events',
    },
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
        'folder-required',
      ),
    ).toBeUndefined()
  })

  test('reuses only the provider saved for the granted target', () => {
    const matchingDrive = driveProvider('matching', 'folder-required')

    expect(
      findSharedGrantProvider(
        [driveProvider('other', 'folder-other'), matchingDrive],
        'google-drive',
        'folder-required',
      )?.id,
    ).toBe('matching')
  })

  test('flushes only an automatic Drive grant with a usable token', () => {
    expect(
      shouldFlushSharedDriveGrant(
        {
          kind: 'granted',
          note: 'architecture_modes.shared_grant_created',
          storageTargetId: 'folder-required',
        },
        'token-owner',
      ),
    ).toBe(true)
    expect(
      shouldFlushSharedDriveGrant(
        {
          kind: 'manual-grant-required',
          instructionsKey:
            'architecture_modes.shared_grant_manual_instructions',
          joinerIdentity: 'joiner@example.com',
          storageTargetId: 'folder-required',
        },
        '',
      ),
    ).toBe(false)
  })
})
