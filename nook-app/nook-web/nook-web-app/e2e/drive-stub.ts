import type { Page } from '@playwright/test'
import {
  EVENT_DIGEST_PATTERN,
  fulfillEventMetadata,
  parseEventMultipart as parseMultipartEvent,
  EventMultipartParseKind,
} from './event-log-stub'
import { parseJson, requireRecord } from './helpers/guards'

const DEFAULT_FILE_NAME = 'nook-events'
const PRIVATE_EVENT_FOLDER_PREFIX = 'nook-events-v2-'
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

type PrivateFolderResource = {
  id: string
  name: string
  mimeType: string
  parents: string[]
}

function isPrivateFolderLookup(requestUrl: string, fileName: string): boolean {
  const expectedName = `${PRIVATE_EVENT_FOLDER_PREFIX}${fileName}`
  const escapedName = expectedName.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const expectedQuery = `name = '${escapedName}' and mimeType = '${DRIVE_FOLDER_MIME_TYPE}' and 'appDataFolder' in parents and trashed = false`
  const search = new URL(requestUrl).searchParams
  const queryValues = search.getAll('q')
  const spaces = search.getAll('spaces')
  return (
    queryValues.length === 1 &&
    queryValues[0] === expectedQuery &&
    spaces.length === 1 &&
    spaces[0] === 'appDataFolder'
  )
}

function privateFolderHasAppDataParent(value: unknown): boolean {
  return (
    Array.isArray(value) && value.length === 1 && value[0] === 'appDataFolder'
  )
}

enum DriveEventFileIdParseKind {
  NotEvent = 'not-event',
  Event = 'event',
}

type DriveEventFileIdParse =
  | { kind: DriveEventFileIdParseKind.NotEvent }
  | { kind: DriveEventFileIdParseKind.Event; digest: string }

enum DriveEventUploadParseKind {
  Invalid = 'invalid',
  Valid = 'valid',
}

type DriveEventUploadParse =
  | { kind: DriveEventUploadParseKind.Invalid }
  | {
      kind: DriveEventUploadParseKind.Valid
      digest: string
      content: string
      parentId: string
    }

