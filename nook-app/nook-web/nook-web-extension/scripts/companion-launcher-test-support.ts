import { expect } from 'bun:test'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'

export function browserTab(
  url: string,
  id: number | false = false,
): chrome.tabs.Tab {
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

export enum LauncherBrowserFailureKind {
  None = 'none',
  SourceWindow = 'source-window',
  LastFocusedWindow = 'last-focused-window',
  Contexts = 'contexts',
  TabsCreate = 'tabs-create',
  WindowUpdate = 'window-update',
}

export enum LauncherLastFocusedWindowKind {
  Identified = 'identified',
  MissingId = 'missing-id',
}

export enum LauncherWindowType {
  Normal = 'normal',
  Popup = 'popup',
}

type LauncherContextFilter = {
  contextTypes: [typeof chrome.runtime.ContextType.TAB]
  windowIds: [number]
}

type LauncherLastFocusedWindow =
  | { kind: LauncherLastFocusedWindowKind.Identified; id: number }
  | { kind: LauncherLastFocusedWindowKind.MissingId }

type LauncherBrowserFailure =
  | { kind: LauncherBrowserFailureKind.None }
  | { kind: LauncherBrowserFailureKind.SourceWindow }
  | { kind: LauncherBrowserFailureKind.LastFocusedWindow }
  | { kind: LauncherBrowserFailureKind.Contexts }
  | { kind: LauncherBrowserFailureKind.TabsCreate }
  | { kind: LauncherBrowserFailureKind.WindowUpdate }

export type LauncherBrowserHost = {
  tabs: chrome.tabs.Tab[]
  contexts: chrome.runtime.ExtensionContext[]
  createdUrls: string[]
  createdWindowIds: number[]
  updatedUrls: string[]
  updatedTabIds: number[]
  focusedWindowIds: number[]
  contextFilters: LauncherContextFilter[]
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

export function createLauncherBrowserHost(
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
    contextFilters: [],
    windowGetIds: [],
    lastFocusedWindowCalls: 0,
    contextCalls: 0,
    windowTypes: args.windowTypes,
    lastFocusedWindow: args.lastFocusedWindow,
    failure: args.failure,
  }
}

type LauncherRejectionRequest = {
  operation: Promise<void>
  expectedMessage: string
}

export function expectLauncherRejection({
  operation,
  expectedMessage,
}: LauncherRejectionRequest): Promise<void> {
  return operation.then(
    () => {
      throw new Error('expected launcher operation to reject')
    },
    (failure: unknown) => {
      expect(failure).toBeInstanceOf(Error)
      expect(failure).toHaveProperty('message', expectedMessage)
    },
  )
}

export function launcherContext(
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

export function launcherContextWithoutDocumentUrl(
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

function requiredTestTabUrl(args: chrome.tabs.CreateProperties): string {
  switch (typeof args.url) {
    case 'string':
      return args.url
    case 'undefined':
      throw new Error('launcher tab request omitted its URL')
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'symbol':
    case 'object':
    case 'function':
      throw new Error('launcher tab request has an invalid URL type')
  }
}

function requireTestTabActivation(args: chrome.tabs.UpdateProperties): void {
  switch (typeof args.active) {
    case 'undefined':
      throw new Error('launcher tab request omitted its activation state')
    case 'boolean':
      switch (args.active) {
        case true:
          return
        case false:
          throw new Error('launcher tab request must activate the tab')
      }
      break
    case 'string':
    case 'number':
    case 'bigint':
    case 'symbol':
    case 'object':
    case 'function':
      throw new Error('launcher tab request has an invalid activation type')
  }
}

function requiredTestTabWindowId(args: chrome.tabs.CreateProperties): number {
  switch (typeof args.windowId) {
    case 'number':
      return args.windowId
    case 'undefined':
      throw new Error('launcher tab request omitted its window ID')
    case 'string':
    case 'bigint':
    case 'boolean':
    case 'symbol':
    case 'object':
    case 'function':
      throw new Error('launcher tab request has an invalid window ID type')
  }
}

enum LauncherTabUrlUpdateKind {
  ActivationOnly = 'activation-only',
  Navigate = 'navigate',
}

type LauncherTabUrlUpdate =
  | { kind: LauncherTabUrlUpdateKind.ActivationOnly }
  | { kind: LauncherTabUrlUpdateKind.Navigate; url: string }

function launcherTabUrlUpdate(
  args: chrome.tabs.UpdateProperties,
): LauncherTabUrlUpdate {
  switch (typeof args.url) {
    case 'string':
      return {
        kind: LauncherTabUrlUpdateKind.Navigate,
        url: args.url,
      }
    case 'undefined':
      return { kind: LauncherTabUrlUpdateKind.ActivationOnly }
    case 'number':
    case 'bigint':
    case 'boolean':
    case 'symbol':
    case 'object':
    case 'function':
      throw new Error('launcher tab update has an invalid URL type')
  }
}

export function installLauncherBrowserHost(host: LauncherBrowserHost): void {
  Object.assign(globalThis, {
    chrome: {
      runtime: {
        ContextType: { TAB: 'TAB' },
        getURL: () => 'chrome-extension://nook/popup/index.html',
        getContexts: async (filter: LauncherContextFilter) => {
          host.contextCalls += 1
          host.contextFilters.push(filter)
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.Contexts:
              throw new Error('runtime.getContexts failed')
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.TabsCreate:
            case LauncherBrowserFailureKind.WindowUpdate:
              break
          }
          const selectedContexts: chrome.runtime.ExtensionContext[] = []
          for (const context of host.contexts) {
            switch (context.windowId) {
              case filter.windowIds[0]:
                selectedContexts.push(context)
                break
              default:
                break
            }
          }
          return selectedContexts
        },
      },
      tabs: {
        create: (args: chrome.tabs.CreateProperties) => {
          const url = requiredTestTabUrl(args)
          host.createdUrls.push(url)
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.TabsCreate:
              return Promise.reject(new Error('tabs.create failed'))
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.WindowUpdate:
              break
          }
          const windowId = requiredTestTabWindowId(args)
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
          host.contexts.push(
            launcherContext(createdTabId, created.windowId, url),
          )
          host.windowTypes.set(created.windowId, LauncherWindowType.Normal)
          host.tabs.push(created)
          return Promise.resolve(created)
        },
        update: (tabId: number, args: chrome.tabs.UpdateProperties) => {
          const urlUpdate = launcherTabUrlUpdate(args)
          requireTestTabActivation(args)
          host.updatedTabIds.push(tabId)
          const tab = host.tabs.find((candidate) => candidate.id === tabId)
          switch (typeof tab) {
            case 'object':
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
            case 'undefined': {
              return Promise.reject(
                new Error('tabs.update target tab is missing'),
              )
            }
            case 'string':
            case 'number':
            case 'bigint':
            case 'boolean':
            case 'symbol':
            case 'function':
              return Promise.reject(
                new Error('tabs.update target tab has an invalid runtime type'),
              )
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
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.TabsCreate:
            case LauncherBrowserFailureKind.WindowUpdate:
              break
          }
          return {
            id: windowId,
            type: host.windowTypes.get(windowId),
          }
        },
        getLastFocused: async (
          args: Parameters<typeof chrome.windows.getLastFocused>[0],
        ) => {
          expect(args?.windowTypes).toEqual(['normal'])
          host.lastFocusedWindowCalls += 1
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.LastFocusedWindow:
              throw new Error('windows.getLastFocused failed')
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.TabsCreate:
            case LauncherBrowserFailureKind.WindowUpdate:
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
        update: (windowId: number) => {
          host.focusedWindowIds.push(windowId)
          switch (host.failure.kind) {
            case LauncherBrowserFailureKind.WindowUpdate:
              return Promise.reject(new Error('windows.update failed'))
            case LauncherBrowserFailureKind.None:
            case LauncherBrowserFailureKind.SourceWindow:
            case LauncherBrowserFailureKind.LastFocusedWindow:
            case LauncherBrowserFailureKind.Contexts:
            case LauncherBrowserFailureKind.TabsCreate:
              return Promise.resolve({ id: windowId })
          }
        },
      },
    },
  })
}
