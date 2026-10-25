import type { Page } from '@playwright/test'
import {
  EVENT_DIGEST_PATTERN,
  fulfillEventMetadata,
  parseEventMultipart as parseMultipartEvent,
  EventMultipartParseKind,
} from './event-log-stub'
import {
  createDriveVaultFolders,
  DRIVE_FOLDER_MIME_TYPE,
} from './drive-folder-stub'
import {
  E2E_GOOGLE_ACCOUNT_EMAIL,
  installGoogleIdentityTokenMock,
} from './google-identity-stub'
import { parseJson, requireRecord } from './helpers/guards'

const DEFAULT_FILE_NAME = 'nook-events'

type NamespaceFolderResource = {
  id: string
  name: string
  mimeType: string
  parents: string[]
}

const NAMESPACE_FOLDER_PREFIX = 'nook-'
const VAULT_NAMESPACE_FOLDER_PREFIX = 'nook-vault-'
const IDENTITY_NAMESPACE_FOLDER_PREFIX = 'nook-identity-'
const NAMESPACE_LOOKUP_PATTERN =
  /^name = '((?:[^'\\]|\\.)*)' and mimeType = 'application\/vnd\.google-apps\.folder' and '((?:[^'\\]|\\.)*)' in parents and trashed = false$/
/** Listing every identity log or vault folder below one event parent. */
const NAMESPACE_LISTING_PATTERN =
  /^name contains '(nook-identity-|nook-vault-)' and mimeType = 'application\/vnd\.google-apps\.folder' and '((?:[^'\\]|\\.)*)' in parents and trashed = false$/

