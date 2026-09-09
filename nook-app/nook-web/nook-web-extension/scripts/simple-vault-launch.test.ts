import { describe, expect, spyOn, test } from 'bun:test'

class BrowserCompletion<T> {
  readonly operation: Promise<T>
  complete: (value: T) => void = () => {}
  constructor() {
    this.operation = new Promise((resolve) => { this.complete = resolve })
  }
}

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
const { simpleVaultRuntime } = await import('../src/lib/simple-vault-runtime')
const { extensionSessionLifecycle } = await import('../src/background/service-worker/session-lifecycle')

describe('Simple Vault browser launch', () => {
  test('waits for both URL initialization and tab creation', async () => {
    const url = new BrowserCompletion<string>()
    const tab = new BrowserCompletion<chrome.tabs.Tab>()
    const resolveUrl = spyOn(simpleVaultRuntime, 'runtimeSimpleVaultUrl').mockReturnValue(url.operation)
    const createRequests: chrome.tabs.CreateProperties[] = []
    globalThis.chrome = {
      tabs: {
        create: (request: chrome.tabs.CreateProperties) => {
          createRequests.push(request)
          return tab.operation
        },
      },
    } as typeof chrome
    let completed = false
    try {
      const opening = extensionSessionLifecycle.openSimpleVault('/vault').then(() => { completed = true })
      await Promise.resolve()
      expect(createRequests).toEqual([])
      expect(completed).toBe(false)
      url.complete('https://simple.example.test/vault')
      await Promise.resolve()
      expect(createRequests).toEqual([{ url: 'https://simple.example.test/vault' }])
      expect(completed).toBe(false)
      tab.complete({ id: 1 } as chrome.tabs.Tab)
      await opening
      expect(completed).toBe(true)
    } finally {
      resolveUrl.mockRestore()
    }
  })

  test('propagates URL resolution failure without creating a tab', async () => {
    const resolveUrl = spyOn(simpleVaultRuntime, 'runtimeSimpleVaultUrl').mockRejectedValue('url unavailable')
    const createRequests: chrome.tabs.CreateProperties[] = []
    globalThis.chrome = {
      tabs: { create: (request: chrome.tabs.CreateProperties) => {
        createRequests.push(request)
        return Promise.resolve({ id: 1 } as chrome.tabs.Tab)
      } },
    } as typeof chrome
    try {
      await expect(extensionSessionLifecycle.openSimpleVault()).rejects.toBe('url unavailable')
      expect(createRequests).toEqual([])
    } finally {
      resolveUrl.mockRestore()
    }
  })

  test('propagates tab creation failure', async () => {
    const resolveUrl = spyOn(simpleVaultRuntime, 'runtimeSimpleVaultUrl').mockResolvedValue('https://simple.example.test/')
    globalThis.chrome = {
      tabs: { create: () => Promise.reject('tab unavailable') },
    } as typeof chrome
    try {
      await expect(extensionSessionLifecycle.openSimpleVault()).rejects.toBe('tab unavailable')
    } finally {
      resolveUrl.mockRestore()
    }
  })
})
