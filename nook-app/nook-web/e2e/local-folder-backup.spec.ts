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
    const storageKey = '__nookE2eLocalFolderFiles'
    function readSnapshot(): Array<{ path: string; content: string }> {
      try {
        return JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as Array<{
          path: string
          content: string
        }>
      } catch {
        return []
      }
    }

    function writeSnapshot(records: Array<{ path: string; content: string }>) {
      sessionStorage.setItem(storageKey, JSON.stringify(records))
    }

    class MemoryFileHandle {
      kind = 'file' as const

      constructor(
        public name: string,
        private files: Map<string, string>,
        private persist: () => void,
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
            this.persist()
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

      seed(path: string, content: string) {
        const [head, ...tail] = path.split('/')
        if (!head) return
        if (tail.length === 0) {
          this.files.set(head, content)
          return
        }
        let child = this.directories.get(head)
        if (!child) {
          child = new MemoryDirectoryHandle(head)
          this.directories.set(head, child)
        }
        child.seed(tail.join('/'), content)
      }

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
        return new MemoryFileHandle(name, this.files, () =>
          writeSnapshot(root.snapshot()),
        )
      }

      async *entries(): AsyncIterable<
        [string, MemoryDirectoryHandle | MemoryFileHandle]
      > {
        for (const entry of this.directories.entries()) {
          yield entry
        }
        for (const name of this.files.keys()) {
          yield [
            name,
            new MemoryFileHandle(name, this.files, () =>
              writeSnapshot(root.snapshot()),
            ),
          ]
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
        return records.sort((left, right) =>
          left.path.localeCompare(right.path),
        )
      }
    }

    const root = new MemoryDirectoryHandle('Nook Backup')
    for (const record of readSnapshot()) {
      root.seed(record.path, record.content)
    }
    Object.assign(window, {
      showDirectoryPicker: async () => root,
      __nookE2eLocalFolderSnapshot: () => root.snapshot(),
    })
  })
}

async function installUnsupportedLocalFolderPickerMock(page: Page) {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showDirectoryPicker', {
      configurable: true,
      value: undefined,
    })
  })
}

test.describe('local folder backup provider', () => {
  test('disables local folder backup when writable folders are unavailable', async ({
    page,
  }) => {
    await installPasskeyMock(page)
    await installUnsupportedLocalFolderPickerMock(page)
    await page.goto('/')
    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)

    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await page.getByTestId('add-provider-btn').first().click()
    const localFolderOption = page.getByTestId('provider-option-local-folder')
    await expect(localFolderOption).toBeDisabled()
    await expect(localFolderOption).toContainText(
      'Requires a browser with writable folder access',
    )
    await expect(page.getByTestId('local-folder-setup')).toHaveCount(0)
  })

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
    await expandSettingsSection(page, 'storage')
    await expect(page.getByTestId('settings-providers-list')).toContainText(
      'Local backup',
    )
    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const key = uniqueSecretKey('folder-backup')
    await addSecret(page, key, 'folder-backup-value')

    await expect
      .poll(
        async () => {
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
              /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(
                record.path,
              ) &&
              record.content.includes('schema_version:') &&
              record.content.includes('operations:'),
          ).length
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)
  })

  test('blocks a second local vault before writing to a folder with another store id', async ({
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
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await expect(page.getByTestId('settings-local-folder-selected')).toHaveText(
      'Nook Backup',
    )
    await page.getByTestId('settings-connect-local-folder-btn').click()
    await waitForVaultOperationsIdle(page)
    await assertVaultReady(page)
    await page.getByTestId('vault-secrets-tab').click()
    await assertVaultReady(page)

    const firstVaultKey = uniqueSecretKey('folder-guard-source')
    await addSecret(page, firstVaultKey, 'folder-guard-source-value')
    await expect
      .poll(
        async () => {
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
          return records.filter((record) =>
            /^nook-log\/v1\/events\/[A-Za-z0-9_-]{43}\.yaml$/.test(record.path),
          ).length
        },
        { timeout: 30_000 },
      )
      .toBeGreaterThan(0)

    const eventsBeforeSecondConnect = await page.evaluate(
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

    await clearBrowserVault(page)
    await page.reload()
    await connectLocalVault(page)
    await openStorageSettings(page)
    await expandSettingsSection(page, 'storage')
    await page.getByTestId('add-provider-btn').first().click()
    await page.getByTestId('provider-option-local-folder').click()
    await page.getByTestId('settings-choose-local-folder-btn').click()
    await page.getByTestId('settings-connect-local-folder-btn').click()
    await waitForVaultOperationsIdle(page)

    await expect(page.getByTestId('vault-error')).toContainText(
      'Backup folder already contains another vault',
    )
    const eventsAfterSecondConnect = await page.evaluate(
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
    expect(eventsAfterSecondConnect).toEqual(eventsBeforeSecondConnect)
  })
})
