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
    location: new URL('chrome-extension://nook/service-worker.js'),
    chrome: {
      runtime: {
        sendMessage: (
          message: { payload: { candidateUrl: string } },
          callback: (response: { ok: true; result: boolean }) => void,
        ) => {
          const hostname = new URL(message.payload.candidateUrl).hostname
          callback({
            ok: true,
            result:
              hostname === 'simple.example.test' ||
              hostname === 'sentinel.example.test',
          })
        },
      },
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

type LauncherBrowserHost = {
  tabs: chrome.tabs.Tab[]
  contexts: chrome.runtime.ExtensionContext[]
  createdUrls: string[]
  createdWindowIds: Array<number | 'default'>
  updatedUrls: string[]
  updatedTabIds: number[]
  focusedWindowIds: number[]
  queryArgs: chrome.tabs.QueryInfo[]
  windowTypes: Map<number, 'normal' | 'popup'>
  lastFocusedWindowId: number
}

function launcherContext(
  tabId: number,
  windowId: number,
  documentUrl: string,
): chrome.runtime.ExtensionContext {
  return {
    contextId: `launcher-${tabId}`,
    contextType: 'TAB' as chrome.runtime.ContextType,
    documentUrl,
    frameId: 0,
    incognito: false,
    tabId,
    windowId,
  }
}

function requiredTestTabUrl(url: string | undefined): string {
  switch (typeof url) {
    case 'string':
      return url
    case 'undefined':
      throw new Error('launcher tab request omitted its URL')
  }
}

function requestedTestTabActivation(active: boolean | undefined): boolean {
  switch (active) {
    case true:
      return true
    case false:
      return false
    case undefined:
      throw new Error('launcher tab request omitted its activation state')
  }
}

function installLauncherBrowserHost(host: LauncherBrowserHost): void {
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        ContextType: { TAB: 'TAB' },
        getURL: () => 'chrome-extension://nook/popup/index.html',
        getContexts: async () => host.contexts,
      },
      tabs: {
        query: (
          query: chrome.tabs.QueryInfo,
          callback: (result: chrome.tabs.Tab[]) => void,
        ) => {
          host.queryArgs.push(query)
          const tabs = host.tabs.filter((tab) => {
            switch (typeof query.windowId) {
              case 'number':
                if (tab.windowId !== query.windowId) return false
                break
              case 'undefined':
                switch (query.lastFocusedWindow) {
                  case true:
                    if (tab.windowId !== host.lastFocusedWindowId) {
                      return false
                    }
                    break
                  case false:
                  case undefined:
                    break
                }
                break
            }
            switch (query.windowType) {
              case undefined:
                return true
              default:
                return host.windowTypes.get(tab.windowId) === query.windowType
            }
          })
          callback(tabs)
        },
        create: (args: chrome.tabs.CreateProperties) => {
          const url = requiredTestTabUrl(args.url)
          host.createdUrls.push(url)
          const created = browserTab(url, 40)
          switch (typeof args.windowId) {
            case 'number':
              created.windowId = args.windowId
              host.createdWindowIds.push(args.windowId)
              break
            case 'undefined':
              created.windowId = host.lastFocusedWindowId
              host.createdWindowIds.push('default')
              break
          }
          host.contexts.push(launcherContext(40, created.windowId, url))
          host.windowTypes.set(created.windowId, 'normal')
          host.tabs.push(created)
          return Promise.resolve(created)
        },
        update: (tabId: number, args: chrome.tabs.UpdateProperties) => {
          const url = requiredTestTabUrl(args.url)
          const active = requestedTestTabActivation(args.active)
          host.updatedUrls.push(url)
          host.updatedTabIds.push(tabId)
          const tab = host.tabs.find((candidate) => candidate.id === tabId)
          switch (tab) {
            case undefined:
              return Promise.resolve(undefined)
            default:
              tab.url = url
              tab.active = active
              for (const context of host.contexts) {
                if (context.tabId === tabId) context.documentUrl = url
              }
              return Promise.resolve(tab)
          }
        },
      },
      windows: {
        get: async (windowId: number) => ({
          id: windowId,
          type: host.windowTypes.get(windowId),
        }),
        getLastFocused: async () => ({
          id: host.lastFocusedWindowId,
          type: host.windowTypes.get(host.lastFocusedWindowId),
        }),
        update: (
          windowId: number,
          _args: chrome.windows.UpdateInfo,
        ) => {
          host.focusedWindowIds.push(windowId)
          return Promise.resolve({ id: windowId })
        },
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
        tabs: {
          query: (
            _query: chrome.tabs.QueryInfo,
            callback: (result: chrome.tabs.Tab[]) => void,
          ) => callback([]),
          create: () => Promise.reject(new Error('launcher unavailable')),
        },
      },
    })
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    let launcherRejected = false
    try {
      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
      )
    } catch (failure) {
      launcherRejected = true
      expect(failure).toBeInstanceOf(Error)
      if (failure instanceof Error)
        expect(failure.message).toContain('launcher unavailable')
    }
    expect(launcherRejected).toBe(true)
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
        tabs: {
          query: (
            _query: chrome.tabs.QueryInfo,
            callback: (result: chrome.tabs.Tab[]) => void,
          ) => callback([]),
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

  test('toolbar and Pilot route through the same extension tab', async () => {
    const host: LauncherBrowserHost = {
      tabs: [],
      contexts: [],
      createdUrls: [],
      createdWindowIds: [],
      updatedUrls: [],
      updatedTabIds: [],
      focusedWindowIds: [],
      queryArgs: [],
      windowTypes: new Map([[7, 'normal']]),
      lastFocusedWindowId: 7,
    }
    installLauncherBrowserHost(host)
    const { extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.openCompanionLauncher(
      OpenCompanionLauncherIntent.Default,
    )
    await extensionSessionLifecycle.openCompanionLauncher(
      OpenCompanionLauncherIntent.PilotAuth,
    )
    await extensionSessionLifecycle.openCompanionLauncher(
      OpenCompanionLauncherIntent.Default,
    )

    expect(host.createdUrls).toEqual([
      'chrome-extension://nook/popup/index.html',
    ])
    expect(host.createdWindowIds).toEqual([7])
    expect(host.updatedUrls).toEqual([
      'chrome-extension://nook/popup/index.html?intent=pilot-auth',
      'chrome-extension://nook/popup/index.html',
    ])
    expect(host.focusedWindowIds).toEqual([7, 7])
    expect(host.tabs).toHaveLength(1)
    const [launcherTab] = host.tabs
    switch (launcherTab) {
      case undefined:
        throw new Error('expected a launcher tab')
      default:
        expect(launcherTab.url).toBe(
          'chrome-extension://nook/popup/index.html',
        )
        expect(launcherTab.active).toBe(true)
        break
    }
  })

  test(
    'reuses the initiating normal window tab instead of a legacy popup window',
    async () => {
      const popupUrl = 'chrome-extension://nook/popup/index.html'
      const legacyPopupTab = browserTab(popupUrl, 81)
      legacyPopupTab.windowId = 8
      const initiatingWindowTab = browserTab(popupUrl, 82)
      initiatingWindowTab.windowId = 7
      const initiatingSiteTab = browserTab('https://example.test/login', 85)
      initiatingSiteTab.windowId = 7
      const host: LauncherBrowserHost = {
        tabs: [legacyPopupTab, initiatingWindowTab, initiatingSiteTab],
        contexts: [
          launcherContext(81, 8, popupUrl),
          launcherContext(82, 7, popupUrl),
        ],
        createdUrls: [],
        createdWindowIds: [],
        updatedUrls: [],
        updatedTabIds: [],
        focusedWindowIds: [],
        queryArgs: [],
        windowTypes: new Map([
          [7, 'normal'],
          [8, 'popup'],
        ]),
        lastFocusedWindowId: 8,
      }
      installLauncherBrowserHost(host)
      const { extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        initiatingSiteTab,
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.createdUrls).toEqual([])
      expect(host.updatedTabIds).toEqual([82])
      expect(host.focusedWindowIds).toEqual([7])
      expect(legacyPopupTab.url).toBe(popupUrl)
      expect(initiatingWindowTab.url).toBe(
        `${popupUrl}?intent=pilot-auth`,
      )
    },
  )

  test(
    'opens in the initiating normal window and leaves a legacy popup untouched',
    async () => {
      const popupUrl = 'chrome-extension://nook/popup/index.html'
      const legacyPopupTab = browserTab(popupUrl, 83)
      legacyPopupTab.windowId = 8
      const initiatingSiteTab = browserTab('https://example.test/login', 84)
      initiatingSiteTab.windowId = 7
      const host: LauncherBrowserHost = {
        tabs: [legacyPopupTab, initiatingSiteTab],
        contexts: [launcherContext(83, 8, popupUrl)],
        createdUrls: [],
        createdWindowIds: [],
        updatedUrls: [],
        updatedTabIds: [],
        focusedWindowIds: [],
        queryArgs: [],
        windowTypes: new Map([
          [7, 'normal'],
          [8, 'popup'],
        ]),
        lastFocusedWindowId: 8,
      }
      installLauncherBrowserHost(host)
      const { extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        initiatingSiteTab,
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.createdUrls).toEqual([
        `${popupUrl}?intent=pilot-auth`,
      ])
      expect(host.createdWindowIds).toEqual([7])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
      expect(legacyPopupTab.url).toBe(popupUrl)
    },
  )

  test(
    'opens in the source window instead of focusing an auth tab in another normal window',
    async () => {
      const popupUrl = 'chrome-extension://nook/popup/index.html'
      const otherWindowAuthTab = browserTab(popupUrl, 88)
      otherWindowAuthTab.windowId = 8
      const initiatingSiteTab = browserTab('https://example.test/login', 89)
      initiatingSiteTab.windowId = 7
      const host: LauncherBrowserHost = {
        tabs: [otherWindowAuthTab, initiatingSiteTab],
        contexts: [launcherContext(88, 8, popupUrl)],
        createdUrls: [],
        createdWindowIds: [],
        updatedUrls: [],
        updatedTabIds: [],
        focusedWindowIds: [],
        queryArgs: [],
        windowTypes: new Map([
          [7, 'normal'],
          [8, 'normal'],
        ]),
        lastFocusedWindowId: 8,
      }
      installLauncherBrowserHost(host)
      const { extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        initiatingSiteTab,
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.createdUrls).toEqual([
        `${popupUrl}?intent=pilot-auth`,
      ])
      expect(host.createdWindowIds).toEqual([7])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
      expect(otherWindowAuthTab.url).toBe(popupUrl)
    },
  )

  test(
    'uses the last focused normal window when the initiating site is in a popup window',
    async () => {
      const popupSiteTab = browserTab('https://example.test/login', 86)
      popupSiteTab.windowId = 8
      const normalSiteTab = browserTab('https://other.example.test/login', 87)
      normalSiteTab.windowId = 7
      const host: LauncherBrowserHost = {
        tabs: [popupSiteTab, normalSiteTab],
        contexts: [],
        createdUrls: [],
        createdWindowIds: [],
        updatedUrls: [],
        updatedTabIds: [],
        focusedWindowIds: [],
        queryArgs: [],
        windowTypes: new Map([
          [7, 'normal'],
          [8, 'popup'],
        ]),
        lastFocusedWindowId: 7,
      }
      installLauncherBrowserHost(host)
      const { extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        popupSiteTab,
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.createdUrls).toEqual([
        'chrome-extension://nook/popup/index.html?intent=pilot-auth',
      ])
      expect(host.createdWindowIds).toEqual([7])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
    },
  )
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

    let refreshRejected = false
    try {
      await extensionSessionLifecycle.refreshAuthenticationSurfaces()
    } catch (failure) {
      refreshRejected = true
      expect(failure).toBeInstanceOf(Error)
      if (failure instanceof Error)
        expect(failure.message).toContain(
          'authentication surface refresh delivery failed',
        )
    }
    expect(refreshRejected).toBe(true)
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

    let refreshRejected = false
    try {
      await extensionSessionLifecycle.refreshAuthenticationSurfaces()
    } catch (failure) {
      refreshRejected = true
      expect(failure).toBeInstanceOf(Error)
      if (failure instanceof Error)
        expect(failure.message).toContain(
          'authentication surface refresh delivery failed',
        )
    }
    expect(refreshRejected).toBe(true)
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

    let refreshRejected = false
    try {
      await extensionSessionLifecycle.refreshAuthenticationSurfaces()
    } catch (failure) {
      refreshRejected = true
      expect(failure).toBeInstanceOf(Error)
      if (failure instanceof Error)
        expect(failure.message).toContain(
          'authentication surface refresh delivery failed',
        )
    }
    expect(refreshRejected).toBe(true)
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
