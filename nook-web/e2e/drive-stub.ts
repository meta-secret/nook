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
          const files =
            vaultYaml.trim().length > 0 ? [{ id: fileId, md5Checksum }] : []
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ files }),
          })
          return
        }

        if (
          url === `https://www.googleapis.com/drive/v3/files/${fileId}` &&
          fullUrl.includes('alt=media')
        ) {
          if (!vaultYaml.trim()) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
          await route.fulfill({
            status: 200,
            contentType: 'application/x-yaml',
            body: vaultYaml,
          })
          return
        }

        if (
          url === `https://www.googleapis.com/drive/v3/files/${fileId}` &&
          method === 'GET'
        ) {
          if (!vaultYaml.trim()) {
            await route.fulfill({ status: 404, body: '{}' })
            return
          }
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
          const body = request.postData() ?? ''
          vaultYaml = body
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

        await route.fulfill({ status: 404, body: '{}' })
      })
    },
  }
}
