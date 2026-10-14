import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'
import {
  EVENT_DIGEST_PATTERN,
  fulfillEventMetadata,
  parseEventMultipart,
  EventMultipartParseKind,
} from './event-log-stub'
import { parseJson, requireRecord } from './helpers/guards'

const DEFAULT_FILE_NAME = 'nook-e2e-file-sync'
const EVENT_LOG_DIR = path.join('nook-log', 'v1', 'events')
const EVENT_FILE_NAME_PATTERN = new RegExp(`^(${EVENT_DIGEST_PATTERN})\\.yaml$`)
const PRIVATE_EVENT_FOLDER_PREFIX = 'nook-events-v2-'
const DRIVE_FOLDER_MIME_TYPE = 'application/vnd.google-apps.folder'

type PrivateFolderResource = {
  id: string
  name: string
  mimeType: string
}

/** Event-log namespace folder (identity log or namespaced vault) below a parent. */
type NamespaceFolderResource = PrivateFolderResource & { parent: string }

const NAMESPACE_FOLDER_PREFIX = 'nook-'
const VAULT_NAMESPACE_FOLDER_PREFIX = 'nook-vault-'
const IDENTITY_NAMESPACE_FOLDER_PREFIX = 'nook-identity-'
const NAMESPACE_LOOKUP_PATTERN =
  /^name = '((?:[^'\\]|\\.)*)' and mimeType = 'application\/vnd\.google-apps\.folder' and '((?:[^'\\]|\\.)*)' in parents and trashed = false$/
const IDENTITY_LISTING_PATTERN =
  /^name contains 'nook-identity-' and mimeType = 'application\/vnd\.google-apps\.folder' and '((?:[^'\\]|\\.)*)' in parents and trashed = false$/
const EVENT_PARENT_PATTERN = /'((?:[^'\\]|\\.)*)' in parents/
const MULTIPART_PARENT_PATTERN = /"parents"\s*:\s*\[\s*"([^"]+)"/

