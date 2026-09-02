import { afterAll, describe, expect, test } from 'bun:test'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
const originalChrome = globalThis.chrome
afterAll(() => (globalThis.chrome = originalChrome))

describe('ensureExtensionSessionDocument', () => {
  test('uses an existing offscreen session when Chrome rejects with a string', async () => {
    let createAttempts = 0
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      offscreen: {
        createDocument: () => {
          createAttempts += 1
          return Promise.reject('single offscreen document')
        },
      },
    } as typeof chrome
    const { ensureExtensionSessionDocument } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await ensureExtensionSessionDocument()
    expect(createAttempts).toBe(1)
  })
})

describe('openCompanionLauncherBestEffort', () => {
  test('preserves launcher failures for strict unlock callers', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      windows: {
        create: () => Promise.reject(new Error('launcher unavailable')),
      },
    } as typeof chrome
    const { openCompanionLauncher } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await expect(
      openCompanionLauncher(OpenCompanionLauncherIntent.Default),
    ).rejects.toThrow('launcher unavailable')
  })

  test('contains launcher failures for callers returning locked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    globalThis.chrome = {
      runtime: {
        getURL: () => 'chrome-extension://nook/popup/index.html',
      },
      windows: {
        create: () => Promise.reject(new Error('launcher unavailable')),
      },
    } as typeof chrome
    const { openCompanionLauncherBestEffort } =
      await import('../src/background/service-worker/session-lifecycle?test')

    expect(() =>
      openCompanionLauncherBestEffort(OpenCompanionLauncherIntent.Default),
    ).not.toThrow()
    await Promise.resolve()
  })
})

describe('authentication surface notifications', () => {
  test('refreshes every available tab and tolerates tabs without ids', async () => {
    const messages: Array<{ tabId: number; type: string }> = []
    globalThis.chrome = {
      tabs: {
        query: (_query, callback) =>
          callback([
            { id: 7, url: 'https://login.example.test/' },
            {},
            { id: 11, url: 'https://account.example.test/' },
          ]),
        sendMessage: (tabId, message) => {
          messages.push({ tabId, type: message.type })
          return Promise.resolve({ ok: true })
        },
      },
    } as unknown as typeof chrome
    const { refreshAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await refreshAuthenticationSurfaces()

    expect(messages).toEqual([
      { tabId: 7, type: 'nook:refresh-authentication-surfaces' },
      { tabId: 11, type: 'nook:refresh-authentication-surfaces' },
    ])
  })

  test('reports refresh failure when every eligible tab rejects delivery', async () => {
    globalThis.chrome = {
      tabs: {
        query: (_query, callback) =>
          callback([
            { id: 7, url: 'https://login.example.test/' },
            {},
            { id: 11, url: 'https://account.example.test/' },
          ]),
        sendMessage: () => Promise.reject(new Error('tab unavailable')),
      },
    } as unknown as typeof chrome
    const { refreshAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await expect(refreshAuthenticationSurfaces()).rejects.toThrow(
      'authentication surface refresh delivery failed',
    )
  })

  test('reports refresh failure when every eligible tab replies with failure', async () => {
    globalThis.chrome = {
      tabs: {
        query: (_query, callback) =>
          callback([
            { id: 7, url: 'https://login.example.test/' },
            { id: 11, url: 'https://account.example.test/' },
          ]),
        sendMessage: () => Promise.resolve({ ok: false }),
      },
    } as unknown as typeof chrome
    const { refreshAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await expect(refreshAuthenticationSurfaces()).rejects.toThrow(
      'authentication surface refresh delivery failed',
    )
  })

  test('reports refresh failure when any eligible tab rejects delivery', async () => {
    globalThis.chrome = {
      tabs: {
        query: (_query, callback) =>
          callback([
            { id: 7, url: 'https://login.example.test/' },
            { id: 11, url: 'https://account.example.test/' },
          ]),
        sendMessage: (tabId) =>
          Promise.resolve(tabId === 7 ? { ok: true } : { ok: false }),
      },
    } as unknown as typeof chrome
    const { refreshAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await expect(refreshAuthenticationSurfaces()).rejects.toThrow(
      'authentication surface refresh delivery failed',
    )
  })

  test('ignores restricted and Nook vault tabs without autofill listeners', async () => {
    const messages: number[] = []
    globalThis.chrome = {
      tabs: {
        query: (_query, callback) =>
          callback([
            { id: 3, url: 'chrome://newtab/' },
            { id: 5, url: 'https://simple.example.test/' },
            { id: 7, url: 'https://sentinel.example.test/' },
          ]),
        sendMessage: (tabId) => {
          messages.push(tabId)
          return Promise.reject(new Error('content script unavailable'))
        },
      },
    } as unknown as typeof chrome
    const { refreshAuthenticationSurfaces } =
      await import('../src/background/service-worker/session-lifecycle?test')

    await refreshAuthenticationSurfaces()

    expect(messages).toEqual([])
  })
})
