import { describe, expect, test } from 'bun:test'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})
globalThis.chrome = {
  runtime: {
    id: 'nook-extension',
    getURL: (path: string) => `chrome-extension://nook-extension/${path}`,
  },
} as typeof chrome

describe('service worker trust routing', () => {
  test('rejects an internal session command from a foreign sender synchronously', async () => {
    const { isExtensionRuntimeSender } =
      await import('../src/background/service-worker/routing-trust')
    const foreignSender: chrome.runtime.MessageSender = {
      id: 'foreign-extension',
    }

    expect(isExtensionRuntimeSender(foreignSender)).toBe(false)
  })

  test('rejects a companion launcher request from an unauthorized external sender', async () => {
    const { isNokeySender } =
      await import('../src/background/service-worker/routing-trust')
    const foreignSender: chrome.runtime.MessageSender = {
      id: 'foreign-extension',
      url: 'https://example.com',
    }

    expect(isNokeySender(foreignSender)).toBe(false)
  })
})
