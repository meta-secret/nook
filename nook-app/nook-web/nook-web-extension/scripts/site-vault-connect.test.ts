import { describe, expect, test } from 'bun:test'
import { OpenCompanionLauncherIntent } from '../../nook-web-shared/src/extension/companion-launcher-message'
import {
  CompanionLauncherSourceKind,
  type CompanionLauncherOpenRequest,
} from '../src/background/service-worker/companion-launcher'
import {
  SiteVaultConnect,
  SiteVaultConnectOpenerKind,
  SiteVaultConnectReturn,
  SiteVaultConnectWindowKind,
  SiteVaultConnectWindowType,
  SiteVaultConnectWindows,
  type SiteVaultConnectWindowFacts,
  type SiteVaultConnectBrowser,
  type SiteVaultConnectFocus,
  type SiteVaultConnectOrigin,
} from '../src/background/service-worker/site-vault-connect'
import {
  SiteVaultConnectMessageType,
  SiteVaultConnectResponseKind,
} from '../src/lib/site-vault-connect-messages'

const NORMAL_WINDOW = 1
const POPUP_WINDOW = 2
const OTHER_NORMAL_WINDOW = 3
const NEW_WINDOW = 9

enum LastFocusedFixture {
  OtherNormalWindow = 'other-normal-window',
  None = 'none',
}

type BrowserFixtureState = {
  readonly windows: Map<number, SiteVaultConnectWindowType>
  readonly tabs: Map<number, number>
  lastFocused: LastFocusedFixture
  createFails: boolean
}

/** A browser with a normal window, a sign-in popup, and their tabs. */
class ConnectBrowserFixture implements SiteVaultConnectBrowser {
  readonly created: number[] = []
  readonly focused: SiteVaultConnectFocus[] = []
  readonly state: BrowserFixtureState = {
    windows: new Map([
      [NORMAL_WINDOW, SiteVaultConnectWindowType.Normal],
      [POPUP_WINDOW, SiteVaultConnectWindowType.Other],
      [OTHER_NORMAL_WINDOW, SiteVaultConnectWindowType.Normal],
    ]),
    // The site's tab 10 opened popup tab 20.
    tabs: new Map([
      [10, NORMAL_WINDOW],
      [20, POPUP_WINDOW],
    ]),
    lastFocused: LastFocusedFixture.OtherNormalWindow,
    createFails: false,
  }

  private window(id: number): SiteVaultConnectWindowFacts {
    const known = Array.from(this.state.windows).filter(
      ([windowId]) => windowId === id,
    )
    for (const [, type] of known) {
      switch (type) {
        case SiteVaultConnectWindowType.Normal:
          return { type: SiteVaultConnectWindowType.Normal, windowId: id }
        case SiteVaultConnectWindowType.Other:
          return { type: SiteVaultConnectWindowType.Other }
      }
    }
    throw new Error('No window')
  }

  readonly getWindow = async (windowId: number) => this.window(windowId)
  readonly getTab = async (tabId: number) => {
    if (!this.state.tabs.has(tabId)) throw new Error('No tab')
    return { windowId: Number(this.state.tabs.get(tabId)) }
  }
  readonly lastFocusedNormalWindow = async () => {
    switch (this.state.lastFocused) {
      case LastFocusedFixture.None:
        throw new Error('No window')
      case LastFocusedFixture.OtherNormalWindow:
        return this.window(OTHER_NORMAL_WINDOW)
    }
  }
  readonly createNormalWindow = async () => {
    if (this.state.createFails) throw new Error('Window not created')
    this.state.windows.set(NEW_WINDOW, SiteVaultConnectWindowType.Normal)
    this.created.push(NEW_WINDOW)
    return this.window(NEW_WINDOW)
  }
  readonly focusTab = async (focus: SiteVaultConnectFocus) => {
    this.focused.push(focus)
  }
}

type TabFixture = Pick<chrome.tabs.Tab, 'id' | 'windowId' | 'openerTabId'>

function tab(fixture: TabFixture): chrome.tabs.Tab {
  return {
    index: 0,
    pinned: false,
    highlighted: false,
    active: true,
    incognito: false,
    selected: true,
    discarded: false,
    autoDiscardable: true,
    frozen: false,
    lastAccessed: 0,
    groupId: -1,
    ...fixture,
  }
}

function origin(
  windowId: number,
  opener: SiteVaultConnectOrigin['opener'],
): SiteVaultConnectOrigin {
  return { tabId: 20, windowId, opener }
}

const unknownOpener = { kind: SiteVaultConnectOpenerKind.Unknown } as const

