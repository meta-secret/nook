import { describe, expect, spyOn, test } from 'bun:test'
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

enum LauncherBrowserFailureKind {
  None = 'none',
  SourceWindow = 'source-window',
  LastFocusedWindow = 'last-focused-window',
  TabsQuery = 'tabs-query',
  Contexts = 'contexts',
  TabsCreate = 'tabs-create',
}

enum LauncherLastFocusedWindowKind {
  Identified = 'identified',
  MissingId = 'missing-id',
}

enum LauncherWindowType {
  Normal = 'normal',
  Popup = 'popup',
}

type LauncherLastFocusedWindow =
  | { kind: LauncherLastFocusedWindowKind.Identified; id: number }
  | { kind: LauncherLastFocusedWindowKind.MissingId }

type LauncherBrowserFailure =
  | { kind: LauncherBrowserFailureKind.None }
  | { kind: LauncherBrowserFailureKind.SourceWindow }
  | { kind: LauncherBrowserFailureKind.LastFocusedWindow }
  | { kind: LauncherBrowserFailureKind.TabsQuery }
  | { kind: LauncherBrowserFailureKind.Contexts }
  | { kind: LauncherBrowserFailureKind.TabsCreate }

type LauncherBrowserHost = {
  tabs: chrome.tabs.Tab[]
  contexts: chrome.runtime.ExtensionContext[]
  createdUrls: string[]
  createdWindowIds: number[]
  updatedUrls: string[]
  updatedTabIds: number[]
  focusedWindowIds: number[]
  queryArgs: chrome.tabs.QueryInfo[]
  windowGetIds: number[]
  lastFocusedWindowCalls: number
  contextCalls: number
  windowTypes: Map<number, LauncherWindowType>
  lastFocusedWindow: LauncherLastFocusedWindow
  failure: LauncherBrowserFailure
}

type LauncherBrowserHostArgs = Pick<
  LauncherBrowserHost,
  'tabs' | 'contexts' | 'windowTypes' | 'lastFocusedWindow' | 'failure'
>

function createLauncherBrowserHost(
  args: LauncherBrowserHostArgs,
): LauncherBrowserHost {
  return {
    tabs: args.tabs,
    contexts: args.contexts,
    createdUrls: [],
    createdWindowIds: [],
    updatedUrls: [],
    updatedTabIds: [],
    focusedWindowIds: [],
    queryArgs: [],
    windowGetIds: [],
    lastFocusedWindowCalls: 0,
    contextCalls: 0,
    windowTypes: args.windowTypes,
    lastFocusedWindow: args.lastFocusedWindow,
    failure: args.failure,
  }
}

async function expectLauncherRejection(
  operation: Promise<void>,
): Promise<void> {
  await expect(operation).rejects.toBeInstanceOf(Error)
}

function launcherContext(
  tabId: number,
  windowId: number,
  documentUrl: string,
): chrome.runtime.ExtensionContext {
  return {
    contextId: `launcher-${tabId}`,
    contextType: chrome.runtime.ContextType.TAB,
    documentUrl,
    frameId: 0,
    incognito: false,
    tabId,
    windowId,
  }
}