function unescapeDriveQueryValue(value: string): string {
  return value.replace(/\\(.)/g, '$1')
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

/** In-memory Google Drive stub (Drive v3 REST): vault folders, their
 * permissions, event-log namespace folders, and event files. */
export function createLocalE2eGoogleDriveVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
) {
  let vaultYaml = initialYaml
  let vaultFileExists = initialYaml.trim().length > 0
  let fileId = `e2e-drive-file-${fileName.replace(/\W/g, '-')}`
  let md5Checksum = 'e2e-stub-md5'
  /** parentId → digest → yaml content. */
  const eventFilesByParent = new Map<string, Map<string, string>>()
  const vaultFolders = createDriveVaultFolders('e2e-drive')
  let namespaceFolders: NamespaceFolderResource[] = []

  function eventFilesFor(parentId: string) {
    let map = eventFilesByParent.get(parentId)
    if (!map) {
      map = new Map()
      eventFilesByParent.set(parentId, map)
    }
    return map
  }

  function identityFolderIds() {
    return new Set(
      namespaceFolders
        .filter((folder) =>
          folder.name.startsWith(IDENTITY_NAMESPACE_FOLDER_PREFIX),
        )
        .map((folder) => folder.id),
    )
  }

  /** Vault events in every parent; identity control logs stay apart. */
  function vaultEventFiles() {
    const identityFolders = identityFolderIds()
    const merged = new Map<string, string>()
    for (const [parentId, map] of eventFilesByParent) {
      if (identityFolders.has(parentId)) continue
      for (const [digest, content] of map) {
        merged.set(digest, content)
      }
    }
    return merged
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
    return ((v) => (v ? v : ''))(decoded.match(/'([^']+)' in parents/)?.[1])
  }

  function parseParentsFromBody(body: string): string {
    return ((v) => (v ? v : ''))(
      body.match(/"parents"\s*:\s*\[\s*"([^"]+)"/)?.[1],
    )
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
    getEventFileCount: () => vaultEventFiles().size,
    getIdentityEventFileCount: () =>
      allEventFiles().size - vaultEventFiles().size,
    /** Events stored directly in one event parent, outside its vault folders. */
    getEventFileCountDirectlyIn: (parentId: string) =>
      eventFilesFor(parentId).size,
    /** Vault events stored below one event parent: in it, or in the vault
     * folders it holds. */
    getEventFileCountForParent: (parentId: string) =>
      [
        parentId,
        ...namespaceFolders
          .filter(
            (folder) =>
              folder.parents.includes(parentId) &&
              folder.name.startsWith(VAULT_NAMESPACE_FOLDER_PREFIX),
          )
          .map((folder) => folder.id),
      ].reduce((count, id) => count + eventFilesFor(id).size, 0),
    getEventFileContents: () => [...vaultEventFiles().values()],
    clearEventFiles: () => {
      eventFilesByParent.clear()
    },
    /** Vault folders on the stub with the emails that can write to them. */
    getSharedFolders: () =>
      vaultFolders.list().map((folder) => ({
        id: folder.id,
        name: folder.name,
        writers: vaultFolders.writers(folder.id),
      })),
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: {
        vaultYaml?: string
        fileName?: string
        accessToken?: string
        /** The Google account this page is signed in as. */
        accountEmail?: string
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
      const [accountEmail = E2E_GOOGLE_ACCOUNT_EMAIL] = [opts?.accountEmail]
      const [permissionStatus = 200] = [opts?.sharedPermissionStatus]
      if (accessToken) {
        await installGoogleIdentityTokenMock(page, accessToken)
      }

      await page.route('https://www.googleapis.com/**', async (route) => {
        const request = route.request()
        const method = request.method()
        if (method === 'OPTIONS' && accessToken) {
          await route.fulfill({
            status: 204,
            headers: {
              'access-control-allow-origin': '*',
              'access-control-allow-methods':
                'GET, POST, PATCH, DELETE, OPTIONS',
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
              user: { emailAddress: accountEmail },
            }),
          })
          return
        }

        const folderRequest: Parameters<typeof vaultFolders.handle>[0] = {
          route,
          url,
          fullUrl,
          method,
          bodyText,
          accountEmail,
          permissionStatus,
        }
        if (await vaultFolders.handle(folderRequest)) return

        // Event-log namespace folders below a vault folder.
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
          const folderName = typeof parsed.name === 'string' ? parsed.name : ''
          const [folderParent = ''] = Array.isArray(parsed.parents)
            ? parsed.parents.flatMap((parent) =>
                typeof parent === 'string' ? [parent] : [],
              )
            : []
          if (
            parsed.mimeType === DRIVE_FOLDER_MIME_TYPE &&
            folderName.startsWith(NAMESPACE_FOLDER_PREFIX) &&
            folderParent.length > 0
          ) {
            const folder: NamespaceFolderResource = {
              id: `e2e-drive-namespace-${Buffer.from(`${folderParent}/${folderName}`).toString('base64url')}`,
              name: folderName,
              mimeType: DRIVE_FOLDER_MIME_TYPE,
              parents: [folderParent],
            }
            namespaceFolders = namespaceFolders
              .filter((existing) => existing.id !== folder.id)
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
        }

        if (
          url === 'https://www.googleapis.com/drive/v3/files' &&
          method === 'GET'
        ) {
          const [query = ''] = new URL(fullUrl).searchParams.getAll('q')
          const namespaceLookup = query.match(NAMESPACE_LOOKUP_PATTERN)
          const namespaceListing = query.match(NAMESPACE_LISTING_PATTERN)
          if (namespaceLookup || namespaceListing) {
            const [, rawName = '', rawParent = ''] = namespaceLookup
              ? namespaceLookup
              : ['', '', ((v) => (v ? v : ''))(namespaceListing?.[2])]
            const listedPrefix = ((v) => (v ? v : ''))(namespaceListing?.[1])
            const name = unescapeDriveQueryValue(rawName)
            const parent = unescapeDriveQueryValue(rawParent)
            const files = namespaceFolders
              .filter(
                (folder) =>
                  folder.parents.includes(parent) &&
                  (namespaceLookup
                    ? folder.name === name
                    : folder.name.startsWith(listedPrefix)),
              )
              .map(({ id, name: folderName, mimeType }) => ({
                id,
                name: folderName,
                mimeType,
              }))
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
