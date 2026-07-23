import type { Page } from '@playwright/test'

export type LocalFolderRecord = { path: string; content: string }

export async function installLocalFolderPickerMock(page: Page) {
  await page.addInitScript(() => {
    const storageKey = '__nookE2eLocalFolderFiles'
    const readSnapshot = () => {
      try {
        return JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as Array<{
          path: string
          content: string
        }>
      } catch {
        return [] as Array<{ path: string; content: string }>
      }
    }
    const writeSnapshot = (records: Array<{ path: string; content: string }>) =>
      sessionStorage.setItem(storageKey, JSON.stringify(records))

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

      replace(records: Array<{ path: string; content: string }>) {
        this.directories.clear()
        this.files.clear()
        for (const record of records) this.seed(record.path, record.content)
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
        if (!options?.create)
          throw new DOMException('Not found', 'NotFoundError')
        const child = new MemoryDirectoryHandle(name)
        this.directories.set(name, child)
        return child
      }

      async getFileHandle(name: string, options?: { create?: boolean }) {
        if (!this.files.has(name)) {
          if (!options?.create)
            throw new DOMException('Not found', 'NotFoundError')
          this.files.set(name, '')
        }
        return new MemoryFileHandle(name, this.files, () =>
          writeSnapshot(root.snapshot()),
        )
      }

      async *entries(): AsyncIterable<
        [string, MemoryDirectoryHandle | MemoryFileHandle]
      > {
        for (const entry of this.directories.entries()) yield entry
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
        const records = Array.from(this.files, ([name, content]) => ({
          path: `${prefix}${name}`,
          content,
        }))
        for (const [name, directory] of this.directories) {
          records.push(...directory.snapshot(`${prefix}${name}/`))
        }
        return records.sort((left, right) =>
          left.path.localeCompare(right.path),
        )
      }
    }

    const root = new MemoryDirectoryHandle('Nook Backup')
    for (const record of readSnapshot()) root.seed(record.path, record.content)
    let pickerInvocationCount = 0
    Object.assign(window, {
      showDirectoryPicker: async () => {
        pickerInvocationCount += 1
        return root
      },
      __nookE2eLocalFolderPickerInvocationCount: () => pickerInvocationCount,
      __nookE2eLocalFolderSnapshot: () => root.snapshot(),
      __nookE2eSetLocalFolderSnapshot: (
        records: Array<{ path: string; content: string }>,
      ) => {
        root.replace(records)
        writeSnapshot(root.snapshot())
      },
    })
  })
}

export async function localFolderPickerInvocationCount(
  page: Page,
): Promise<number> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __nookE2eLocalFolderPickerInvocationCount?: () => number
        }
      ).__nookE2eLocalFolderPickerInvocationCount?.() ?? 0,
  )
}

export async function localFolderSnapshot(
  page: Page,
): Promise<LocalFolderRecord[]> {
  return page.evaluate(
    () =>
      (
        window as Window & {
          __nookE2eLocalFolderSnapshot?: () => LocalFolderRecord[]
        }
      ).__nookE2eLocalFolderSnapshot?.() ?? [],
  )
}

export async function setLocalFolderSnapshot(
  page: Page,
  records: LocalFolderRecord[],
) {
  await page.evaluate((nextRecords) => {
    ;(
      window as Window & {
        __nookE2eSetLocalFolderSnapshot?: (records: LocalFolderRecord[]) => void
      }
    ).__nookE2eSetLocalFolderSnapshot?.(nextRecords)
  }, records)
}
