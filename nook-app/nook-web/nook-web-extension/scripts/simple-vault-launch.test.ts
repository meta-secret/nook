import { describe, expect, spyOn, test } from 'bun:test'

class BrowserCompletion<T> {
  readonly operation: Promise<T>
  complete: (value: T) => void = () => {}
  constructor() {
    this.operation = new Promise((resolve) => {
      this.complete = resolve
    })
  }
}

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
const { simpleVaultRuntime } = await import('../src/lib/simple-vault-runtime')
const { extensionSessionLifecycle } =
  await import('../src/background/service-worker/session-lifecycle')

describe('Simple Vault browser launch', () => {
  test('waits for both URL initialization and tab creation', async () => {
    const url = new BrowserCompletion<string>()
    const tab = new BrowserCompletion<chrome.tabs.Tab>()
    const resolveUrl = spyOn(
      simpleVaultRuntime,
      'runtimeSimpleVaultUrl',
    ).mockReturnValue(url.operation)
    const createRequests: chrome.tabs.CreateProperties[] = []
    Object.assign(globalThis, {
      chrome: {
        tabs: {
          create: (request: chrome.tabs.CreateProperties) => {
            createRequests.push(request)
            return tab.operation
          },
        },
      },
    })
    let completed = false
    try {
      const opening = extensionSessionLifecycle
        .openSimpleVault('/vault')
        .then(() => {
          completed = true
        })
      await Promise.resolve()
      expect(createRequests).toEqual([])
      expect(completed).toBe(false)
      url.complete('https://simple.example.test/vault')
      await Promise.resolve()
      expect(createRequests).toEqual([
        { url: 'https://simple.example.test/vault' },
      ])
      expect(completed).toBe(false)
      tab.complete({
        id: 1,
        index: 0,
        pinned: false,
        highlighted: false,
        windowId: 1,
        active: true,
        incognito: false,
        selected: true,
        discarded: false,
        autoDiscardable: true,
        frozen: false,
        lastAccessed: 0,
        groupId: -1,
      })
      await opening
      expect(completed).toBe(true)
    } finally {
      resolveUrl.mockRestore()
    }
  })

  test('propagates URL resolution failure without creating a tab', async () => {
    const resolveUrl = spyOn(
      simpleVaultRuntime,
      'runtimeSimpleVaultUrl',
    ).mockRejectedValue('url unavailable')
    const createRequests: chrome.tabs.CreateProperties[] = []
    Object.assign(globalThis, {
      chrome: {
        tabs: {
          create: (request: chrome.tabs.CreateProperties) => {
            createRequests.push(request)
            return Promise.resolve()
          },
        },
      },
    })
    try {
      await expect(extensionSessionLifecycle.openSimpleVault()).rejects.toBe(
        'url unavailable',
      )
      expect(createRequests).toEqual([])
    } finally {
      resolveUrl.mockRestore()
    }
  })

  test('propagates tab creation failure', async () => {
    const resolveUrl = spyOn(
      simpleVaultRuntime,
      'runtimeSimpleVaultUrl',
    ).mockResolvedValue('https://simple.example.test/')
    Object.assign(globalThis, {
      chrome: {
        tabs: { create: () => Promise.reject('tab unavailable') },
      },
    })
    try {
      await expect(extensionSessionLifecycle.openSimpleVault()).rejects.toBe(
        'tab unavailable',
      )
    } finally {
      resolveUrl.mockRestore()
    }
  })
})
