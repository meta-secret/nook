/**
 * Live Google Drive REST helpers for opt-in shared-folder grant smoke.
 * Calls the real Drive API — never the Playwright `drive-stub.ts` routes.
 */

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

export type LiveDriveCredentials = {
  ownerAccessToken: string
  joinerEmail: string
  joinerAccessToken?: string
}

export function readLiveDriveSharedGrantCredentials():
  | LiveDriveCredentials
  | undefined {
  const ownerAccessToken = process.env.NOOK_GOOGLE_E2E_ACCESS_TOKEN?.trim()
  const joinerEmail = process.env.NOOK_GOOGLE_E2E_JOINER_EMAIL?.trim()
  if (!ownerAccessToken || !joinerEmail) return undefined
  const joinerAccessToken =
    process.env.NOOK_GOOGLE_E2E_JOINER_ACCESS_TOKEN?.trim() || undefined
  return { ownerAccessToken, joinerEmail, joinerAccessToken }
}

export function hasLiveDriveSharedGrantCredentials(): boolean {
  return readLiveDriveSharedGrantCredentials() !== undefined
}

async function driveJson<T>(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init?.headers ?? {}),
    },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `Drive API ${response.status} for ${url}: ${body.slice(0, 500)}`,
    )
  }
  if (!body) return {} as T
  return JSON.parse(body) as T
}

/** Create a My Drive folder (`drive.file` write scope). */
export async function createSharedVaultFolder(
  accessToken: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const created = await driveJson<{ id?: string; name?: string }>(
    accessToken,
    `${DRIVE_FILES}?fields=id,name`,
    {
      method: 'POST',
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
      }),
    },
  )
  if (!created.id?.trim()) {
    throw new Error('Drive folder create response missing id')
  }
  return { id: created.id, name: created.name?.trim() || name }
}

/** Grant writer access to joiner email (`permissions.create`). */
export async function shareFolderWithEmail(
  accessToken: string,
  folderId: string,
  email: string,
): Promise<void> {
  const url = new URL(
    `${DRIVE_FILES}/${encodeURIComponent(folderId)}/permissions`,
  )
  // Opt-in smoke must not spam real inboxes when exercising the grant API.
  url.searchParams.set('sendNotificationEmail', 'false')
  url.searchParams.set('supportsAllDrives', 'true')
  await driveJson(accessToken, url.toString(), {
    method: 'POST',
    body: JSON.stringify({
      type: 'user',
      role: 'writer',
      emailAddress: email,
    }),
  })
}

/** Verify the account can append children under the shared folder. */
export async function verifySharedVaultFolder(
  accessToken: string,
  folderId: string,
): Promise<{ id: string; name: string; canAddChildren: boolean }> {
  const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(folderId)}`)
  url.searchParams.set(
    'fields',
    'id,name,mimeType,capabilities(canAddChildren)',
  )
  url.searchParams.set('supportsAllDrives', 'true')
  const meta = await driveJson<{
    id?: string
    name?: string
    mimeType?: string
    capabilities?: { canAddChildren?: boolean }
  }>(accessToken, url.toString())
  if (meta.mimeType !== FOLDER_MIME) {
    throw new Error('Shared Drive target is not a folder')
  }
  return {
    id: meta.id?.trim() || folderId,
    name: meta.name?.trim() || 'Nook shared vault',
    canAddChildren: meta.capabilities?.canAddChildren === true,
  }
}

/** Upload a small marker file under the shared folder (sync parent exercise). */
export async function uploadMarkerUnderFolder(
  accessToken: string,
  folderId: string,
  fileName: string,
  content: string,
): Promise<string> {
  const metadata = {
    name: fileName,
    parents: [folderId],
    mimeType: 'text/plain',
  }
  const boundary = 'nook_live_drive_boundary'
  const body = [
    `--${boundary}`,
    'Content-Type: application/json; charset=UTF-8',
    '',
    JSON.stringify(metadata),
    `--${boundary}`,
    'Content-Type: text/plain',
    '',
    content,
    `--${boundary}--`,
    '',
  ].join('\r\n')
  const response = await fetch(
    'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body,
    },
  )
  const text = await response.text()
  if (!response.ok) {
    throw new Error(
      `Drive multipart upload ${response.status}: ${text.slice(0, 500)}`,
    )
  }
  const parsed = JSON.parse(text) as { id?: string }
  if (!parsed.id?.trim()) {
    throw new Error('Drive upload response missing id')
  }
  return parsed.id
}

/** List a file by id (used by joiner after grant). */
export async function getFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<{ id: string; name: string; parents?: string[] }> {
  const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'id,name,parents')
  url.searchParams.set('supportsAllDrives', 'true')
  const meta = await driveJson<{
    id?: string
    name?: string
    parents?: string[]
  }>(accessToken, url.toString())
  if (!meta.id?.trim()) {
    throw new Error('Drive file metadata missing id')
  }
  return {
    id: meta.id,
    name: meta.name?.trim() || fileId,
    parents: meta.parents,
  }
}

/** Best-effort trash cleanup so live smoke does not leave folders behind. */
export async function trashDriveFile(
  accessToken: string,
  fileId: string,
): Promise<void> {
  await driveJson(accessToken, `${DRIVE_FILES}/${encodeURIComponent(fileId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed: true }),
  })
}
