import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  ExtensionConnectTabChoice,
  ExtensionConnectTabFailureKind,
  ExtensionConnectTabFocus,
  ExtensionConnectTabSelectionKind,
  ExtensionConnectTabs,
  type ExtensionConnectTabCandidate,
} from '../src/background/service-worker/extension-connect-tab'
import { browserTab } from './companion-launcher-test-support'

const SIMPLE = 'https://simple.nokey.sh/'
const CONNECT_URL = `${SIMPLE}extension-connect?nonce=fresh`
const WINDOW = 4
const OTHER_WINDOW = 5

type TabSeed = {
  readonly id: number
  readonly url: string
  readonly active: boolean
  readonly windowId: number
}

enum FixtureWindow {
  Normal = 'normal',
  Popup = 'popup',
  /** A normal window of the other incognito context. */
  Incognito = 'incognito',
  Missing = 'missing',
}

/** Chrome's windows and tabs as the service worker sees them. */
class ConnectTabBrowser {
  window = FixtureWindow.Normal
  tabs: chrome.tabs.Tab[] = []
  readonly queries: chrome.tabs.QueryInfo[] = []
  readonly updated: Array<{ tabId: number; url: string; active: boolean }> = []
  readonly created: chrome.tabs.CreateProperties[] = []
  readonly focused: number[] = []

  seed(seeds: readonly TabSeed[]): void {
    this.tabs = seeds.map((seed, index) => ({
      ...browserTab(seed.url, seed.id),
      windowId: seed.windowId,
      index,
      active: seed.active,
    }))
  }

  install(): void {
    const chromeStub = {
      extension: { inIncognitoContext: false },
      windows: {
        get: (windowId: number) => this.getWindow(windowId),
        update: (windowId: number) => {
          this.focused.push(windowId)
          return Promise.resolve({ id: windowId })
        },
      },
      tabs: {
        // Chrome answers only the tabs of the queried window.
        query: (query: chrome.tabs.QueryInfo) => {
          this.queries.push(query)
          return Promise.resolve(
            this.tabs.filter((tab) => tab.windowId === query.windowId),
          )
        },
        update: (tabId: number, update: chrome.tabs.UpdateProperties) => {
          this.updated.push({
            tabId,
            url: String(update.url),
            active: update.active === true,
          })
          return Promise.resolve(this.tabs.find((tab) => tab.id === tabId))
        },
        create: (create: chrome.tabs.CreateProperties) => {
          this.created.push(create)
          return Promise.resolve({ ...browserTab(String(create.url), 99) })
        },
      },
    }
    Object.assign(globalThis, { chrome: chromeStub })
  }

  private getWindow(windowId: number): Promise<chrome.windows.Window> {
    const base: chrome.windows.Window = {
      id: windowId,
      focused: false,
      alwaysOnTop: false,
      incognito: false,
    }
    switch (this.window) {
      case FixtureWindow.Normal:
        return Promise.resolve({ ...base, type: 'normal' })
      case FixtureWindow.Popup:
        return Promise.resolve({ ...base, type: 'popup' })
      case FixtureWindow.Incognito:
        return Promise.resolve({ ...base, type: 'normal', incognito: true })
      case FixtureWindow.Missing:
        return Promise.reject(new Error(`No window with id: ${windowId}.`))
    }
  }
}

/** Rust's Simple Vault origin rule, reduced to the fixture origin. */
const simpleVaultOrigin = {
  isRuntimeSimpleVaultUrl: (url: string) =>
    Promise.resolve(url.startsWith(SIMPLE)),
}

const savedChrome = globalThis.chrome
let browser = new ConnectTabBrowser()

beforeEach(() => {
  browser = new ConnectTabBrowser()
  browser.install()
})

afterEach(() => {
  Object.assign(globalThis, { chrome: savedChrome })
})

function open() {
  return Effect.runPromise(
    Effect.result(
      new ExtensionConnectTabs(simpleVaultOrigin).open({
        windowId: WINDOW,
        url: CONNECT_URL,
      }),
    ),
  )
}

