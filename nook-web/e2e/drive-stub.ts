import type { Page } from '@playwright/test'

const DEFAULT_FILE_NAME = 'nook-events'

/** In-memory Google Drive appDataFolder stub (Drive v3 REST). */
export function createLocalE2eGoogleDriveVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
) {
  let vaultYaml = initialYaml
  let vaultFileExists = initialYaml.trim().length > 0
  let fileId = `e2e-drive-file-${fileName.replace(/\W/g, '-')}`
  let md5Checksum = 'e2e-stub-md5'
  const eventFiles = new Map<string, string>()

  function eventFileId(digest: string) {
    return `e2e-drive-event-${digest}`
  }

  function eventDigestFromFileId(id: string) {
    return id.startsWith('e2e-drive-event-')
      ? id.slice('e2e-drive-event-'.length)
      : null
  }

  function eventListEntries(digest?: string) {
    const entries: Array<{ id: string; name: string; md5Checksum: string }> = []
    for (const key of eventFiles.keys()) {
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
  ): { digest: string; content: string } | null {
    const eventId = body.match(
      /"event_id"\s*:\s*"sha256:([a-fA-F0-9]{64})"/,
    )?.[1]
    const nameDigest = body.match(/"name"\s*:\s*"([a-fA-F0-9]{64})\.yaml"/)?.[1]
    const digest = eventId ?? nameDigest
    if (!digest) return null
    const markers = [
      '\r\nContent-Type: application/x-yaml\r\n\r\n',
      '\r\nContent-Type: application/json\r\n\r\n',
    ]
    const marker = markers.find((candidate) => body.includes(candidate))
    if (!marker) return null
    const start = body.indexOf(marker)
    if (start === -1) return null
    const contentStart = start + marker.length
    const end = body.indexOf('\r\n--nook_event_boundary--', contentStart)
    const content =
      end === -1 ? body.slice(contentStart) : body.slice(contentStart, end)
    return { digest: digest.toLowerCase(), content }
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
    getEventFileCount: () => eventFiles.size,
    getEventFileContents: () => [...eventFiles.values()],
    clearEventFiles: () => {
      eventFiles.clear()
    },
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: { vaultYaml?: string; fileName?: string },
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

      await page.route('https://www.googleapis.com/**', async (route) => {
        const request = route.request()
        const url = request.url().split('?')[0]!
        const method = request.method()
        const fullUrl = request.url()

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

        if (
          url === 'https://www.googleapis.com/drive/v3/files' &&
          method === 'GET'
        ) {
          const decoded = decodeURIComponent(fullUrl)
          const eventDigest = decoded.match(
            /name\s*=\s*'([a-fA-F0-9]{64})\.yaml'/,
          )?.[1]
          if (decoded.includes("name contains '.yaml'") || eventDigest) {
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                files: eventListEntries(eventDigest?.toLowerCase()),
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
            const content = eventFiles.get(eventDigest)
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
            if (!eventFiles.has(eventDigest)) {
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
          const event = parseEventMultipart(request.postData() ?? '')
          if (event) {
            eventFiles.set(event.digest, event.content)
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
