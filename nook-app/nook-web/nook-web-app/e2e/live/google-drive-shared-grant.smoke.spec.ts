import { test, expect } from '@playwright/test'
import {
  createSharedVaultFolder,
  getFileMetadata,
  hasLiveDriveSharedGrantCredentials,
  readLiveDriveSharedGrantCredentials,
  shareFolderWithEmail,
  trashDriveFile,
  uploadMarkerUnderFolder,
  verifySharedVaultFolder,
} from './google-drive-api'

/**
 * Opt-in live Google Drive shared-folder grant (#289).
 *
 * Requires:
 * - `NOOK_GOOGLE_E2E_ACCESS_TOKEN` — owner token with `drive.file` (+ typically
 *   `drive.readonly` for collaborator reads in product flows)
 * - `NOOK_GOOGLE_E2E_JOINER_EMAIL` — Google account email to grant
 * - optional `NOOK_GOOGLE_E2E_JOINER_ACCESS_TOKEN` — joiner token to prove the
 *   grant lets another account see/sync under that folder id
 *
 * Skips when credentials are absent so stub e2e / default CI stay unchanged.
 * Does not use `drive-stub.ts`.
 */
const describeLive = hasLiveDriveSharedGrantCredentials()
  ? test.describe
  : test.describe.skip

describeLive('live Google Drive shared-folder grant', () => {
  test.describe.configure({ mode: 'serial' })

  let ownerToken = ''
  let joinerEmail = ''
  let joinerToken: string | undefined
  let folderId = ''
  let markerFileId = ''

  test.beforeAll(() => {
    const credentials = readLiveDriveSharedGrantCredentials()
    if (!credentials) {
      throw new Error('live Drive shared-grant credentials missing')
    }
    ownerToken = credentials.ownerAccessToken
    joinerEmail = credentials.joinerEmail
    joinerToken = credentials.joinerAccessToken
  })

  test.afterAll(async () => {
    if (!ownerToken || !folderId) return
    try {
      if (markerFileId) await trashDriveFile(ownerToken, markerFileId)
    } catch {
      // best-effort cleanup
    }
    try {
      await trashDriveFile(ownerToken, folderId)
    } catch {
      // best-effort cleanup
    }
  })

  test('creates a shareable folder, grants joiner email, and syncs under that folder id', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const folderName = `nook-e2e-shared-grant-${stamp}`

    const folder = await createSharedVaultFolder(ownerToken, folderName)
    folderId = folder.id
    expect(folderId.length).toBeGreaterThan(0)

    await shareFolderWithEmail(ownerToken, folderId, joinerEmail)

    const ownerView = await verifySharedVaultFolder(ownerToken, folderId)
    expect(ownerView.canAddChildren).toBe(true)
    expect(ownerView.id).toBe(folderId)

    const markerName = `nook-live-marker-${stamp}.txt`
    const markerBody = `nook live shared grant under ${folderId}\n`
    markerFileId = await uploadMarkerUnderFolder(
      ownerToken,
      folderId,
      markerName,
      markerBody,
    )
    expect(markerFileId.length).toBeGreaterThan(0)

    if (joinerToken) {
      const joinerFolder = await verifySharedVaultFolder(joinerToken, folderId)
      expect(joinerFolder.canAddChildren).toBe(true)
      expect(joinerFolder.id).toBe(folderId)

      const joinerFile = await getFileMetadata(joinerToken, markerFileId)
      expect(joinerFile.parents ?? []).toContain(folderId)
      expect(joinerFile.name).toBe(markerName)
    }
  })
})
