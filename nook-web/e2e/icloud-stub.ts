import type { Page } from '@playwright/test'

const DEFAULT_FILE_NAME = 'nook-vault.yaml'

/** In-memory CloudKit private-database stub (CloudKit Web Services REST). */
export function createLocalE2eICloudVaultStub(
  initialYaml = '',
  fileName = DEFAULT_FILE_NAME,
) {
  let vaultYaml = initialYaml
  let recordChangeTag = 'e2e-stub-change-tag'

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

      await page.route('https://api.apple-cloudkit.com/**', async (route) => {
        const request = route.request()
        const url = request.url().split('?')[0]!
        const method = request.method()

        if (url.endsWith('/users/current') && method === 'GET') {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              nameComponents: { givenName: 'E2E', familyName: 'User' },
            }),
          })
          return
        }

        if (url.endsWith('/records/lookup') && method === 'POST') {
          const records =
            vaultYaml.trim().length > 0
              ? [
                  {
                    recordName: fileName,
                    recordType: 'NookVault',
                    recordChangeTag,
                    fields: {
                      content: { value: vaultYaml },
                    },
                  },
                ]
              : []
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({ records }),
          })
          return
        }

        if (url.endsWith('/records/modify') && method === 'POST') {
          const body = request.postDataJSON() as {
            operations?: Array<{
              record?: { fields?: { content?: { value?: string } } }
            }>
          }
          const content =
            body.operations?.[0]?.record?.fields?.content?.value ?? ''
          if (content) {
            vaultYaml = content
          }
          recordChangeTag = `e2e-stub-change-tag-${Date.now()}`
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              records: [
                {
                  recordName: fileName,
                  recordType: 'NookVault',
                  recordChangeTag,
                },
              ],
            }),
          })
          return
        }

        await route.fulfill({ status: 404, body: '{}' })
      })
    },
  }
}
