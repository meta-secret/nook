import type { Page } from '@playwright/test'

const DEFAULT_FILE_NAME = 'nook-vault.yaml'

/** In-memory Google Drive appDataFolder stub (Drive v3 REST). */
export function createLocalE2eGoogleDriveVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
) {
  let vaultYaml = initialYaml
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
    const nameDigest = body.match(
      /"name"\s*:\s*"([a-fA-F0-9]{64})\.(?:yaml|event)"/,
    )?.[1]
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
    },
    getFileName: () => fileName,
    async install(
      page: Page,
      opts?: { vaultYaml?: string; fileName?: string },
    ) {
      if (opts?.vaultYaml !== undefined) {
        vaultYaml = opts.vaultYaml
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
          if (decoded.includes('.yaml') || decoded.includes('.event')) {
            const digest = decoded.match(
              /name = '([a-fA-F0-9]{64})\.(?:yaml|event)'/,
            )?.[1]
            await route.fulfill({
              status: 200,
              contentType: 'application/json',
              body: JSON.stringify({
                files: eventListEntries(digest?.toLowerCase()),
              }),
            })
            return
          }
          const files = fileId ? [{ id: fileId, md5Checksum }] : []
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
          if (!vaultYaml.trim()) {
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
          if (!vaultYaml.trim()) {
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
