import type { Page } from '@playwright/test'

const DEFAULT_FILE_NAME = 'nook-events'
const EVENT_DIGEST_PATTERN = '[A-Za-z0-9_-]{43}'

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
    return match?.[1] ?? 'appDataFolder'
  }

  function eventFileId(digest: string) {
    return `e2e-drive-event-${digest}`
  }

  function eventDigestFromFileId(id: string) {
    return id.startsWith('e2e-drive-event-')
      ? id.slice('e2e-drive-event-'.length)
      : undefined
  }

  function eventListEntries(parentId: string, digest?: string) {
    const entries: Array<{ id: string; name: string; md5Checksum: string }> = []
    for (const key of eventFilesFor(parentId).keys()) {
      if (digest && key !== digest) continue
      entries.push({
        id: eventFileId(key),
        name: `${key}.yaml`,
        md5Checksum: `e2e-event-md5-${key}`,
      })
    }
    return entries
  }

  function parseEventMultipart(
    body: string,
  ): { digest: string; content: string; parentId: string } | undefined {
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
    return { digest, content, parentId: parseParentsFromBody(body) }
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
    getEventFileContents: () => [...allEventFiles().values()],
    clearEventFiles: () => {
      eventFilesByParent.clear()
    },
    getSharedFolders: () =>
      [...sharedFolders.entries()].map(([id, value]) => ({ id, ...value })),
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: { vaultYaml?: string; fileName?: string; accessToken?: string },
    ) {
      if (opts?.vaultYaml !== undefined) {
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
        if (accessToken) {
          const authorization = route.request().headers().authorization ?? ''
          if (authorization !== `Bearer ${accessToken}`) {
            await route.fallback()
            return
          }
        }

        const request = route.request()
        const url = request.url().split('?')[0]!
        const method = request.method()
        const fullUrl = request.url()
        const bodyText = request.postData() ?? ''

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

        // Create shared vault folder (metadata-only POST, not upload).
        if (
          url === 'https://www.googleapis.com/drive/v3/files' &&
          method === 'POST'
        ) {
          let parsed: { name?: string; mimeType?: string }
          try {
            parsed = JSON.parse(bodyText) as {
              name?: string
              mimeType?: string
            }
          } catch {
            parsed = {}
          }
          if (parsed.mimeType === 'application/vnd.google-apps.folder') {
            sharedFolderSeq += 1
            const folderId = `e2e-shared-folder-${sharedFolderSeq}`
            const name = parsed.name?.trim() || 'Nook shared vault'
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
          const folderId = decodeURIComponent(permissionsMatch[1]!)
          let email: string
          try {
            const parsed = JSON.parse(bodyText) as { emailAddress?: string }
            email = parsed.emailAddress?.trim() ?? ''
          } catch {
            email = ''
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
          const eventDigest = eventDigestFromFileId(driveFileId)
          if (eventDigest) {
            const content = allEventFiles().get(eventDigest)
            if (content === undefined) {
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
          const eventDigest = eventDigestFromFileId(driveFileId)
          if (eventDigest) {
            if (!allEventFiles().has(eventDigest)) {
              await route.fulfill({ status: 404, body: '{}' })
              return
            }
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                id: driveFileId,
                name: `${eventDigest}.yaml`,
                md5Checksum: `e2e-event-md5-${eventDigest}`,
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
          const event = parseEventMultipart(bodyText)
          if (event) {
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

        await route.fallback()
      })
    },
  }
}