function unescapeDriveQueryValue(value: string): string {
  return value.replace(/\\(.)/g, '$1')
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

function toPosixPath(value: string) {
  return value.split(path.sep).join('/')
}

enum EventFileIdParseKind {
  NotEvent = 'not-event',
  Event = 'event',
}

type EventFileIdParse =
  | { kind: EventFileIdParseKind.NotEvent }
  | { kind: EventFileIdParseKind.Event; digest: string }

enum EventFileReadKind {
  Missing = 'missing',
  Found = 'found',
}

type EventFileRead =
  | { kind: EventFileReadKind.Missing }
  | { kind: EventFileReadKind.Found; content: string }

/** File-backed e2e sync remote. The browser still uses the OAuth-file code path;
 * Playwright serves those provider calls from a real temp directory.
 */
export function createLocalE2eFileSyncVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
  rootDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nook-e2e-file-sync-')),
) {
  let vaultYaml = initialYaml
  let vaultFileExists = initialYaml.trim().length > 0
  let fileId = `e2e-file-vault-${fileName.replace(/\W/g, '-')}`
  let md5Checksum = 'e2e-file-stub-md5'
  let privateFolders: PrivateFolderResource[] = []
  let privateFolderCreateCount = 0
  let namespaceFolders: NamespaceFolderResource[] = []
  const offlinePages = new WeakSet<Page>()

  function eventsDir() {
    return path.join(rootDir, EVENT_LOG_DIR)
  }

  function namespaceDir(folderId: string) {
    return path.join(eventsDir(), 'namespaces', folderId)
  }

  function namespaceFolder(folderId: string) {
    return namespaceFolders.find((folder) => folder.id === folderId)
  }

  /** The directory that stores the events of one Drive event parent. */
  function eventDirFor(parentId: string) {
    return namespaceFolder(parentId) ? namespaceDir(parentId) : eventsDir()
  }

  /** Legacy root plus namespaced vault folders; identity logs stay apart. */
  function vaultEventDirs() {
    return [
      eventsDir(),
      ...namespaceFolders
        .filter((folder) =>
          folder.name.startsWith(VAULT_NAMESPACE_FOLDER_PREFIX),
        )
        .map((folder) => namespaceDir(folder.id)),
    ]
  }

  function allEventDirs() {
    return [
      eventsDir(),
      ...namespaceFolders.map((folder) => namespaceDir(folder.id)),
    ]
  }

  function eventPath(digest: string, dir = eventsDir()) {
    return path.join(dir, `${digest}.yaml`)
  }

  function eventFileId(digest: string) {
    return `e2e-file-event-${digest}`
  }

  function parseEventFileId(id: string): EventFileIdParse {
    return id.startsWith('e2e-file-event-')
      ? {
          kind: EventFileIdParseKind.Event,
          digest: id.slice('e2e-file-event-'.length),
        }
      : { kind: EventFileIdParseKind.NotEvent }
  }

  function eventDigests(dir = eventsDir()) {
    fs.mkdirSync(dir, { recursive: true })
    return fs
      .readdirSync(dir)
      .filter((name) => EVENT_FILE_NAME_PATTERN.test(name))
      .map((name) => name.slice(0, -'.yaml'.length))
      .sort()
  }

  function vaultEventDigests() {
    return vaultEventDirs().flatMap((dir) => eventDigests(dir))
  }

  function readEvent(digest: string): EventFileRead {
    for (const dir of allEventDirs()) {
      const file = eventPath(digest, dir)
      if (fs.existsSync(file)) {
        return {
          kind: EventFileReadKind.Found,
          content: fs.readFileSync(file, 'utf8'),
        }
      }
    }
    return { kind: EventFileReadKind.Missing }
  }

  function writeEvent(digest: string, content: string, dir = eventsDir()) {
    fs.mkdirSync(dir, { recursive: true })
    const file = eventPath(digest, dir)
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8')
      return existing === content
    }
    fs.writeFileSync(file, content, 'utf8')
    return true
  }

  function eventListEntries(digest?: string, dir = eventsDir()) {
    const entries: Array<{
      id: string
      name: string
      md5Checksum: string
      appProperties: { event_id: string }
    }> = []
    for (const key of eventDigests(dir)) {
      if (digest && key !== digest) continue
      entries.push({
        id: eventFileId(key),
        name: `${key}.yaml`,
        md5Checksum: `e2e-file-event-md5-${key}`,
        // Match Drive list filtering: digest filenames without appProperties are ignored.
        appProperties: { event_id: `sha256u:${key}` },
      })
    }
    return entries
  }

  return {
    getRootDir: () => rootDir,
    getVaultYaml: () => vaultYaml,
    setVaultYaml: (yaml: string) => {
      vaultYaml = yaml
      vaultFileExists = true
      if (!fileId) {
        fileId = `e2e-file-vault-${fileName.replace(/\W/g, '-')}`
      }
    },
    getEventFileCount: () => vaultEventDigests().length,
    getIdentityEventFileCount: () =>
      namespaceFolders
        .filter((folder) =>
          folder.name.startsWith(IDENTITY_NAMESPACE_FOLDER_PREFIX),
        )
        .flatMap((folder) => eventDigests(namespaceDir(folder.id))).length,
    getPrivateFolderIds: () => privateFolders.map(({ id }) => id),
    getPrivateFolderCreateCount: () => privateFolderCreateCount,
    getEventFilePaths: () =>
      vaultEventDigests().map((digest) =>
        toPosixPath(path.join(EVENT_LOG_DIR, `${digest}.yaml`)),
      ),
    getEventFileContents: () =>
      vaultEventDigests()
        .map((digest) => readEvent(digest))
        .flatMap((event) =>
          event.kind === EventFileReadKind.Found ? [event.content] : [],
        ),
    clearEventFiles: () => {
      for (const dir of allEventDirs()) {
        if (!fs.existsSync(dir)) continue
        for (const name of fs.readdirSync(dir)) {
          if (EVENT_FILE_NAME_PATTERN.test(path.basename(name))) {
            fs.unlinkSync(path.join(dir, name))
          }
        }
      }
    },
    partitionPage: (page: Page) => {
      offlinePages.add(page)
    },
    healPage: (page: Page) => {
      offlinePages.delete(page)
    },
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: { vaultYaml?: string; fileName?: string; accessToken?: string },
    ) {
      if (opts?.fileName) {
        fileName = opts.fileName
      }
      if (typeof opts?.vaultYaml === 'string') {
        vaultYaml = opts.vaultYaml
        vaultFileExists = true
        if (!fileId) {
          fileId = `e2e-file-vault-${fileName.replace(/\W/g, '-')}`
        }
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

        if (offlinePages.has(page)) {
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: JSON.stringify({ error: 'e2e file provider partitioned' }),
          })
          return
        }

        const [url = ''] = [request.url().split('?')[0]]
        const fullUrl = request.url()

        if (url === 'https://www.googleapis.com/drive/v3/about') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              user: { emailAddress: 'file-sync-e2e@example.com' },
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
              .filter((folder) => folder.name === expectedName)
              .map(({ id, name, mimeType }) => ({ id, name, mimeType }))
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify({ files }),
            })
            return
          }
          const [query = ''] = new URL(fullUrl).searchParams.getAll('q')
          const namespaceLookup = query.match(NAMESPACE_LOOKUP_PATTERN)
          const identityListing = query.match(IDENTITY_LISTING_PATTERN)
          if (namespaceLookup || identityListing) {
            const [, rawName = '', rawParent = ''] = namespaceLookup
              ? namespaceLookup
              : ['', '', ((v) => (v ? v : ''))(identityListing?.[1])]
            const name = unescapeDriveQueryValue(rawName)
            const parent = unescapeDriveQueryValue(rawParent)
            const files = namespaceFolders
              .filter(
                (folder) =>
                  folder.parent === parent &&
                  (namespaceLookup
                    ? folder.name === name
                    : folder.name.startsWith(IDENTITY_NAMESPACE_FOLDER_PREFIX)),
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
          const eventParent = unescapeDriveQueryValue(
            ((v) => (v ? v : ''))(query.match(EVENT_PARENT_PATTERN)?.[1]),
          )
          const eventDigest = decoded.match(
            new RegExp(`name\\s*=\\s*'(${EVENT_DIGEST_PATTERN})\\.yaml'`),
          )?.[1]
          if (
            eventDigest ||
            (decoded.includes("name contains '.yaml'") &&
              decoded.includes('in parents'))
          ) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                files: eventListEntries(eventDigest, eventDirFor(eventParent)),
              }),
            })
            return
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              files: vaultFileExists ? [{ id: fileId, md5Checksum }] : [],
            }),
          })
          return
        }

        if (
          url === 'https://www.googleapis.com/drive/v3/files' &&
          method === 'POST'
        ) {
          const bodyText = ((v) => (v ? v : ''))(request.postData())
          let metadata: Record<string, unknown> = {}
          try {
            metadata = requireRecord(
              parseJson(bodyText),
              'Drive folder metadata',
            )
          } catch {
            // The initialized empty metadata remains valid when the body is malformed.
          }
          const folderName =
            typeof metadata.name === 'string' ? metadata.name : ''
          const [folderParent = ''] = Array.isArray(metadata.parents)
            ? metadata.parents.flatMap((parent) =>
                typeof parent === 'string' ? [parent] : [],
              )
            : []
          if (
            metadata.mimeType === DRIVE_FOLDER_MIME_TYPE &&
            folderName.startsWith(NAMESPACE_FOLDER_PREFIX) &&
            !folderName.startsWith(PRIVATE_EVENT_FOLDER_PREFIX) &&
            folderParent.length > 0
          ) {
            const folder: NamespaceFolderResource = {
              id: `e2e-file-namespace-${Buffer.from(`${folderParent}/${folderName}`).toString('base64url')}`,
              name: folderName,
              mimeType: DRIVE_FOLDER_MIME_TYPE,
              parent: folderParent,
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
          if (
            metadata.mimeType === DRIVE_FOLDER_MIME_TYPE &&
            privateFolderHasAppDataParent(metadata.parents) &&
            folderName.length > 0
          ) {
            privateFolderCreateCount += 1
            const folder: PrivateFolderResource = {
              id: `e2e-file-private-folder-${Buffer.from(folderName).toString('base64url')}`,
              name: folderName,
              mimeType: DRIVE_FOLDER_MIME_TYPE,
            }
            privateFolders = privateFolders
              .filter((existing) => existing.name !== folderName)
              .concat(folder)
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              headers: { 'access-control-allow-origin': '*' },
              body: JSON.stringify(folder),
            })
            return
          }
        }

        const driveFileMatch = url.match(
          /^https:\/\/www\.googleapis\.com\/drive\/v3\/files\/([^/]+)$/,
        )
        const driveFileId = driveFileMatch?.[1]

        if (driveFileId && fullUrl.includes('alt=media')) {
          const eventFile = parseEventFileId(driveFileId)
          if (eventFile.kind === EventFileIdParseKind.Event) {
            const event = readEvent(eventFile.digest)
            if (event.kind === EventFileReadKind.Missing) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/x-yaml',
              body: event.content,
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
          if (eventFile.kind === EventFileIdParseKind.Event) {
            if (
              readEvent(eventFile.digest).kind === EventFileReadKind.Missing
            ) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await fulfillEventMetadata(
              route,
              driveFileId,
              eventFile.digest,
              'e2e-file-event-md5-',
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
          const multipart = ((v) => (v ? v : ''))(request.postData())
          const event = parseEventMultipart(multipart)
          if (event.kind === EventMultipartParseKind.Valid) {
            const writeParent = ((v) => (v ? v : ''))(
              multipart.match(MULTIPART_PARENT_PATTERN)?.[1],
            )
            if (
              !writeEvent(event.digest, event.content, eventDirFor(writeParent))
            ) {
              await route.fulfill({ status: 409, body: '{}' })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({ id: eventFileId(event.digest) }),
            })
            return
          }
          vaultFileExists = true
          fileId = `e2e-file-vault-${Date.now()}`
          md5Checksum = `e2e-file-stub-md5-${Date.now()}`
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
          const body = ((v) => (v ? v : ''))(request.postData())
          const patchId = url.slice(
            'https://www.googleapis.com/upload/drive/v3/files/'.length,
          )
          if (patchId) {
            fileId = patchId
          }
          vaultFileExists = true
          if (body) {
            vaultYaml = body
            md5Checksum = `e2e-file-stub-md5-${Date.now()}`
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
                message: 'Unsupported Google Drive route in e2e file stub',
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
