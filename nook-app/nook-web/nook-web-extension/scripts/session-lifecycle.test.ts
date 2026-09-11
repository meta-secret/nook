import { describe, expect, test } from 'bun:test'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'

function browserTab(url: string, id: number | false = false): chrome.tabs.Tab {
  const tab: chrome.tabs.Tab = {
    url,
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
  }
  if (typeof id === 'number') tab.id = id
  return tab
}

type AuthenticationSurfaceNotification = { type: string }
type AuthenticationSurfaceHost = {
  tabs: chrome.tabs.Tab[]
  sendMessage: (
    tabId: number,
    message: AuthenticationSurfaceNotification,
  ) => Promise<{ ok: boolean }>
}

function installAuthenticationSurfaceHost({
  tabs,
  sendMessage,
}: AuthenticationSurfaceHost): void {
  Object.assign(globalThis, {
    chrome: {
      tabs: {
        query: (
          _query: chrome.tabs.QueryInfo,
          callback: (result: chrome.tabs.Tab[]) => void,
        ) => callback(tabs),
        sendMessage,
      },
    },
  })
}

describe('ensureExtensionSessionDocument', () => {
  test('uses a browser-confirmed existing offscreen session', async () => {
    let createAttempts = 0
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    Object.assign(globalThis, {
      chrome: {
        offscreen: {
          Reason: { WORKERS: 'WORKERS' },
          createDocument: () => {
            createAttempts += 1
            return Promise.reject('single offscreen document')
          },
        },
        runtime: {
          ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
          getURL: (path: string) => `chrome-extension://nook/${path}`,
          getContexts: () =>
            Promise.resolve([
              {
                contextType: 'OFFSCREEN_DOCUMENT',
                documentUrl: 'chrome-extension://nook/offscreen/session.html',
              },
            ]),
        },
      },
    })
    const { ExtensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await new ExtensionSessionLifecycle().ensureExtensionSessionDocument()
    expect(createAttempts).toBe(0)
  })
})

describe('openCompanionLauncherBestEffort', () => {
  test('preserves launcher failures for strict unlock callers', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          getURL: () => 'chrome-extension://nook/popup/index.html',
        },
        windows: {
          create: () => Promise.reject(new Error('launcher unavailable')),
        },
      },
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
      ),
    ).rejects.toThrow('launcher unavailable')
  })

  test('contains launcher failures for callers returning locked responses', async () => {
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    Object.assign(globalThis, {
      chrome: {
        runtime: {
          getURL: () => 'chrome-extension://nook/popup/index.html',
        },
        windows: {
          create: () => Promise.reject(new Error('launcher unavailable')),
        },
      },
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    expect(() =>
      extensionSessionLifecycle.openCompanionLauncherBestEffort(
        OpenCompanionLauncherIntent.Default,
      ),
    ).not.toThrow()
    await Promise.resolve()
  })
})

describe('authentication surface notifications', () => {
  test('refreshes every available tab and tolerates tabs without ids', async () => {
    const messages: Array<{ tabId: number; type: string }> = []
    installAuthenticationSurfaceHost({
      tabs: [
        browserTab('https://login.example.test/', 7),
        browserTab('https://missing-id.example.test/'),
        browserTab('https://account.example.test/', 11),
      ],
      sendMessage: (tabId, message) => {
        messages.push({ tabId, type: message.type })
        return Promise.resolve({ ok: true })
      },
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.refreshAuthenticationSurfaces()

    expect(messages).toEqual([
      { tabId: 7, type: 'nook:refresh-authentication-surfaces' },
      { tabId: 11, type: 'nook:refresh-authentication-surfaces' },
    ])
  })

  test('reports refresh failure when every eligible tab rejects delivery', async () => {
    installAuthenticationSurfaceHost({
      tabs: [
        browserTab('https://login.example.test/', 7),
        browserTab('https://missing-id.example.test/'),
        browserTab('https://account.example.test/', 11),
      ],
      sendMessage: () => Promise.reject(new Error('tab unavailable')),
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      extensionSessionLifecycle.refreshAuthenticationSurfaces(),
    ).rejects.toThrow('authentication surface refresh delivery failed')
  })

  test('reports refresh failure when every eligible tab replies with failure', async () => {
    installAuthenticationSurfaceHost({
      tabs: [
        browserTab('https://login.example.test/', 7),
        browserTab('https://account.example.test/', 11),
      ],
      sendMessage: () => Promise.resolve({ ok: false }),
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      extensionSessionLifecycle.refreshAuthenticationSurfaces(),
    ).rejects.toThrow('authentication surface refresh delivery failed')
  })

  test('reports refresh failure when any eligible tab rejects delivery', async () => {
    installAuthenticationSurfaceHost({
      tabs: [
        browserTab('https://login.example.test/', 7),
        browserTab('https://account.example.test/', 11),
      ],
      sendMessage: (tabId) =>
        Promise.resolve(tabId === 7 ? { ok: true } : { ok: false }),
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      extensionSessionLifecycle.refreshAuthenticationSurfaces(),
    ).rejects.toThrow('authentication surface refresh delivery failed')
  })

  test('ignores restricted and Nook vault tabs without autofill listeners', async () => {
    const messages: number[] = []
    installAuthenticationSurfaceHost({
      tabs: [
        browserTab('chrome://newtab/', 3),
        browserTab('https://simple.example.test/', 5),
        browserTab('https://sentinel.example.test/', 7),
      ],
      sendMessage: (tabId) => {
        messages.push(tabId)
        return Promise.reject(new Error('content script unavailable'))
      },
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.refreshAuthenticationSurfaces()

    expect(messages).toEqual([])
  })
})
