import type { Route } from '@playwright/test'
import { parseJson, requireRecord } from './helpers/guards'

export const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'
const DRIVE_FILES_URL = 'https://www.googleapis.com/drive/v3/files'
const DEFAULT_VAULT_FOLDER_NAME = 'Nook shared vault'
const CORS_HEADERS = { 'access-control-allow-origin': '*' }

export enum DriveFolderRole {
  Owner = 'owner',
  Writer = 'writer',
}

/** One Drive permission on a vault folder: an authorized account. */
export type DriveFolderPermission = {
  readonly id: string
  readonly type: 'user'
  readonly role: DriveFolderRole
  readonly emailAddress: string
}

/** A My Drive vault folder and the accounts it is shared with. */
export type DriveVaultFolder = {
  readonly id: string
  readonly name: string
  permissions: DriveFolderPermission[]
}

/** One intercepted Drive request, as the stub that owns the route read it. */
export type DriveFolderRequest = {
  readonly route: Route
  readonly url: string
  readonly fullUrl: string
  readonly method: string
  readonly bodyText: string
  /** The Google account the page is signed in as. */
  readonly accountEmail: string
  /** A non-2xx status makes `permissions.create` fail. */
  readonly permissionStatus: number
}

const PERMISSIONS_URL_PATTERN =
  /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)\/permissions(?:\/([^/]+))?$/
const FOLDER_URL_PATTERN =
  /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)$/

function sameAccount(left: string, right: string): boolean {
  return left.trim().toLowerCase() === right.trim().toLowerCase()
}

/**
 * Vault folders, their metadata, and their Drive permissions for the e2e
 * Drive stubs. A folder created through `files.create` is owned by the
 * account that created it. A folder id a test seeds without creating it is
 * registered on first use, owned by the account that first reaches it.
 */
