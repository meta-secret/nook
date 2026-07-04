import { test, expect, type Page } from './fixtures'
import {
  addSecret,
  assertVaultReady,
  clearBrowserVault,
  connectLocalVault,
  expandSettingsSection,
  installPasskeyMock,
  openStorageSettings,
  uniqueSecretKey,
  waitForVaultOperationsIdle,
} from './helpers'

async function installLocalFolderPickerMock(page: Page) {
  await page.addInitScript(() => {
    class MemoryFileHandle {
      kind = 'file' as const

      constructor(
        public name: string,
        private files: Map<string, string>,
      ) {}

      async getFile() {
        return new File([this.files.get(this.name) ?? ''], this.name, {
          type: 'application/x-yaml',
        })
      }

      async createWritable() {
        return {
          write: async (data: string) => {
            this.files.set(this.name, data)
          },
          close: async () => undefined,
        }
      }
    }

    class MemoryDirectoryHandle {
      kind = 'directory' as const
      private directories = new Map<string, MemoryDirectoryHandle>()
      private files = new Map<string, string>()

      constructor(public name: string) {}

      async queryPermission() {
        return 'granted'
      }

      async requestPermission() {
        return 'granted'
      }

      async getDirectoryHandle(name: string, options?: { create?: boolean }) {
        const existing = this.directories.get(name)
        if (existing) return existing
        if (!options?.create) {
          throw new DOMException('Not found', 'NotFoundError')
        }
        const child = new MemoryDirectoryHandle(name)
        this.directories.set(name, child)
        return child
      }

      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.files.has(name)) {
          if (!options?.create) {
            throw new DOMException('Not found', 'NotFoundError')
          }
          this.files.set(name, '')
        }
        return new MemoryFileHandle(name, this.files)
      }

      async *entries(): AsyncIterable<
        [string, MemoryDirectoryHandle | MemoryFileHandle]
      > {
        for (const entry of this.directories.entries()) {
          yield entry
        }
        for (const name of this.files.keys()) {
          yield [name, new MemoryFileHandle(name, this.files)]
        }
      }

      snapshot(prefix = ''): Array<{ path: string; content: string }> {
        const records: Array<{ path: string; content: string }> = []
        for (const [name, content] of this.files.entries()) {
          records.push({ path: `${prefix}${name}`, content })
        }
        for (const [name, dir] of this.directories.entries()) {
          records.push(...dir.snapshot(`${prefix}${name}/`))
        }
        return records.sort((left, right) => left.path.localeCompare(right.path))
      }
    }

    const root = new MemoryDirectoryHandle('Nook Backup')
    Object.assign(window, {
      showDirectoryPicker: async () => root,
      __nookE2eLocalFolderSnapshot: () => root.snapshot(),
    })
  })
}

test.describe('local folder backup provider', () => {
  test('connects from settings and writes flat YAML event files', async ({
    page,
  }) => {
    await installPasskeyMock(page)
    await installLocalFolderPickerMock(page)
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await page.getByTestId('add-provider-btn').first().click()
    await page.getByTestId('provider-option-local-folder').click()
    await expect(page.getByTestId('local-folder-setup')).toBeVisible()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await expect(page.getByTestId('settings-local-folder-selected')).toHaveText(
      'Nook Backup',
    )
    await page.getByTestId('settings-connect-local-folder-btn').click()
    await waitForVaultOperationsIdle(page)
    await assertVaultReady(page)
    await expect(page.getByTestId('settings-providers-list')).toContainText(
      'Local backup',
    )
    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const key = uniqueSecretKey('folder-backup')
    await addSecret(page, key, 'folder-backup-value')

    await expect
      .poll(async () => {
        const records = await page.evaluate(
          () =>
            (
              window as Window & {
                __nookE2eLocalFolderSnapshot?: () => Array<{
                  path: string
                  content: string
                }>
              }
            ).__nookE2eLocalFolderSnapshot?.() ?? [],
        )
        return records.filter(
          (record) =>
            /^nook-log\/v1\/events\/[a-f0-9]{64}\.yaml$/.test(record.path) &&
            record.content.includes('schema_version:') &&
            record.content.includes('operations:'),
        ).length
      }, { timeout: 30_000 })
      .toBeGreaterThan(0)
  })
})