describe('connect window selection', () => {
  test('a tab in a normal window connects in that window', async () => {
    const browser = new ConnectBrowserFixture()
    expect(
      await new SiteVaultConnectWindows(browser).select(
        origin(NORMAL_WINDOW, unknownOpener),
      ),
    ).toEqual({
      kind: SiteVaultConnectWindowKind.Source,
      windowId: NORMAL_WINDOW,
    })
    expect(browser.created).toEqual([])
  })

  test('a popup connects beside its opener tab, never inside the popup', async () => {
    const browser = new ConnectBrowserFixture()
    expect(
      await new SiteVaultConnectWindows(browser).select(
        origin(POPUP_WINDOW, {
          kind: SiteVaultConnectOpenerKind.Known,
          tabId: 10,
        }),
      ),
    ).toEqual({
      kind: SiteVaultConnectWindowKind.Opener,
      windowId: NORMAL_WINDOW,
    })
  })

  test('a popup without an opener connects in the last focused normal window', async () => {
    const browser = new ConnectBrowserFixture()
    expect(
      await new SiteVaultConnectWindows(browser).select(
        origin(POPUP_WINDOW, unknownOpener),
      ),
    ).toEqual({
      kind: SiteVaultConnectWindowKind.LastFocused,
      windowId: OTHER_NORMAL_WINDOW,
    })
  })

  test('a popup whose opener closed connects in the last focused normal window', async () => {
    const browser = new ConnectBrowserFixture()
    expect(
      await new SiteVaultConnectWindows(browser).select(
        origin(POPUP_WINDOW, {
          kind: SiteVaultConnectOpenerKind.Known,
          tabId: 99,
        }),
      ),
    ).toEqual({
      kind: SiteVaultConnectWindowKind.LastFocused,
      windowId: OTHER_NORMAL_WINDOW,
    })
  })

  test('a popup with no normal window open connects in a new normal window', async () => {
    const browser = new ConnectBrowserFixture()
    browser.state.lastFocused = LastFocusedFixture.None
    expect(
      await new SiteVaultConnectWindows(browser).select(
        origin(POPUP_WINDOW, unknownOpener),
      ),
    ).toEqual({
      kind: SiteVaultConnectWindowKind.NewWindow,
      windowId: NEW_WINDOW,
    })
  })

  test('the choice fails when no window can be opened', async () => {
    const browser = new ConnectBrowserFixture()
    browser.state.lastFocused = LastFocusedFixture.None
    browser.state.createFails = true
    expect(
      new SiteVaultConnectWindows(browser).select(
        origin(POPUP_WINDOW, unknownOpener),
      ),
    ).rejects.toThrow()
  })
})

/** The connect operation around the fixture browser. */
class ConnectFixture {
  readonly browser = new ConnectBrowserFixture()
  readonly launches: CompanionLauncherOpenRequest[] = []
  now = 1_000
  launcherFails = false
  readonly returnTo = new SiteVaultConnectReturn({
    browser: this.browser,
    now: () => this.now,
  })
  readonly connect = new SiteVaultConnect({
    windows: new SiteVaultConnectWindows(this.browser),
    returnTo: this.returnTo,
    openLauncher: async (request) => {
      if (this.launcherFails) throw new Error('launcher failed')
      this.launches.push(request)
    },
    runtimeId: 'nook',
  })

  request(tab: chrome.tabs.Tab) {
    return this.connect.connect({
      message: { type: SiteVaultConnectMessageType.Connect },
      sender: { id: 'nook', tab },
    })
  }
}

describe('connect from a page widget', () => {
  test('opens the pair launcher outside a sign-in popup and returns to the popup after approval', async () => {
    const fixture = new ConnectFixture()
    const popupTab = tab({ id: 20, windowId: POPUP_WINDOW, openerTabId: 10 })

    expect(await fixture.request(popupTab)).toEqual({
      kind: SiteVaultConnectResponseKind.Opened,
    })
    expect(fixture.launches).toEqual([
      {
        intent: OpenCompanionLauncherIntent.Pair,
        source: {
          kind: CompanionLauncherSourceKind.SourceWindow,
          windowId: NORMAL_WINDOW,
        },
      },
    ])

    await fixture.returnTo.restore()
    expect(fixture.browser.focused).toEqual([
      { tabId: 20, windowId: POPUP_WINDOW },
    ])
    // The return happens once.
    await fixture.returnTo.restore()
    expect(fixture.browser.focused).toHaveLength(1)
  })

  test('a launcher failure answers failed and leaves nothing to return to', async () => {
    const fixture = new ConnectFixture()
    fixture.launcherFails = true
    expect(
      await fixture.request(tab({ id: 10, windowId: NORMAL_WINDOW })),
    ).toEqual({ kind: SiteVaultConnectResponseKind.Failed })
    await fixture.returnTo.restore()
    expect(fixture.browser.focused).toEqual([])
  })

  test('another extension cannot start a connect', async () => {
    const fixture = new ConnectFixture()
    expect(
      await fixture.connect.connect({
        message: { type: SiteVaultConnectMessageType.Connect },
        sender: {
          id: 'other',
          tab: tab({ id: 10, windowId: NORMAL_WINDOW }),
        },
      }),
    ).toEqual({ kind: SiteVaultConnectResponseKind.Failed })
    expect(fixture.launches).toEqual([])
  })

  test('an expired connect does not steal focus later', async () => {
    const fixture = new ConnectFixture()
    await fixture.request(tab({ id: 10, windowId: NORMAL_WINDOW }))
    fixture.now += SiteVaultConnectReturn.TTL_MS + 1
    await fixture.returnTo.restore()
    expect(fixture.browser.focused).toEqual([])
  })
})
