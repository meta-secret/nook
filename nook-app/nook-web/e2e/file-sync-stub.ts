import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { Page } from '@playwright/test'

const DEFAULT_FILE_NAME = 'nook-e2e-file-sync'
const EVENT_LOG_DIR = path.join('nook-log', 'v1', 'events')
const EVENT_DIGEST_PATTERN = '[A-Za-z0-9_-]{43}'
const EVENT_FILE_NAME_PATTERN = new RegExp(`^(${EVENT_DIGEST_PATTERN})\\.yaml$`)

function toPosixPath(value: string) {
  return value.split(path.sep).join('/')
}

function sha256FileNameFromPath(filePath: string) {
  const name = path.basename(filePath)
  return EVENT_FILE_NAME_PATTERN.test(name) ? name : undefined
}

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

  function eventDigestFromFileId(id: string) {
    return id.startsWith('e2e-file-event-')
      ? id.slice('e2e-file-event-'.length)
      : undefined
  }

  function eventDigests() {
    ensureEventsDir()
    return fs
      .readdirSync(eventsDir())
      .filter((name) => EVENT_FILE_NAME_PATTERN.test(name))
      .map((name) => name.slice(0, -'.yaml'.length))
      .sort()
  }

  function readEvent(digest: string) {
    const file = eventPath(digest)
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : undefined
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
    const entries: Array<{ id: string; name: string; md5Checksum: string }> = []
    for (const key of eventDigests()) {
      if (digest && key !== digest) continue
      entries.push({
        id: eventFileId(key),
        name: `${key}.yaml`,
        md5Checksum: `e2e-file-event-md5-${key}`,
      })
    }
    return entries
  }

  function parseEventMultipart(
    body: string,
  ): { digest: string; content: string } | undefined {
    const eventId = body.match(
      new RegExp(`"event_id"\\s*:\\s*"sha256u:(${EVENT_DIGEST_PATTERN})"`),
    )?.[1]
    const nameDigest = body.match(
      new RegExp(`"name"\\s*:\\s*"(${EVENT_DIGEST_PATTERN})\\.yaml"`),
    )?.[1]
    const digest = eventId ?? nameDigest
    if (!digest) return undefined
    const markers = [
      '\r\nContent-Type: application/x-yaml\r\n\r\n',
      '\r\nContent-Type: application/json\r\n\r\n',
    ]
    const marker = markers.find((candidate) => body.includes(candidate))
    if (!marker) return undefined
    const start = body.indexOf(marker)
    if (start === -1) return undefined
    const contentStart = start + marker.length
    const end = body.indexOf('\r\n--nook_event_boundary--', contentStart)
    const content =
      end === -1 ? body.slice(contentStart) : body.slice(contentStart, end)
    return { digest, content }
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
        .filter((content): content is string => content !== undefined),
    clearEventFiles: () => {
      if (!fs.existsSync(eventsDir())) return
      for (const name of fs.readdirSync(eventsDir())) {
        if (sha256FileNameFromPath(name)) {
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
      if (opts?.vaultYaml !== undefined) {
        vaultYaml = opts.vaultYaml
        vaultFileExists = true
        if (!fileId) {
          fileId = `e2e-file-vault-${fileName.replace(/\W/g, '-')}`
        }
      }
      const accessToken = opts?.accessToken

      await page.route('https://www.googleapis.com/**', async (route) => {
        if (accessToken) {
          const authorization = route.request().headers().authorization ?? ''
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
              decoded.includes("'appDataFolder' in parents"))
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
          const eventDigest = eventDigestFromFileId(driveFileId)
          if (eventDigest) {
            const content = readEvent(eventDigest)
            if (content === undefined) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/x-yaml',
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
          const eventDigest = eventDigestFromFileId(driveFileId)
          if (eventDigest) {
            if (readEvent(eventDigest) === undefined) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                id: driveFileId,
                name: `${eventDigest}.yaml`,
                md5Checksum: `e2e-file-event-md5-${eventDigest}`,
              }),
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
            contentType: 'application/json',
            body: JSON.stringify({ id: fileId, md5Checksum }),
          })
          return
        }

        if (
          url === 'https://www.googleapis.com/upload/drive/v3/files' &&
          method === 'POST'
        ) {
          const event = parseEventMultipart(request.postData() ?? '')
          if (event) {
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
          const body = request.postData() ?? ''
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