/** In-memory Google Drive stub (Drive v3 REST) for appDataFolder + shared folders. */
export function createLocalE2eGoogleDriveVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
) {
  let vaultYaml = initialYaml
  let vaultFileExists = initialYaml.trim().length > 0
  let fileId = `e2e-drive-file-${fileName.replace(/\W/g, '-')}`
  let md5Checksum = 'e2e-stub-md5'
  /** parentId → digest → yaml content. `appDataFolder` is the personal root. */
  const eventFilesByParent = new Map<string, Map<string, string>>()
  const sharedFolders = new Map<string, { name: string; writers: string[] }>()
  let privateFolders: PrivateFolderResource[] = []
  let sharedFolderSeq = 0

  function eventFilesFor(parentId: string) {
    let map = eventFilesByParent.get(parentId)
    if (!map) {
      map = new Map()
      eventFilesByParent.set(parentId, map)
    }
    return map
  }

  function allEventFiles() {
    const merged = new Map<string, string>()
    for (const map of eventFilesByParent.values()) {
      for (const [digest, content] of map) {
        merged.set(digest, content)
      }
    }
    return merged
  }

  function parentFromQuery(decoded: string): string {
    const shared = decoded.match(/'([^']+)' in parents/)
    if (shared?.[1] && shared[1] !== 'appDataFolder') {
      return shared[1]
    }
    return 'appDataFolder'
  }

  function parseParentsFromBody(body: string): string {
    const match = body.match(/"parents"\s*:\s*\[\s*"([^"]+)"/)
    return ((...[v = 'appDataFolder']) => v)(match?.[1])
  }

  function eventFileId(digest: string) {
    return `e2e-drive-event-${digest}`
  }

  function parseEventFileId(id: string): DriveEventFileIdParse {
    return id.startsWith('e2e-drive-event-')
      ? {
          kind: DriveEventFileIdParseKind.Event,
          digest: id.slice('e2e-drive-event-'.length),
        }
      : { kind: DriveEventFileIdParseKind.NotEvent }
  }

  function eventListEntries(parentId: string, digest?: string) {
    const entries: Array<{
      id: string
      name: string
      md5Checksum: string
      appProperties: { event_id: string }
    }> = []
    for (const key of eventFilesFor(parentId).keys()) {
      if (digest && key !== digest) continue
      entries.push({
        id: eventFileId(key),
        name: `${key}.yaml`,
        md5Checksum: `e2e-event-md5-${key}`,
        appProperties: { event_id: `sha256u:${key}` },
      })
    }
    return entries
  }

  function parseEventMultipart(body: string): DriveEventUploadParse {
    const event = parseMultipartEvent(body)
    return event.kind === EventMultipartParseKind.Valid
      ? {
          kind: DriveEventUploadParseKind.Valid,
          digest: event.digest,
          content: event.content,
          parentId: parseParentsFromBody(body),
        }
      : { kind: DriveEventUploadParseKind.Invalid }
  }

  return {
    getVaultYaml: () => vaultYaml,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
      vaultFileExists = true
      if (!fileId) {
        fileId = `e2e-drive-file-${fileName.replace(/\W/g, '-')}`
      }
    },
    getEventFileCount: () => allEventFiles().size,
    getEventFileCountForParent: (parentId: string) =>
      eventFilesFor(parentId).size,
    getEventFileContents: () => [...allEventFiles().values()],
    clearEventFiles: () => {
      eventFilesByParent.clear()
    },
    getSharedFolders: () =>
      [...sharedFolders.entries()].map(([id, value]) => ({ id, ...value })),
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: {
        vaultYaml?: string
        fileName?: string
        accessToken?: string
        sharedPermissionStatus?: number
      },
    ) {
      if (typeof opts?.vaultYaml === 'string') {
        vaultYaml = opts.vaultYaml
        vaultFileExists = true
        if (!fileId) {
          fileId = `e2e-drive-file-${fileName.replace(/\W/g, '-')}`
        }
      }
      if (opts?.fileName) {
        fileName = opts.fileName
      }
      const accessToken = opts?.accessToken

      await page.route('https://www.googleapis.com/**', async (route) => {
        const request = route.request()
        const method = request.method()
        if (method === 'OPTIONS' && accessToken) {
          await route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS',
              'access-control-allow-headers': 'Authorization, Content-Type',
            },
          })
          return
        }
        if (accessToken) {
          const authorization = ((v) => (v ? v : ''))(
            request.headers().authorization,
          )
          if (authorization !== `Bearer ${accessToken}`) {
            await route.fallback()
            return
          }
        }

        const [url = ''] = [request.url().split('?')[0]]
        const fullUrl = request.url()
        const bodyText = ((v) => (v ? v : ''))(request.postData())

        if (url === 'https://www.googleapis.com/drive/v3/about') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              user: { emailAddress: 'e2e-user@example.com' },
            }),
          })
          return
        }

        // Folder metadata POSTs cover private appData targets and shared folders.
        if (
          url === 'https://www.googleapis.com/drive/v3/files' &&
          method === 'POST'
        ) {
          let parsed: Record<string, unknown>
          try {
            parsed = requireRecord(parseJson(bodyText), 'Drive file metadata')
          } catch {
            parsed = {}
          }
          if (parsed.mimeType === DRIVE_FOLDER_MIME_TYPE) {
            const folderName =
              typeof parsed.name === 'string' ? parsed.name : ''
            if (
              privateFolderHasAppDataParent(parsed.parents) &&
              folderName.length > 0
            ) {
              const folder: PrivateFolderResource = {
                id: `e2e-drive-private-folder-${Buffer.from(folderName).toString('base64url')}`,
                name: folderName,
                mimeType: DRIVE_FOLDER_MIME_TYPE,
                parents: ['appDataFolder'],
              }
              privateFolders = privateFolders
                .filter((existing) => existing.name !== folderName)
                .concat(folder)
              await route.fulfill({
                status: 200,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                  id: folder.id,
                  name: folder.name,
                  mimeType: folder.mimeType,
                }),
              })
              return
            }
            if (privateFolderHasAppDataParent(parsed.parents)) {
              await route.fulfill({
                status: 400,
                contentType: 'application/json',
                headers: { 'access-control-allow-origin': '*' },
                body: JSON.stringify({
                  error: { message: 'Invalid e2e Drive folder metadata' },
                }),
              })
              return
            }
            sharedFolderSeq += 1
            const folderId = `e2e-shared-folder-${sharedFolderSeq}`
            const name =
              typeof parsed.name === 'string'
                ? parsed.name.trim() || 'Nook shared vault'
                : 'Nook shared vault'
            sharedFolders.set(folderId, { name, writers: [] })
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ id: folderId, name }),
            })
            return
          }
        }

        // permissions.create for shared folder writer grant
        const permissionsMatch = url.match(
          /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)\/permissions$/,
        )
        if (permissionsMatch && method === 'POST') {
          const encodedFolderId = permissionsMatch[1]
          if (!encodedFolderId) {
            throw new Error('Drive permission folder id is missing.')
          }
          const folderId = decodeURIComponent(encodedFolderId)
          let email: string
          try {
            const parsed = requireRecord(
              parseJson(bodyText),
              'Drive permission metadata',
            )
            email =
              typeof parsed.emailAddress === 'string'
                ? parsed.emailAddress.trim()
                : ''
          } catch {
            email = ''
          }
          if (
            opts?.sharedPermissionStatus &&
            (opts.sharedPermissionStatus < 200 ||
              opts.sharedPermissionStatus >= 300)
          ) {
            await route.fulfill({
              status: opts.sharedPermissionStatus,
              contentType: 'application/json',
              body: JSON.stringify({ error: { message: 'permission failed' } }),
            })
            return
          }
          const folder = sharedFolders.get(folderId)
          if (folder && email) {
            folder.writers.push(email)
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: `e2e-perm-${folderId}`,
              type: 'user',
              role: 'writer',
              emailAddress: email,
            }),
          })
          return
        }

        if (
          url === 'https://www.googleapis.com/drive/v3/files' &&
          method === 'GET'
        ) {
          if (isPrivateFolderLookup(fullUrl, fileName)) {
            const expectedName = `${PRIVATE_EVENT_FOLDER_PREFIX}${fileName}`
            const files = privateFolders
              .filter(
                (folder) =>
                  folder.name === expectedName &&
                  folder.parents.includes('appDataFolder'),
              )
              .map(({ id, name, mimeType }) => ({ id, name, mimeType }))
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({ files }),
            })
            return
          }
          const decoded = decodeURIComponent(fullUrl)
          const eventDigest = decoded.match(
            new RegExp(`name\\s*=\\s*'(${EVENT_DIGEST_PATTERN})\\.yaml'`),
          )?.[1]
          const isEventList =
            Boolean(eventDigest) ||
            (decoded.includes("name contains '.yaml'") &&
              decoded.includes('in parents'))
          if (isEventList) {
            const parentId = parentFromQuery(decoded)
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                files: eventListEntries(parentId, eventDigest),
              }),
            })
            return
          }
          const files = vaultFileExists ? [{ id: fileId, md5Checksum }] : []
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ files }),
          })
          return
        }

        const driveFileMatch = url.match(
          /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)$/,
        )
        const driveFileId = driveFileMatch?.[1]

        if (driveFileId && fullUrl.includes('alt=media')) {
          const eventFile = parseEventFileId(driveFileId)
          if (eventFile.kind === DriveEventFileIdParseKind.Event) {
            const content = allEventFiles().get(eventFile.digest)
            if (!content) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: content,
            })
            return
          }
          if (!vaultFileExists) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          fileId = driveFileId
          await route.fulfill({
            status: 200,
            contentType: 'application/x-yaml',
            body: vaultYaml,
          })
          return
        }

        if (driveFileId && method === 'GET') {
          const sharedFolder = sharedFolders.get(
            decodeURIComponent(driveFileId),
          )
          if (sharedFolder) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                id: decodeURIComponent(driveFileId),
                name: sharedFolder.name,
                mimeType: 'application/vnd.google-apps.folder',
                capabilities: { canAddChildren: true },
              }),
            })
            return
          }
          const eventFile = parseEventFileId(driveFileId)
          if (eventFile.kind === DriveEventFileIdParseKind.Event) {
            if (!allEventFiles().has(eventFile.digest)) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await fulfillEventMetadata(
              route,
              driveFileId,
              eventFile.digest,
              'e2e-event-md5-',
            )
            return
          }
          if (!vaultFileExists) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          fileId = driveFileId
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: fileId, md5Checksum }),
          })
          return
        }

        if (
          url === 'https://www.googleapis.com/upload/drive/v3/files' &&
          method === 'POST'
        ) {
          const event = parseEventMultipart(bodyText)
          if (event.kind === DriveEventUploadParseKind.Valid) {
            eventFilesFor(event.parentId).set(event.digest, event.content)
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ id: eventFileId(event.digest) }),
            })
            return
          }
          vaultFileExists = true
          fileId = `e2e-drive-file-${Date.now()}`
          md5Checksum = `e2e-stub-md5-${Date.now()}`
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: fileId, md5Checksum }),
          })
          return
        }

        if (
          url.startsWith('https://www.googleapis.com/upload/drive/v3/files/') &&
          method === 'PATCH'
        ) {
          const body = bodyText
          const patchId = url.slice(
            'https://www.googleapis.com/upload/drive/v3/files/'.length,
          )
          if (patchId) {
            fileId = patchId
          }
          vaultFileExists = true
          if (body) {
            vaultYaml = body
            md5Checksum = `e2e-stub-md5-${Date.now()}`
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ id: fileId, md5Checksum }),
          })
          return
        }

        if (accessToken) {
          await route.fulfill({
            status: 404,
            contentType: 'application/json',
            headers: { 'access-control-allow-origin': '*' },
            body: JSON.stringify({
              error: {
                message: 'Unsupported Google Drive route in e2e Drive stub',
              },
            }),
          })
          return
        }

        await route.fallback()
      })
    },
  }
}
