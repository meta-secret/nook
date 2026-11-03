import { describe, expect, test } from 'vitest'
import type { StorageProvider } from '$lib/auth/providers'
import {
  findSharedGrantProvider,
  SharedStorageTargetKind,
} from '$lib/vault/password-unlock'
import { ProviderRowFixture } from '../provider-fixtures'

function driveProvider(id: string, folderId: string): StorageProvider {
  return ProviderRowFixture.googleDriveIn({
    request: ProviderRowFixture.unscoped(id),
    folderId,
  })
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
