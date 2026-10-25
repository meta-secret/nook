import { test, expect } from '@playwright/test'
import {
  createSharedVaultFolder,
  deleteFolderPermission,
  getFileMetadata,
  hasLiveDriveSharedGrantCredentials,
  listFolderPermissions,
  LiveDriveCredentialsStateKind,
  readLiveDriveSharedGrantCredentials,
  shareFolderWithEmail,
  trashDriveFile,
  uploadMarkerUnderFolder,
  verifySharedVaultFolder,
} from './google-drive-api'

/**
 * Opt-in live Google Drive vault folder and its authorized accounts (#289).
 *
 * Every Drive provider syncs under one My Drive folder; its Drive permissions
 * are the provider's authorized accounts. The owner authorizes an account on
 * the folder before a device invite names it — issuing the invite grants
 * nothing. This smoke sends the same Drive requests the authorized-accounts
 * WASM calls send.
 *
 * Requires:
 * - `NOOK_GOOGLE_E2E_ACCESS_TOKEN` — owner token with `drive.file` (+ typically
 *   `drive.readonly` for collaborator reads in product flows)
 * - `NOOK_GOOGLE_E2E_JOINER_EMAIL` — Google account email to authorize
 * - optional `NOOK_GOOGLE_E2E_JOINER_ACCESS_TOKEN` — joiner token to prove the
 *   authorization lets another account see/sync under that folder id
 *
 * Skips when credentials are absent so stub e2e / default CI stay unchanged.
 * Does not use `drive-stub.ts`.
 */
const describeLive = hasLiveDriveSharedGrantCredentials()
  ? test.describe
  : test.describe.skip

describeLive('live Google Drive vault folder authorized accounts', () => {
  test.describe.configure({ mode: 'serial' })

  let ownerToken = ''
  let joinerEmail = ''
  enum JoinerCredentialsKind {
    OwnerOnly = 'owner-only',
    OwnerAndJoiner = 'owner-and-joiner',
  }

  type JoinerCredentials =
    | { kind: JoinerCredentialsKind.OwnerOnly }
    | { kind: JoinerCredentialsKind.OwnerAndJoiner; accessToken: string }
  let joinerCredentials: JoinerCredentials = {
    kind: JoinerCredentialsKind.OwnerOnly,
  }
  let folderId = ''
  let markerFileId = ''

  test.beforeAll(() => {
    const credentials = readLiveDriveSharedGrantCredentials()
    if (credentials.kind === LiveDriveCredentialsStateKind.Missing) {
      throw new Error('live Drive shared-grant credentials missing')
    }
    ownerToken = credentials.ownerAccessToken
    joinerEmail = credentials.joinerEmail
    joinerCredentials =
      credentials.kind === LiveDriveCredentialsStateKind.OwnerOnly
        ? { kind: JoinerCredentialsKind.OwnerOnly }
        : {
            kind: JoinerCredentialsKind.OwnerAndJoiner,
            accessToken: credentials.joinerAccessToken,
          }
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

  test('creates the vault folder, authorizes the joiner account, syncs under that folder id, and revokes it', async () => {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-')
    const folderName = `nook-e2e-shared-grant-${stamp}`

    const folder = await createSharedVaultFolder(ownerToken, folderName)
    folderId = folder.id
    expect(folderId.length).toBeGreaterThan(0)

    // A new vault folder is shared with nobody: its only account is the owner.
    const created = await listFolderPermissions(ownerToken, folderId)
    expect(created.map((permission) => permission.role)).toEqual(['owner'])

    await shareFolderWithEmail(ownerToken, folderId, joinerEmail)
    const authorized = await listFolderPermissions(ownerToken, folderId)
    const joinerPermission = authorized.find(
      (permission) =>
        permission.type === 'user' &&
        permission.emailAddress.toLowerCase() === joinerEmail.toLowerCase(),
    )
    expect(joinerPermission?.role).toBe('writer')

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

    if (joinerCredentials.kind === JoinerCredentialsKind.OwnerAndJoiner) {
      const joinerToken = joinerCredentials.accessToken
      const joinerFolder = await verifySharedVaultFolder(joinerToken, folderId)
      expect(joinerFolder.canAddChildren).toBe(true)
      expect(joinerFolder.id).toBe(folderId)

      const joinerFile = await getFileMetadata(joinerToken, markerFileId)
      expect(((v) => (v ? v : []))(joinerFile.parents)).toContain(folderId)
      expect(joinerFile.name).toBe(markerName)
    }

    if (!joinerPermission) throw new Error('joiner permission was not listed')
    await deleteFolderPermission(ownerToken, folderId, joinerPermission.id)
    const revoked = await listFolderPermissions(ownerToken, folderId)
    expect(revoked.map((permission) => permission.id)).not.toContain(
      joinerPermission.id,
    )
  })
})
