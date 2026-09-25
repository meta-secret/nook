import { describe, expect, spyOn, test } from 'bun:test'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
import {
  browserTab,
  createLauncherBrowserHost,
  expectLauncherRejection,
  installLauncherBrowserHost,
  launcherContext,
  launcherContextWithoutDocumentUrl,
  LauncherBrowserFailureKind,
  LauncherLastFocusedWindowKind,
  LauncherWindowType,
  type LauncherBrowserHost,
  type LauncherLastFocusedWindow,
} from './companion-launcher-test-support'

describe('openCompanionLauncherBestEffort', () => {
  test('normalizes sender tab presence into direct or source-window state', async () => {
    installLauncherBrowserHost(
      createLauncherBrowserHost({
        tabs: [],
        contexts: [],
        windowTypes: new Map<number, LauncherWindowType>(),
        lastFocusedWindow: {
          kind: LauncherLastFocusedWindowKind.MissingId,
        },
        failure: { kind: LauncherBrowserFailureKind.None },
      }),
    )
    const { CompanionLauncherSourceKind, ExtensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')
    const initiatingTab = browserTab('https://example.test/login', 50)
    initiatingTab.windowId = 9

    const directSource = ExtensionSessionLifecycle.sourceFromSender({})
    const sourceWindow = ExtensionSessionLifecycle.sourceFromSender({
      tab: initiatingTab,
    })

    expect(directSource).toEqual(ExtensionSessionLifecycle.directEntrySource())
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
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.TabsCreate },
    }
    installLauncherBrowserHost(host)
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.Default,
        source: ExtensionSessionLifecycle.directEntrySource(),
      }),
      expectedMessage: 'tabs.create failed',
    })
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
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.Contexts },
    }
    installLauncherBrowserHost(host)
    Object.assign(globalThis, {
      __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
    })
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    let finishWarning = (): void => {
      throw new Error('warning observer was not initialized')
    }
    const warningObserved = new Promise<void>((resolve) => {
      finishWarning = resolve
    })
    const warningSpy = spyOn(console, 'warn').mockImplementation(() => {
      finishWarning()
    })
    try {
      extensionSessionLifecycle.openCompanionLauncherBestEffort({
        intent: OpenCompanionLauncherIntent.Default,
        source: ExtensionSessionLifecycle.directEntrySource(),
      })
      await warningObserved
      expect(warningSpy).toHaveBeenCalledTimes(1)
      expect(warningSpy).toHaveBeenCalledWith(
        'Nook authentication tab could not be opened',
      )
    } finally {
      warningSpy.mockRestore()
    }
    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
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
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.SourceWindow },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.PilotAuth,
        source: ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
      }),
      expectedMessage: 'windows.get failed',
    })

    expect(host.windowGetIds).toEqual([7])
    expect(host.lastFocusedWindowCalls).toBe(0)
    expect(host.contextFilters).toEqual([])
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
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.LastFocusedWindow },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.Default,
        source: ExtensionSessionLifecycle.directEntrySource(),
      }),
      expectedMessage: 'windows.getLastFocused failed',
    })

    expect(host.lastFocusedWindowCalls).toBe(1)
    expect(host.contextFilters).toEqual([])
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

      await expectLauncherRejection({
        operation: extensionSessionLifecycle.openCompanionLauncher({
          intent: OpenCompanionLauncherIntent.Default,
          source: ExtensionSessionLifecycle.directEntrySource(),
        }),
        expectedMessage: 'last-focused normal window has no valid ID',
      })

      expect(host.lastFocusedWindowCalls).toBe(1)
      expect(host.contextFilters).toEqual([])
      expect(host.contextCalls).toBe(0)
      expect(host.createdUrls).toEqual([])
      expect(host.updatedTabIds).toEqual([])
      expect(host.focusedWindowIds).toEqual([])
    }
  })

  test('rejects a failed context observation without opening another tab', async () => {
    const host = createLauncherBrowserHost({
      tabs: [],
      contexts: [],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.Contexts },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.Default,
        source: ExtensionSessionLifecycle.directEntrySource(),
      }),
      expectedMessage: 'runtime.getContexts failed',
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.contextCalls).toBe(1)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('rejects a matching tab context without a document URL instead of duplicating it', async () => {
    const authTab = browserTab('chrome-extension://nook/popup/index.html', 52)
    authTab.windowId = 7
    const host = createLauncherBrowserHost({
      tabs: [authTab],
      contexts: [launcherContextWithoutDocumentUrl(52, 7)],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.Default,
        source: ExtensionSessionLifecycle.directEntrySource(),
      }),
      expectedMessage: 'launcher tab context is unobservable',
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.contextCalls).toBe(1)
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
    expect(authTab.url).toBe('chrome-extension://nook/popup/index.html')
  })

  test('rejects a stale exact-intent tab without creating a replacement', async () => {
    const host = createLauncherBrowserHost({
      tabs: [],
      contexts: [
        launcherContext(53, 7, 'chrome-extension://nook/popup/index.html'),
      ],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.Default,
        source: ExtensionSessionLifecycle.directEntrySource(),
      }),
      expectedMessage: 'tabs.update target tab is missing',
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.updatedTabIds).toEqual([53])
    expect(host.createdUrls).toEqual([])
    expect(host.createdWindowIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })

  test('preserves a window-focus failure without creating a replacement tab', async () => {
    const authUrl = 'chrome-extension://nook/popup/index.html?intent=pilot-auth'
    const authTab = browserTab(authUrl, 54)
    authTab.windowId = 7
    const host = createLauncherBrowserHost({
      tabs: [authTab],
      contexts: [launcherContext(54, 7, authUrl)],
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.WindowUpdate },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.PilotAuth,
        source: ExtensionSessionLifecycle.directEntrySource(),
      }),
      expectedMessage: 'windows.update failed',
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.updatedTabIds).toEqual([54])
    expect(host.focusedWindowIds).toEqual([7])
    expect(host.createdUrls).toEqual([])
    expect(host.createdWindowIds).toEqual([])
  })

  test('routes toolbar and Pilot through the same component and reuses exact intents', async () => {
    const host: LauncherBrowserHost = {
      tabs: [],
      contexts: [],
      createdUrls: [],
      createdWindowIds: [],
      updatedUrls: [],
      updatedTabIds: [],
      focusedWindowIds: [],
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([[7, LauncherWindowType.Normal]]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    }
    installLauncherBrowserHost(host)
    expect('WindowType' in chrome.windows).toBe(false)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.Default,
      source: ExtensionSessionLifecycle.directEntrySource(),
    })
    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.PilotAuth,
      source: ExtensionSessionLifecycle.directEntrySource(),
    })
    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.Default,
      source: ExtensionSessionLifecycle.directEntrySource(),
    })

    expect(host.createdUrls).toEqual([
      'chrome-extension://nook/popup/index.html',
      'chrome-extension://nook/popup/index.html?intent=pilot-auth',
    ])
    expect(host.createdWindowIds).toEqual([7, 7])
    expect(host.updatedUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([40])
    expect(host.lastFocusedWindowCalls).toBe(3)
    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.focusedWindowIds).toEqual([7])
    expect(host.tabs).toHaveLength(2)
    expect(host.tabs.map((tab) => tab.url)).toEqual([
      'chrome-extension://nook/popup/index.html',
      'chrome-extension://nook/popup/index.html?intent=pilot-auth',
    ])
    expect(host.tabs.map((tab) => tab.active)).toEqual([true, false])
  })

  test('reuses the initiating normal window tab instead of a legacy popup window', async () => {
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
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([
        [7, LauncherWindowType.Normal],
        [8, LauncherWindowType.Popup],
      ]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 8,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    }
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.PilotAuth,
      source: ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.createdUrls).toEqual([])
    expect(host.updatedTabIds).toEqual([82])
    expect(host.updatedUrls).toEqual([])
    expect(host.focusedWindowIds).toEqual([7])
    expect(legacyPopupTab.url).toBe(popupUrl)
    expect(initiatingWindowTab.url).toBe(pilotAuthUrl)
  })

  test('opens in the initiating normal window and leaves a legacy popup untouched', async () => {
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
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([
        [7, LauncherWindowType.Normal],
        [8, LauncherWindowType.Popup],
      ]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 8,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    }
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.PilotAuth,
      source: ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.createdUrls).toEqual([`${popupUrl}?intent=pilot-auth`])
    expect(host.createdWindowIds).toEqual([7])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
    expect(legacyPopupTab.url).toBe(popupUrl)
  })

  test('opens in the source window instead of focusing an auth tab in another normal window', async () => {
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
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([
        [7, LauncherWindowType.Normal],
        [8, LauncherWindowType.Normal],
      ]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 8,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    }
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.PilotAuth,
      source: ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.createdUrls).toEqual([`${popupUrl}?intent=pilot-auth`])
    expect(host.createdWindowIds).toEqual([7])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
    expect(otherWindowAuthTab.url).toBe(popupUrl)
  })

  test('leaves a different-intent auth tab untouched and creates the requested intent in-window', async () => {
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
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await extensionSessionLifecycle.openCompanionLauncher({
      intent: OpenCompanionLauncherIntent.PilotAuth,
      source: ExtensionSessionLifecycle.sourceFromTab(initiatingSiteTab),
    })

    expect(host.contextFilters).toEqual([
      {
        contextTypes: [chrome.runtime.ContextType.TAB],
        windowIds: [7],
      },
    ])
    expect(host.createdUrls).toEqual([`${popupUrl}?intent=pilot-auth`])
    expect(host.createdWindowIds).toEqual([7])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
    expect(existingDefaultTab.url).toBe(popupUrl)
    expect(existingDefaultTab.active).toBe(false)
  })

  test('rejects a source tab without a valid normal-window ID', async () => {
    const invalidSourceTab = browserTab('https://example.test/login', 92)
    invalidSourceTab.windowId = -1
    const host = createLauncherBrowserHost({
      tabs: [invalidSourceTab],
      contexts: [],
      windowTypes: new Map(),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    })
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.PilotAuth,
        source: ExtensionSessionLifecycle.sourceFromTab(invalidSourceTab),
      }),
      expectedMessage: 'source tab has no valid browser window',
    })

    expect(host.windowGetIds).toEqual([])
    expect(host.lastFocusedWindowCalls).toBe(0)
    expect(host.contextFilters).toEqual([])
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
      contextFilters: [],
      windowGetIds: [],
      lastFocusedWindowCalls: 0,
      contextCalls: 0,
      windowTypes: new Map([
        [7, LauncherWindowType.Normal],
        [8, LauncherWindowType.Popup],
      ]),
      lastFocusedWindow: {
        kind: LauncherLastFocusedWindowKind.Identified,
        id: 7,
      },
      failure: { kind: LauncherBrowserFailureKind.None },
    }
    installLauncherBrowserHost(host)
    const { ExtensionSessionLifecycle, extensionSessionLifecycle } =
      await import('../src/background/service-worker/session-lifecycle')

    await expectLauncherRejection({
      operation: extensionSessionLifecycle.openCompanionLauncher({
        intent: OpenCompanionLauncherIntent.PilotAuth,
        source: ExtensionSessionLifecycle.sourceFromTab(popupSiteTab),
      }),
      expectedMessage: 'source tab is not in a normal browser window',
    })
    expect(host.windowGetIds).toEqual([8])
    expect(host.lastFocusedWindowCalls).toBe(0)
    expect(host.contextFilters).toEqual([])
    expect(host.createdUrls).toEqual([])
    expect(host.createdWindowIds).toEqual([])
    expect(host.updatedTabIds).toEqual([])
    expect(host.focusedWindowIds).toEqual([])
  })
})
