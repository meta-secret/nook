import { describe, expect, test } from 'vitest'
import type { StorageProvider } from '$lib/auth-providers'
import { findSharedGrantProvider } from '$lib/vault/password-unlock'

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
})
