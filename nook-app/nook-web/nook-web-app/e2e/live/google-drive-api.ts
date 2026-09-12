/**
 * Live Google Drive REST helpers for opt-in shared-folder grant smoke.
 * Calls the real Drive API — never the Playwright `drive-stub.ts` routes.
 */

const DRIVE_FILES = 'https://www.googleapis.com/drive/v3/files'
const FOLDER_MIME = 'application/vnd.google-apps.folder'

import { readStringProperty, requireRecord } from '../helpers/guards'

export enum LiveDriveCredentialsStateKind {
  Missing = 'missing',
  OwnerOnly = 'owner-only',
  OwnerAndJoiner = 'owner-and-joiner',
}

export type LiveDriveCredentialsState =
  | { kind: LiveDriveCredentialsStateKind.Missing }
  | {
      kind: LiveDriveCredentialsStateKind.OwnerOnly
      ownerAccessToken: string
      joinerEmail: string
    }
  | {
      kind: LiveDriveCredentialsStateKind.OwnerAndJoiner
      ownerAccessToken: string
      joinerEmail: string
      joinerAccessToken: string
    }

export function readLiveDriveSharedGrantCredentials(): LiveDriveCredentialsState {
  const ownerAccessToken = process.env.NOOK_GOOGLE_E2E_ACCESS_TOKEN?.trim()
  const joinerEmail = process.env.NOOK_GOOGLE_E2E_JOINER_EMAIL?.trim()
  if (!ownerAccessToken || !joinerEmail) {
    return { kind: LiveDriveCredentialsStateKind.Missing }
  }
  const joinerAccessToken =
    process.env.NOOK_GOOGLE_E2E_JOINER_ACCESS_TOKEN?.trim()
  return joinerAccessToken
    ? {
        kind: LiveDriveCredentialsStateKind.OwnerAndJoiner,
        ownerAccessToken,
        joinerEmail,
        joinerAccessToken,
      }
    : {
        kind: LiveDriveCredentialsStateKind.OwnerOnly,
        ownerAccessToken,
        joinerEmail,
      }
}

export function hasLiveDriveSharedGrantCredentials(): boolean {
  return (
    readLiveDriveSharedGrantCredentials().kind !==
    LiveDriveCredentialsStateKind.Missing
  )
}

async function driveJson(
  accessToken: string,
  url: string,
  init?: RequestInit,
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...((v) => (v ? v : {}))(init?.headers),
    },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `Drive API ${response.status} for ${url}: ${body.slice(0, 500)}`,
    )
  }
  return body ? JSON.parse(body) : {}
}

/** Create a My Drive folder (`drive.file` write scope). */
export async function createSharedVaultFolder(
  accessToken: string,
  name: string,
): Promise<{ id: string; name: string }> {
  const created = requireRecord(
    await driveJson(accessToken, `${DRIVE_FILES}?fields=id,name`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        mimeType: FOLDER_MIME,
      }),
    }),
    'Drive folder response',
  )
  const id = readStringProperty(created, 'id', 'Drive folder response')
  if (!id.trim()) {
    throw new Error('Drive folder create response missing id')
  }
  const responseName = created.name
  return {
    id,
    name: typeof responseName === 'string' ? responseName.trim() || name : name,
  }
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
  const meta = requireRecord(
    await driveJson(accessToken, url.toString()),
    'Drive folder metadata',
  )
  if (meta.mimeType !== FOLDER_MIME) {
    throw new Error('Shared Drive target is not a folder')
  }
  const id = typeof meta.id === 'string' ? meta.id.trim() : ''
  const name = typeof meta.name === 'string' ? meta.name.trim() : ''
  const capabilities =
    typeof meta.capabilities === 'object' && meta.capabilities !== null
      ? requireRecord(meta.capabilities, 'Drive folder capabilities')
      : {}
  return {
    id: id || folderId,
    name: name || 'Nook shared vault',
    canAddChildren: capabilities.canAddChildren === true,
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
  const parsed = requireRecord(JSON.parse(text), 'Drive upload response')
  const id = readStringProperty(parsed, 'id', 'Drive upload response')
  if (!id.trim()) {
    throw new Error('Drive upload response missing id')
  }
  return id
}

/** List a file by id (used by joiner after grant). */
export async function getFileMetadata(
  accessToken: string,
  fileId: string,
): Promise<{ id: string; name: string; parents?: string[] }> {
  const url = new URL(`${DRIVE_FILES}/${encodeURIComponent(fileId)}`)
  url.searchParams.set('fields', 'id,name,parents')
  url.searchParams.set('supportsAllDrives', 'true')
  const meta = requireRecord(
    await driveJson(accessToken, url.toString()),
    'Drive file metadata',
  )
  const id = readStringProperty(meta, 'id', 'Drive file metadata')
  if (!id.trim()) {
    throw new Error('Drive file metadata missing id')
  }
  const metadata: { id: string; name: string; parents?: string[] } = {
    id,
    name: typeof meta.name === 'string' ? meta.name.trim() || fileId : fileId,
  }
  if (Array.isArray(meta.parents)) {
    const parents = meta.parents.filter(
      (parent): parent is string => typeof parent === 'string',
    )
    metadata.parents = parents
  }
  return metadata
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