export function createDriveVaultFolders(idPrefix: string) {
  const folders = new Map<string, DriveVaultFolder>()
  let folderSequence = 0
  let permissionSequence = 0

  function ownerPermission(emailAddress: string): DriveFolderPermission {
    permissionSequence += 1
    return {
      id: `${idPrefix}-perm-${permissionSequence}`,
      type: 'user',
      role: DriveFolderRole.Owner,
      emailAddress,
    }
  }

  function folderFor(id: string, accountEmail: string): DriveVaultFolder {
    const existing = folders.get(id)
    if (existing) return existing
    const seeded: DriveVaultFolder = {
      id,
      name: DEFAULT_VAULT_FOLDER_NAME,
      permissions: [ownerPermission(accountEmail)],
    }
    folders.set(id, seeded)
    return seeded
  }

  function canWrite(folder: DriveVaultFolder, accountEmail: string) {
    return folder.permissions.some((permission) =>
      sameAccount(permission.emailAddress, accountEmail),
    )
  }

  async function fulfillJson(route: Route, status: number, body: unknown) {
    await route.fulfill({
      status,
      contentType: 'application/json',
      headers: CORS_HEADERS,
      body: JSON.stringify(body),
    })
  }

  async function notFound(route: Route) {
    await fulfillJson(route, 404, { error: { message: 'File not found' } })
  }

  function folderCreation(bodyText: string): string | false {
    let metadata: Record<string, unknown>
    try {
      metadata = requireRecord(parseJson(bodyText), 'Drive folder metadata')
    } catch {
      return false
    }
    if (metadata.mimeType !== DRIVE_FOLDER_MIME_TYPE) return false
    if (Array.isArray(metadata.parents) && metadata.parents.length > 0)
      return false
    return typeof metadata.name === 'string' && metadata.name.trim()
      ? metadata.name.trim()
      : DEFAULT_VAULT_FOLDER_NAME
  }

  function requestedEmail(bodyText: string): string {
    try {
      const permission = requireRecord(
        parseJson(bodyText),
        'Drive permission metadata',
      )
      return typeof permission.emailAddress === 'string'
        ? permission.emailAddress.trim()
        : ''
    } catch {
      return ''
    }
  }

  async function handlePermissions(
    request: DriveFolderRequest,
    folderId: string,
    permissionId: string,
  ): Promise<void> {
    const { route, method, accountEmail } = request
    const folder = folderFor(folderId, accountEmail)
    if (!canWrite(folder, accountEmail)) {
      await notFound(route)
      return
    }
    if (method === 'GET' && !permissionId) {
      await fulfillJson(route, 200, { permissions: folder.permissions })
      return
    }
    if (method === 'POST' && !permissionId) {
      if (request.permissionStatus < 200 || request.permissionStatus >= 300) {
        await fulfillJson(route, request.permissionStatus, {
          error: { message: 'permission failed' },
        })
        return
      }
      const emailAddress = requestedEmail(request.bodyText)
      if (!emailAddress) {
        await fulfillJson(route, 400, {
          error: { message: 'Permission email is required' },
        })
        return
      }
      const existing = folder.permissions.find((permission) =>
        sameAccount(permission.emailAddress, emailAddress),
      )
      if (existing) {
        await fulfillJson(route, 200, existing)
        return
      }
      permissionSequence += 1
      const added: DriveFolderPermission = {
        id: `${idPrefix}-perm-${permissionSequence}`,
        type: 'user',
        role: DriveFolderRole.Writer,
        emailAddress,
      }
      folder.permissions = [...folder.permissions, added]
      await fulfillJson(route, 200, added)
      return
    }
    if (method === 'DELETE' && permissionId) {
      const removed = folder.permissions.find(
        (permission) => permission.id === permissionId,
      )
      if (!removed) {
        await notFound(route)
        return
      }
      if (removed.role === DriveFolderRole.Owner) {
        await fulfillJson(route, 403, {
          error: { message: 'The owner permission cannot be removed' },
        })
        return
      }
      folder.permissions = folder.permissions.filter(
        (permission) => permission.id !== permissionId,
      )
      await route.fulfill({ status: 204, headers: CORS_HEADERS, body: '' })
      return
    }
    await fulfillJson(route, 405, {
      error: { message: 'Unsupported Drive permission route in e2e stub' },
    })
  }

  return {
    /** Vault folders the stub knows, created or seeded. */
    list: (): DriveVaultFolder[] => [...folders.values()],
    /** Emails with write access to one folder, owner first. */
    writers: (folderId: string): string[] =>
      ((v) => (v ? v.permissions : []))(folders.get(folderId)).map(
        (permission) => permission.emailAddress,
      ),
    /**
     * Serve vault-folder creation, folder metadata, and permission routes.
     * Returns false when the request is not one of them.
     */
    async handle(request: DriveFolderRequest): Promise<boolean> {
      const { route, url, fullUrl, method, accountEmail } = request
      if (url === DRIVE_FILES_URL && method === 'POST') {
        const name = folderCreation(request.bodyText)
        if (name === false) return false
        folderSequence += 1
        const folder: DriveVaultFolder = {
          id: `${idPrefix}-folder-${folderSequence}`,
          name,
          permissions: [ownerPermission(accountEmail)],
        }
        folders.set(folder.id, folder)
        await fulfillJson(route, 200, { id: folder.id, name: folder.name })
        return true
      }
      const permissions = url.match(PERMISSIONS_URL_PATTERN)
      if (permissions?.[1]) {
        await handlePermissions(
          request,
          decodeURIComponent(permissions[1]),
          decodeURIComponent(((v) => (v ? v : ''))(permissions[2])),
        )
        return true
      }
      const folderMatch = url.match(FOLDER_URL_PATTERN)
      const folder =
        folderMatch?.[1] && !fullUrl.includes('alt=media')
          ? folders.get(decodeURIComponent(folderMatch[1]))
          : false
      if (folder && method === 'GET') {
        if (!canWrite(folder, accountEmail)) {
          await notFound(route)
          return true
        }
        await fulfillJson(route, 200, {
          id: folder.id,
          name: folder.name,
          mimeType: DRIVE_FOLDER_MIME_TYPE,
          capabilities: { canAddChildren: true },
        })
        return true
      }
      return false
    },
  }
}
