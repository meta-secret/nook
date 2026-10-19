import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { Effect } from 'effect'
import {
  ExtensionConnectTabChoice,
  ExtensionConnectTabFailureKind,
  ExtensionConnectTabFocus,
  ExtensionConnectTabRecencyKind,
  ExtensionConnectTabSelectionKind,
  ExtensionConnectTabs,
  type ExtensionConnectTabCandidate,
} from '../src/background/service-worker/extension-connect-tab'
import { browserTab } from './companion-launcher-test-support'

const SIMPLE = 'https://simple.nokey.sh/'
const CONNECT_URL = `${SIMPLE}extension-connect?nonce=fresh`
const WINDOW = 4

type TabSeed = {
  readonly id: number
  readonly url: string
  readonly active: boolean
  readonly lastAccessed: number
}

enum FixtureWindow {
  Normal = 'normal',
  Popup = 'popup',
  Missing = 'missing',
}

/** Chrome's windows and tabs as the service worker sees them. */
class ConnectTabBrowser {
  window = FixtureWindow.Normal
  tabs: chrome.tabs.Tab[] = []
  readonly updated: Array<{ tabId: number; url: string; active: boolean }> = []
  readonly created: chrome.tabs.CreateProperties[] = []
  readonly focused: number[] = []

  seed(seeds: readonly TabSeed[]): void {
    this.tabs = seeds.map((seed, index) => ({
      ...browserTab(seed.url, seed.id),
      windowId: WINDOW,
      index,
      active: seed.active,
      lastAccessed: seed.lastAccessed,
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
        query: (query: chrome.tabs.QueryInfo) =>
          Promise.resolve(
            this.tabs.filter((tab) => tab.windowId === query.windowId),
          ),
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
    recency: { kind: ExtensionConnectTabRecencyKind.Known, lastAccessed: 0 },
    ...seed,
  }
}

describe('connect tab choice', () => {
  test('no Simple Vault tab opens a new one', () => {
    expect(new ExtensionConnectTabChoice([]).selection()).toEqual({
      kind: ExtensionConnectTabSelectionKind.Open,
    })
  })

  test('the active tab wins, then the most recently active, then tab order', () => {
    const recent = candidate({
      tabId: 1,
      recency: { kind: ExtensionConnectTabRecencyKind.Known, lastAccessed: 50 },
    })
    const active = candidate({
      tabId: 2,
      focus: ExtensionConnectTabFocus.Active,
    })
    const older = candidate({
      tabId: 3,
      recency: { kind: ExtensionConnectTabRecencyKind.Known, lastAccessed: 10 },
    })
    const unreported = candidate({
      tabId: 4,
      recency: { kind: ExtensionConnectTabRecencyKind.Unreported },
    })
    const reuse = (tabId: number) => ({
      kind: ExtensionConnectTabSelectionKind.Reuse,
      tabId,
    })
    expect(
      new ExtensionConnectTabChoice([recent, active, older]).selection(),
    ).toEqual(reuse(2))
    expect(
      new ExtensionConnectTabChoice([older, unreported, recent]).selection(),
    ).toEqual(reuse(1))
    expect(
      new ExtensionConnectTabChoice([unreported, older]).selection(),
    ).toEqual(reuse(3))
    // Equal recency: the first in tab-strip order.
    const tieLater = candidate({ tabId: 9, index: 5 })
    const tieEarlier = candidate({ tabId: 8, index: 2 })
    expect(
      new ExtensionConnectTabChoice([tieLater, tieEarlier]).selection(),
    ).toEqual(reuse(8))
  })
})

describe('connect tab in the requesting window', () => {
  test('reuses the open Simple Vault tab: navigates it to the fresh connect URL and focuses it', async () => {
    browser.seed([
      {
        id: 11,
        url: 'https://news.example.org/',
        active: true,
        lastAccessed: 90,
      },
      { id: 12, url: `${SIMPLE}vault`, active: false, lastAccessed: 40 },
      { id: 13, url: `${SIMPLE}logs`, active: false, lastAccessed: 20 },
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
        lastAccessed: 90,
      },
      {
        id: 14,
        url: 'https://simple.nokey.sh.example.com/',
        active: false,
        lastAccessed: 1,
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

  test('a missing or non-normal window opens nothing', async () => {
    for (const window of [FixtureWindow.Missing, FixtureWindow.Popup]) {
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
    expect(browser.created).toEqual([])
    expect(browser.updated).toEqual([])
    expect(browser.focused).toEqual([])
  })
})