function launcherContextWithoutDocumentUrl(
  tabId: number,
  windowId: number,
): chrome.runtime.ExtensionContext {
  return {
    contextId: `launcher-${tabId}`,
    contextType: chrome.runtime.ContextType.TAB,
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

function requireTestTabActivation(active: boolean | undefined): void {
  switch (active) {
    case true:
      return
    case false:
      throw new Error('launcher tab request must activate the tab')
    case undefined:
      throw new Error('launcher tab request omitted its activation state')
  }
}

function requiredTestTabWindowId(windowId: number | undefined): number {
  switch (typeof windowId) {
    case 'number':
      return windowId
    case 'undefined':
      throw new Error('launcher tab request omitted its window ID')
  }
}

enum LauncherTabUrlUpdateKind {
  ActivationOnly = 'activation-only',
  Navigate = 'navigate',
}

type LauncherTabUrlUpdate =
  | { kind: LauncherTabUrlUpdateKind.ActivationOnly }
  | { kind: LauncherTabUrlUpdateKind.Navigate; url: string }

function launcherTabUrlUpdate(url: string | undefined): LauncherTabUrlUpdate {
  switch (typeof url) {
    case 'string':
      return { kind: LauncherTabUrlUpdateKind.Navigate, url }
    case 'undefined':
      return { kind: LauncherTabUrlUpdateKind.ActivationOnly }
  }
}

function installLauncherBrowserHost(host: LauncherBrowserHost): void {
  let runtimeLastError: { message: string } | undefined
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        ContextType: { TAB: 'TAB' },
        get lastError() {
          return runtimeLastError
        },
        getURL: () => 'chrome-extension://nook/popup/index.html',
        getContexts: async () => {
          host.contextCalls += 1
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.Contexts:
              throw new Error('runtime.getContexts failed')
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.TabsQuery:
            case LauncherBrowserFailureKind.TabsCreate:
              break
          }
          return host.contexts
        },
      },
      tabs: {
        query: (
          query: chrome.tabs.QueryInfo,
          callback: (result: chrome.tabs.Tab[]) => void,
        ) => {
          host.queryArgs.push(query)
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.TabsQuery:
              runtimeLastError = { message: 'tabs.query failed' }
              callback([])
              runtimeLastError = undefined
              return
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.TabsCreate:
              break
          }
          const tabs = host.tabs.filter((tab) => {
            return (
              tab.windowId === query.windowId &&
              host.windowTypes.get(tab.windowId) === LauncherWindowType.Normal
            )
          })
          callback(tabs)
        },
        create: (args: chrome.tabs.CreateProperties) => {
          const url = requiredTestTabUrl(args.url)
          host.createdUrls.push(url)
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.TabsCreate:
              return Promise.reject(new Error('tabs.create failed'))
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.TabsQuery:
            case LauncherBrowserFailureKind.Contexts:
              break
          }
          const windowId = requiredTestTabWindowId(args.windowId)
          const createdTabId = 39 + host.createdUrls.length
          for (const tab of host.tabs) {
            switch (tab.windowId === windowId) {
              case true:
                tab.active = false
                tab.selected = false
                break
              case false:
                break
            }
          }
          const created = browserTab(url, createdTabId)
          created.windowId = windowId
          host.createdWindowIds.push(windowId)
          host.contexts.push(launcherContext(createdTabId, created.windowId, url))
          host.windowTypes.set(created.windowId, LauncherWindowType.Normal)
          host.tabs.push(created)
          return Promise.resolve(created)
        },
        update: (tabId: number, args: chrome.tabs.UpdateProperties) => {
          const urlUpdate = launcherTabUrlUpdate(args.url)
          requireTestTabActivation(args.active)
          host.updatedTabIds.push(tabId)
          const tab = host.tabs.find((candidate) => candidate.id === tabId)
          switch (tab) {
            case undefined:
              return Promise.resolve(undefined)
            default:
              for (const siblingTab of host.tabs) {
                switch (siblingTab.windowId === tab.windowId) {
                  case true:
                    siblingTab.active = false
                    siblingTab.selected = false
                    break
                  case false:
                    break
                }
              }
              tab.active = true
              tab.selected = true
              switch (urlUpdate.kind) {
                case LauncherTabUrlUpdateKind.ActivationOnly:
                  break
                case LauncherTabUrlUpdateKind.Navigate:
                  host.updatedUrls.push(urlUpdate.url)
                  tab.url = urlUpdate.url
                  for (const context of host.contexts) {
                    switch (context.tabId === tabId) {
                      case true:
                        context.documentUrl = urlUpdate.url
                        break
                      case false:
                        break
                    }
                  }
              }
              return Promise.resolve(tab)
          }
        },
      },
      windows: {
        get: async (windowId: number) => {
          host.windowGetIds.push(windowId)
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.SourceWindow:
              throw new Error('windows.get failed')
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.TabsQuery:
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.TabsCreate:
              break
          }
          return {
            id: windowId,
            type: host.windowTypes.get(windowId),
          }
        },
        getLastFocused: async () => {
          host.lastFocusedWindowCalls += 1
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.LastFocusedWindow:
              throw new Error('windows.getLastFocused failed')
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.TabsQuery:
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.TabsCreate:
              break
          }
          switch (host.lastFocusedWindow.kind) {
            case LauncherLastFocusedWindowKind.Identified:
              return {
                id: host.lastFocusedWindow.id,
                type: host.windowTypes.get(host.lastFocusedWindow.id),
              }
            case LauncherLastFocusedWindowKind.MissingId:
              return { type: LauncherWindowType.Normal }
          }
        },
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
  test('normalizes sender tab presence into direct or source-window state', async () => {
    const { CompanionLauncherSourceKind, ExtensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')
    const initiatingTab = browserTab('https://example.test/login', 50)
    initiatingTab.windowId = 9

    const directSource = ExtensionSessionLifecycle.sourceFromSender({})
    const sourceWindow = ExtensionSessionLifecycle.sourceFromSender({
      tab: initiatingTab,
    })

    expect(directSource).toEqual(
      ExtensionSessionLifecycle.directEntrySource(),
    )
    expect(sourceWindow).toEqual({
      kind: CompanionLauncherSourceKind.SourceWindow,
      windowId: 9,
    })
  })

  test('preserves launcher failures for strict unlock callers', async () => {
    const host: LauncherBrowserHost = {
      tabs: [],
      contexts: [],
      createdUrls: [],
      createdWindowIds: [],
      updatedUrls: [],
      updatedTabIds: [],
      focusedWindowIds: [],
      queryArgs: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.TabsCreate },
    }
    installLauncherBrowserHost(host)
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expect(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      ),
    ).rejects.toThrow('tabs.create failed')
    expect(host.createdUrls).toEqual([
      'chrome-extension://nook/popup/index.html',
    ])
    expect(host.createdWindowIds).toEqual([])
    expect(host.updatedTabIds).toEqual([])
  })

  test('warns generically when a best-effort lookup fails without opening a tab', async () => {
    const host: LauncherBrowserHost = {
      tabs: [],
      contexts: [],
      createdUrls: [],
      createdWindowIds: [],
      updatedUrls: [],
      updatedTabIds: [],
      focusedWindowIds: [],
      queryArgs: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.Contexts },
    }
    installLauncherBrowserHost(host)
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    let finishWarning: (() => void) | undefined
    const warningObserved = new Promise<void>((resolve) => {
      finishWarning = resolve
    })
    const warningSpy = spyOn(console, 'warn').mockImplementation(() => {
      switch (finishWarning) {
        case undefined:
          throw new Error('warning observer was not initialized')
        default:
          finishWarning()
      }
    })
    try {
      extensionSessionLifecycle.openCompanionLauncherBestEffort(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      )
      await warningObserved
      expect(warningSpy).toHaveBeenCalledTimes(1)
      expect(warningSpy).toHaveBeenCalledWith(
        'Nook authentication tab could not be opened',
      )
    } finally {
      warningSpy.mockRestore()
    }
    expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
    expect(host.contextCalls).toBe(1)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('rejects a source-window lookup failure without trying another window', async () => {
    const initiatingSiteTab = browserTab('https://example.test/login', 51)
    initiatingSiteTab.windowId = 7
    const host = createLauncherBrowserHost({
      tabs: [initiatingSiteTab],
      contexts: [],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.SourceWindow },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
      ),
    )

    expect(host.windowGetIds).toEqual([7])
    expect(host.lastFocusedWindowCalls).toBe(0)
    expect(host.queryArgs).toEqual([])
    expect(host.contextCalls).toBe(0)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('rejects a failed last-focused lookup instead of opening an unscoped tab', async () => {
    const host = createLauncherBrowserHost({
      tabs: [],
      contexts: [],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.LastFocusedWindow },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      ),
    )

    expect(host.lastFocusedWindowCalls).toBe(1)
    expect(host.queryArgs).toEqual([])
    expect(host.contextCalls).toBe(0)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('rejects missing and invalid last-focused window IDs without creating a tab', async () => {
    const invalidWindowIdentities: LauncherLastFocusedWindow[] = [
      { kind: LauncherLastFocusedWindowKind.MissingId },
      { kind: LauncherLastFocusedWindowKind.Identified, id: -1 },
    ]
    for (const lastFocusedWindow of invalidWindowIdentities) {
      const windowTypes = new Map<number, LauncherWindowType>()
      switch (lastFocusedWindow.kind) {
        case LauncherLastFocusedWindowKind.Identified:
          windowTypes.set(lastFocusedWindow.id, LauncherWindowType.Normal)
          break
        case LauncherLastFocusedWindowKind.MissingId:
          break
      }
      const host = createLauncherBrowserHost({
        tabs: [],
        contexts: [],
        windowTypes,
        lastFocusedWindow,
        failure: { kind: LauncherBrowserFailureKind.None },
      })
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await expectLauncherRejection(
        extensionSessionLifecycle.openCompanionLauncher(
          OpenCompanionLauncherIntent.Default,
          ExtensionSessionLifecycle.directEntrySource(),
        ),
      )

      expect(host.lastFocusedWindowCalls).toBe(1)
      expect(host.queryArgs).toEqual([])
      expect(host.contextCalls).toBe(0)
      expect(host.createdUrls).toEqual([])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
    }
  })

  test('rejects tabs.query lastError without observing or opening another tab', async () => {
    const host = createLauncherBrowserHost({
      tabs: [],
      contexts: [],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.TabsQuery },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      ),
    )

    expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
    expect(host.contextCalls).toBe(0)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('rejects a failed context observation without opening another tab', async () => {
    const host = createLauncherBrowserHost({
      tabs: [],
      contexts: [],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.Contexts },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      ),
    )

    expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
    expect(host.contextCalls).toBe(1)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test(
    'rejects a matching tab context without a document URL instead of duplicating it',
    async () => {
      const authTab = browserTab('chrome-extension://nook/popup/index.html', 52)
      authTab.windowId = 7
      const host = createLauncherBrowserHost({
        tabs: [authTab],
        contexts: [launcherContextWithoutDocumentUrl(52, 7)],
        windowTypes: new Map([[7, LauncherWindowType.Normal]]),
        lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
        failure: { kind: LauncherBrowserFailureKind.None },
      })
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await expectLauncherRejection(
        extensionSessionLifecycle.openCompanionLauncher(
          OpenCompanionLauncherIntent.Default,
          ExtensionSessionLifecycle.directEntrySource(),
        ),
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.contextCalls).toBe(1)
      expect(host.createdUrls).toEqual([])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
      expect(authTab.url).toBe('chrome-extension://nook/popup/index.html')
    },
  )

  test(
    'routes toolbar and Pilot through the same component and reuses exact intents',
    async () => {
      const host: LauncherBrowserHost = {
        tabs: [],
        contexts: [],
        createdUrls: [],
        createdWindowIds: [],
        updatedUrls: [],
        updatedTabIds: [],
        focusedWindowIds: [],
        queryArgs: [],
        windowGetIds: [],
        lastFocusedWindowCalls: 0,
        contextCalls: 0,
        windowTypes: new Map([[7, LauncherWindowType.Normal]]),
        lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
        failure: { kind: LauncherBrowserFailureKind.None },
      }
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      )
      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.directEntrySource(),
      )
      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.Default,
        ExtensionSessionLifecycle.directEntrySource(),
      )

      expect(host.createdUrls).toEqual([
        'chrome-extension://nook/popup/index.html',
        'chrome-extension://nook/popup/index.html?intent=pilot-auth',
      ])
      expect(host.createdWindowIds).toEqual([7, 7])
      expect(host.updatedUrls).toEqual([])
      expect(host.updatedTabIds).toEqual([40])
      expect(host.lastFocusedWindowCalls).toBe(3)
      expect(host.focusedWindowIds).toEqual([7, 7])
      expect(host.tabs).toHaveLength(2)
      expect(host.tabs.map((tab) => tab.url)).toEqual([
        'chrome-extension://nook/popup/index.html',
        'chrome-extension://nook/popup/index.html?intent=pilot-auth',
      ])
      expect(host.tabs.map((tab) => tab.active)).toEqual([true, false])
    },
  )

  test(
    'reuses the initiating normal window tab instead of a legacy popup window',
    async () => {
      const popupUrl = 'chrome-extension://nook/popup/index.html'
      const legacyPopupTab = browserTab(popupUrl, 81)
      legacyPopupTab.windowId = 8
      const pilotAuthUrl = `${popupUrl}?intent=pilot-auth`
      const initiatingWindowTab = browserTab(pilotAuthUrl, 82)
      initiatingWindowTab.windowId = 7
      const initiatingSiteTab = browserTab('https://example.test/login', 85)
      initiatingSiteTab.windowId = 7
      const host: LauncherBrowserHost = {
        tabs: [legacyPopupTab, initiatingWindowTab, initiatingSiteTab],
        contexts: [
          launcherContext(81, 8, popupUrl),
          launcherContext(82, 7, pilotAuthUrl),
        ],
        createdUrls: [],
        createdWindowIds: [],
        updatedUrls: [],
        updatedTabIds: [],
        focusedWindowIds: [],
        queryArgs: [],
        windowGetIds: [],
        lastFocusedWindowCalls: 0,
        contextCalls: 0,
        windowTypes: new Map([
          [7, LauncherWindowType.Normal],
          [8, LauncherWindowType.Popup],
        ]),
        lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 8 },
        failure: { kind: LauncherBrowserFailureKind.None },
      }
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.createdUrls).toEqual([])
      expect(host.updatedTabIds).toEqual([82])
      expect(host.updatedUrls).toEqual([])
      expect(host.focusedWindowIds).toEqual([7])
      expect(legacyPopupTab.url).toBe(popupUrl)
      expect(initiatingWindowTab.url).toBe(pilotAuthUrl)
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
        windowGetIds: [],
        lastFocusedWindowCalls: 0,
        contextCalls: 0,
        windowTypes: new Map([
          [7, LauncherWindowType.Normal],
          [8, LauncherWindowType.Popup],
        ]),
        lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 8 },
        failure: { kind: LauncherBrowserFailureKind.None },
      }
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
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
        windowGetIds: [],
        lastFocusedWindowCalls: 0,
        contextCalls: 0,
        windowTypes: new Map([
          [7, LauncherWindowType.Normal],
          [8, LauncherWindowType.Normal],
        ]),
        lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 8 },
        failure: { kind: LauncherBrowserFailureKind.None },
      }
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
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
    'leaves a different-intent auth tab untouched and creates the requested intent in-window',
    async () => {
      const popupUrl = 'chrome-extension://nook/popup/index.html'
      const existingDefaultTab = browserTab(popupUrl, 90)
      existingDefaultTab.windowId = 7
      existingDefaultTab.active = false
      const initiatingSiteTab = browserTab('https://example.test/login', 91)
      initiatingSiteTab.windowId = 7
      const host = createLauncherBrowserHost({
        tabs: [existingDefaultTab, initiatingSiteTab],
        contexts: [launcherContext(90, 7, popupUrl)],
        windowTypes: new Map([[7, LauncherWindowType.Normal]]),
        lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
        failure: { kind: LauncherBrowserFailureKind.None },
      })
      installLauncherBrowserHost(host)
      const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
        await import('../src/background/service-worker/session-lifecycle')

      await extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
      )

      expect(host.queryArgs).toEqual([{ windowId: 7, windowType: 'normal' }])
      expect(host.createdUrls).toEqual([
        `${popupUrl}?intent=pilot-auth`,
      ])
      expect(host.createdWindowIds).toEqual([7])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
      expect(existingDefaultTab.url).toBe(popupUrl)
      expect(existingDefaultTab.active).toBe(false)
    },
  )

  test('rejects a source tab without a valid normal-window ID', async () => {
    const invalidSourceTab = browserTab('https://example.test/login', 92)
    invalidSourceTab.windowId = -1
    const host = createLauncherBrowserHost({
      tabs: [invalidSourceTab],
      contexts: [],
      windowTypes: new Map(),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.None },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(invalidSourceTab),
      ),
    )

    expect(host.windowGetIds).toEqual([])
    expect(host.lastFocusedWindowCalls).toBe(0)
    expect(host.queryArgs).toEqual([])
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('rejects a popup source window without falling back or opening a tab', async () => {
    const popupSiteTab = browserTab('https://example.test/login', 86)
    popupSiteTab.windowId = 8
    const host: LauncherBrowserHost = {
      tabs: [popupSiteTab],
      contexts: [],
      createdUrls: [],
      createdWindowIds: [],
      updatedUrls: [],
      updatedTabIds: [],
      focusedWindowIds: [],
      queryArgs: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([
        [7, LauncherWindowType.Normal],
        [8, LauncherWindowType.Popup],
      ]),
      lastFocusedWindow: { kind: LauncherLastFocusedWindowKind.Identified, id: 7 },
      failure: { kind: LauncherBrowserFailureKind.None },
    }
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection(
      extensionSessionLifecycle.openCompanionLauncher(
        OpenCompanionLauncherIntent.PilotAuth,
        ExtensionSessionLifecycle.sourceFromTab(popupSiteTab),
      ),
    )
    expect(host.windowGetIds).toEqual([8])
    expect(host.lastFocusedWindowCalls).toBe(0)
    expect(host.queryArgs).toEqual([])
    expect(host.createdUrls).toEqual([])
    expect(host.createdWindowIds).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
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
