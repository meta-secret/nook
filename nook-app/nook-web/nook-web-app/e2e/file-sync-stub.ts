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

const DEFAULT_FILE_NAME = 'nook-e2e-file-sync'
const EVENT_LOG_DIR = path.join('nook-log', 'v1', 'events')
const EVENT_FILE_NAME_PATTERN = new RegExp(`^(${EVENT_DIGEST_PATTERN})\\.yaml$`)

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
  const offlinePages = new WeakSet<Page>()

  function eventsDir() {
    return path.join(rootDir, EVENT_LOG_DIR)
  }

  function ensureEventsDir() {
    fs.mkdirSync(eventsDir(), { recursive: true })
  }

  function eventPath(digest: string) {
    return path.join(eventsDir(), `${digest}.yaml`)
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

  function eventDigests() {
    ensureEventsDir()
    return fs
      .readdirSync(eventsDir())
      .filter((name) => EVENT_FILE_NAME_PATTERN.test(name))
      .map((name) => name.slice(0, -'.yaml'.length))
      .sort()
  }

  function readEvent(digest: string): EventFileRead {
    const file = eventPath(digest)
    return fs.existsSync(file)
      ? {
          kind: EventFileReadKind.Found,
          content: fs.readFileSync(file, 'utf8'),
        }
      : { kind: EventFileReadKind.Missing }
  }

  function writeEvent(digest: string, content: string) {
    ensureEventsDir()
    const file = eventPath(digest)
    if (fs.existsSync(file)) {
      const existing = fs.readFileSync(file, 'utf8')
      return existing === content
    }
    fs.writeFileSync(file, content, 'utf8')
    return true
  }

  function eventListEntries(digest?: string) {
    const entries: Array<{
      id: string
      name: string
      md5Checksum: string
      appProperties: { event_id: string }
    }> = []
    for (const key of eventDigests()) {
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
    getEventFileCount: () => eventDigests().length,
    getEventFilePaths: () =>
      eventDigests().map((digest) =>
        toPosixPath(path.join(EVENT_LOG_DIR, `${digest}.yaml`)),
      ),
    getEventFileContents: () =>
      eventDigests()
        .map((digest) => readEvent(digest))
        .flatMap((event) =>
          event.kind === EventFileReadKind.Found ? [event.content] : [],
        ),
    clearEventFiles: () => {
      if (!fs.existsSync(eventsDir())) return
      for (const name of fs.readdirSync(eventsDir())) {
        if (EVENT_FILE_NAME_PATTERN.test(path.basename(name))) {
          fs.unlinkSync(path.join(eventsDir(), name))
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
      if (opts && 'vaultYaml' in opts) {
        vaultYaml = opts.vaultYaml
        vaultFileExists = true
        if (!fileId) {
          fileId = `e2e-file-vault-${fileName.replace(/\W/g, '-')}`
        }
      }
      const accessToken = opts?.accessToken

      await page.route('https://www.googleapis.com/**', async (route) => {
        if (accessToken) {
          const authorization = ((v) => (v ? v : ''))(
            route.request().headers().authorization,
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

        const request = route.request()
        const url = request.url().split('?')[0]!
        const method = request.method()
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
          const decoded = decodeURIComponent(fullUrl)
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
                files: eventListEntries(eventDigest),
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
          const event = parseEventMultipart(
            ((v) => (v ? v : ''))(request.postData()),
          )
          if (event.kind === EventMultipartParseKind.Valid) {
            if (!writeEvent(event.digest, event.content)) {
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

        await route.fallback()
      })
    },
  }
}