function candidate(
  seed: Partial<ExtensionConnectTabCandidate> & { tabId: number },
): ExtensionConnectTabCandidate {
  return {
    index: seed.tabId,
    focus: ExtensionConnectTabFocus.Background,
    ...seed,
  }
}

const reuse = (tabId: number) => ({
  kind: ExtensionConnectTabSelectionKind.Reuse,
  tabId,
})

describe('connect tab choice', () => {
  test('no Simple Vault tab opens a new one', () => {
    expect(new ExtensionConnectTabChoice([]).selection()).toEqual({
      kind: ExtensionConnectTabSelectionKind.Open,
    })
  })

  test('the active Simple Vault tab wins, else the first in tab-strip order', () => {
    const early = candidate({ tabId: 1, index: 0 })
    const active = candidate({
      tabId: 2,
      index: 3,
      focus: ExtensionConnectTabFocus.Active,
    })
    const late = candidate({ tabId: 3, index: 5 })
    expect(
      new ExtensionConnectTabChoice([late, active, early]).selection(),
    ).toEqual(reuse(2))
    expect(new ExtensionConnectTabChoice([late, early]).selection()).toEqual(
      reuse(1),
    )
  })
})

describe('connect tab in the requesting window', () => {
  test('reuses the open Simple Vault tab: navigates it to the fresh connect URL and focuses it', async () => {
    browser.seed([
      {
        id: 11,
        url: 'https://news.example.org/',
        active: true,
        windowId: WINDOW,
      },
      { id: 12, url: `${SIMPLE}vault`, active: false, windowId: WINDOW },
      { id: 13, url: `${SIMPLE}logs`, active: false, windowId: WINDOW },
    ])
    const opened = await open()
    expect(opened._tag).toBe('Success')
    switch (opened._tag) {
      case 'Success':
        expect(opened.success).toBe(12)
        break
      case 'Failure':
        break
    }
    expect(browser.updated).toEqual([
      { tabId: 12, url: CONNECT_URL, active: true },
    ])
    expect(browser.created).toEqual([])
    expect(browser.focused).toEqual([WINDOW])
  })

  test('opens the connect route in that window when no Simple Vault tab is there', async () => {
    browser.seed([
      {
        id: 11,
        url: 'https://news.example.org/',
        active: true,
        windowId: WINDOW,
      },
      {
        id: 14,
        url: 'https://simple.nokey.sh.example.com/',
        active: false,
        windowId: WINDOW,
      },
    ])
    const opened = await open()
    expect(opened._tag).toBe('Success')
    switch (opened._tag) {
      case 'Success':
        expect(opened.success).toBe(99)
        break
      case 'Failure':
        break
    }
    expect(browser.created).toEqual([
      { windowId: WINDOW, url: CONNECT_URL, active: true },
    ])
    expect(browser.updated).toEqual([])
  })

  test('a Simple Vault tab of another window is never reused', async () => {
    browser.seed([
      { id: 21, url: `${SIMPLE}vault`, active: true, windowId: OTHER_WINDOW },
    ])
    const opened = await open()
    expect(opened._tag).toBe('Success')
    expect(browser.queries).toEqual([{ windowId: WINDOW }])
    expect(browser.updated).toEqual([])
    expect(browser.created).toEqual([
      { windowId: WINDOW, url: CONNECT_URL, active: true },
    ])
  })

  test('a missing, non-normal or other-incognito window opens nothing', async () => {
    for (const window of [
      FixtureWindow.Missing,
      FixtureWindow.Popup,
      FixtureWindow.Incognito,
    ]) {
      browser.window = window
      const opened = await open()
      expect(opened._tag).toBe('Failure')
      switch (opened._tag) {
        case 'Failure':
          expect(opened.failure.kind).toBe(
            ExtensionConnectTabFailureKind.WindowUnavailable,
          )
          break
        case 'Success':
          break
      }
    }
    expect(browser.queries).toEqual([])
    expect(browser.created).toEqual([])
    expect(browser.updated).toEqual([])
    expect(browser.focused).toEqual([])
  })
})
