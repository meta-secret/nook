import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import { SitePageNeed } from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { I18N_KEYS } from '../../nook-web-shared/src/generated/i18n-keys'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
import type { ExtensionSessionTransportResult } from '../src/background/service-worker/session-document'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import {
  SidePanelSender,
  SidePanelSenderAdmission,
} from '../src/background/service-worker/side-panel-sender'
import type {
  SidePanelPageDelivery,
  SidePanelSiteDependencies,
} from '../src/background/service-worker/side-panel-site-access'
import {
  SidePanelLoginFillOperation,
  SidePanelSiteListingOperation,
} from '../src/background/service-worker/side-panel-site-operations'
import type { BrowserRuntimeMessageValue } from '../src/lib/browser-runtime-message'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import {
  SidePanelPageCodeFillReplyKind,
  SidePanelPageFillMessageType,
  SidePanelPageFillReplyKind,
} from '../src/lib/side-panel-page-fill'
import {
  SidePanelPageNeedMessageType,
  SidePanelPageNeedReplyKind,
} from '../src/lib/side-panel-page-need'
import {
  SidePanelCodeFillKind,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessageType,
  type SidePanelSiteListingFailureKind,
} from '../src/lib/side-panel-site'
import {
  RouteData,
  SidePanelRouteFixture,
  ThrowingAfterFirstTabClassifier,
  ThrowingTabClassifier,
  FixtureWindowKind,
  PageReplyKind,
  type PageReply,
} from './side-panel-route-test-support'

type SessionDelivery = ExtensionSessionTransportResult<ExtensionSessionResponse>

beforeAll(async () => {
  const { companionWasmReady } =
    await import('../../nook-web-shared/src/extension/companion-ready')
  await companionWasmReady
})

describe('side-panel sender (T-1)', () => {
  const tabFields = {
    tab: RouteData.tab(5, 'https://example.com/'),
    frameId: 0,
    documentId: 'DOC',
  }
  const forbidden: Array<[string, chrome.runtime.MessageSender]> = [
    [
      'content script',
      {
        id: RouteData.extensionId,
        url: 'https://example.com/login',
        origin: 'https://example.com',
        ...tabFields,
      },
    ],
    [
      'login-picker iframe',
      {
        id: RouteData.extensionId,
        url: RouteData.url('login-picker/index.html'),
        ...tabFields,
        frameId: 4,
      },
    ],
    [
      'auth tab',
      {
        id: RouteData.extensionId,
        url: RouteData.url('popup/index.html'),
        ...tabFields,
      },
    ],
    [
      'former toolbar popup',
      { id: RouteData.extensionId, url: RouteData.url('popup/panel.html') },
    ],
    [
      'offscreen document',
      {
        id: RouteData.extensionId,
        url: RouteData.url('offscreen/session.html'),
      },
    ],
    [
      'service worker',
      {
        id: RouteData.extensionId,
        url: RouteData.url('background/service-worker.js'),
      },
    ],
    ['foreign extension', { ...RouteData.panelSender, id: 'other-extension' }],
    [
      'query variant',
      { ...RouteData.panelSender, url: `${RouteData.panelUrl}?intent=pair` },
    ],
    [
      'fragment variant',
      { ...RouteData.panelSender, url: `${RouteData.panelUrl}#state` },
    ],
    [
      'traversal variant',
      {
        ...RouteData.panelSender,
        url: RouteData.url('side-panel/../side-panel/index.html'),
      },
    ],
    [
      'other page',
      { ...RouteData.panelSender, url: RouteData.url('side-panel/other.html') },
    ],
    ['missing url', { id: RouteData.extensionId }],
    ['panel page in a tab', { ...RouteData.panelSender, ...tabFields }],
    [
      'panel page with a tab only',
      { ...RouteData.panelSender, tab: RouteData.tab(5, RouteData.panelUrl) },
    ],
    ['panel page with a frame id', { ...RouteData.panelSender, frameId: 0 }],
  ]

  test('admits only the side-panel document', () => {
    new SidePanelRouteFixture().install()
    expect(new SidePanelSender(RouteData.panelSender).admission()).toBe(
      SidePanelSenderAdmission.Admitted,
    )
    // Chrome gives every document-backed sender a document id, the panel too.
    const realPanel: chrome.runtime.MessageSender = {
      ...RouteData.panelSender,
      documentId: 'DOC',
      documentLifecycle: 'active',
    }
    expect(new SidePanelSender(realPanel).admission()).toBe(
      SidePanelSenderAdmission.Admitted,
    )
    for (const [, sender] of forbidden) {
      expect(new SidePanelSender(sender).admission()).toBe(
        SidePanelSenderAdmission.Forbidden,
      )
    }
  })

  test('both routes answer every other sender forbidden before reading tabs or the session', async () => {
    for (const [, sender] of forbidden) {
      const fixture = new SidePanelRouteFixture()
      expect(await fixture.list(sender)).toEqual({
        kind: SidePanelSiteListingKind.Forbidden,
      })
      const fill = new SidePanelLoginFillOperation(await fixture.dependencies())
      const message = RouteData.message({
        type: SidePanelSiteMessageType.FillLogin,
        payload: {
          windowId: 7,
          itemId: { vaultStoreId: 'store_workvaultxx', secretId: 'secret_two' },
        },
      })
      expect(await fill.run({ message, sender })).toEqual({
        kind: SidePanelLoginFillKind.Forbidden,
      })
      expect(fixture.tabsQuery).not.toHaveBeenCalled()
      expect(fixture.sessionMessages).toEqual([])
      expect(fixture.pageDeliveries).toEqual([])
    }
  })
})

describe('side-panel This-site listing (T-2)', () => {
  test("lists every grant's Rust-matched site secrets for the tab the worker read itself, grouped by Rust", async () => {
    const fixture = new SidePanelRouteFixture()

    const listing = await fixture.list()

    if (listing.kind !== SidePanelSiteListingKind.Ready)
      throw new Error('expected a ready listing')
    expect(listing.display_host).toBe('www.example.com')
    if (listing.listing.kind !== 'Listed') throw new Error('expected rows')
    // Identity headers in grant order; rows in Rust's kind order.
    expect(listing.listing.groups.map((group) => group.header)).toEqual([
      { kind: 'Named', name: 'Personal identity' },
      { kind: 'Named', name: 'Work identity' },
    ])
    expect(
      listing.listing.groups.map((group) =>
        group.rows.map((row) => [row.kind, row.item_id.secret_id]),
      ),
    ).toEqual([
      [
        ['Login', 'secret_one'],
        ['Passkey', 'passkey_one'],
      ],
      [
        ['Login', 'secret_two'],
        ['Authenticator', 'totp_two'],
      ],
    ])
    expect(fixture.tabsQuery).toHaveBeenCalledWith({
      active: true,
      windowId: 7,
    })
    // One page-need query to frame 0 of the derived tab, for the derived origin.
    expect(fixture.pageDeliveries).toEqual([
      {
        tabId: 41,
        message: {
          type: SidePanelPageNeedMessageType.Query,
          payload: { origin: 'https://www.example.com:8443' },
        },
      },
    ])
    expect(fixture.sessionTypes()).toEqual([
      ExtensionSessionMessageType.Status,
      ExtensionSessionMessageType.ListSiteSecrets,
      ExtensionSessionMessageType.ListSiteSecrets,
    ])
    const wire = JSON.stringify(listing)
    for (const leaked of [
      'password',
      'websiteUrl',
      'token',
      'user:pass',
      'generation',
      'device',
      'seed',
    ]) {
      expect(wire).not.toContain(leaked)
    }
    fixture.expectNoSideEffects()
  })

  test("Rust filters the rows by the page's need and types the empty state", async () => {
    const totp = new SidePanelRouteFixture()
    totp.pageNeed = RouteData.answered({
      kind: SidePanelPageNeedReplyKind.Needed,
      need: SitePageNeed.OneTimeCode,
    })
    const codes = await totp.list()
    if (codes.kind !== SidePanelSiteListingKind.Ready)
      throw new Error('expected a ready listing')
    if (codes.listing.kind !== 'Listed') throw new Error('expected rows')
    expect(
      codes.listing.groups.flatMap((group) =>
        group.rows.map((row) => [row.kind, row.action.kind]),
      ),
    ).toEqual([['Authenticator', 'FillCode']])

    const noCodes = new SidePanelRouteFixture()
    noCodes.pageNeed = totp.pageNeed
    noCodes.siteListings.set(
      'store_workvaultxx',
      ok({ ok: true, matches: { items: [] } }),
    )
    expect(await noCodes.list()).toEqual({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      listing: {
        kind: 'Empty',
        message_key: I18N_KEYS.ExtensionActionSiteEmptyTotp,
        hint: { kind: 'Absent' },
      },
    })
  })

  test('a tab no content script reaches is unavailable; an unusable page need fails the listing', async () => {
    const unreached = new SidePanelRouteFixture()
    unreached.pageNeed = { kind: PageReplyKind.NoReceiver }
    expect(await unreached.list()).toEqual({
      kind: SidePanelSiteListingKind.PageUnavailable,
    })
    expect(unreached.sessionTypes()).toEqual([
      ExtensionSessionMessageType.Status,
    ])
    for (const reply of [
      { kind: SidePanelPageNeedReplyKind.Unavailable },
      { kind: SidePanelPageNeedReplyKind.TabChanged },
      { kind: SidePanelPageNeedReplyKind.Needed, need: 'logins' },
      { kind: 'classified', workflow: 3 },
    ]) {
      const fixture = new SidePanelRouteFixture()
      fixture.pageNeed = RouteData.answered(reply)
      expect(await fixture.list()).toEqual({
        kind: SidePanelSiteListingKind.ListFailed,
      })
      expect(fixture.sessionTypes()).toEqual([
        ExtensionSessionMessageType.Status,
      ])
    }
  })

  test('one failing or malformed grant listing fails the whole listing', async () => {
    const answers: SessionDelivery[] = [
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        ),
      ),
      ok({ ok: false, reason: 'vault-locked' }),
      ok({
        ok: true,
        matches: {
          items: [
            { ...RouteData.secret('Login', 'secret_two', 'w'), password: 'x' },
          ],
        },
      }),
    ]
    for (const answer of answers) {
      const fixture = new SidePanelRouteFixture()
      fixture.siteListings.set('store_workvaultxx', answer)
      expect(await fixture.list()).toEqual({
        kind: SidePanelSiteListingKind.ListFailed,
      })
    }
  })

  test('a request naming an origin, URL or tab is not admitted', async () => {
    for (const payload of [
      { windowId: 7, origin: 'https://evil.test' },
      { windowId: 7, url: 'https://evil.test/' },
      { windowId: 7, tabId: 41 },
    ]) {
      const fixture = new SidePanelRouteFixture()
      expect(await fixture.list(RouteData.panelSender, payload)).toEqual({
        kind: SidePanelSiteListingKind.Forbidden,
      })
      expect(fixture.tabsQuery).not.toHaveBeenCalled()
      expect(fixture.sessionMessages).toEqual([])
    }
  })

  test('browser pages are non-web and Nook vault apps are unavailable, with no session call', async () => {
    const cases: Array<[chrome.tabs.Tab, SidePanelSiteListingFailureKind]> = [
      [RouteData.tab(41, false), SidePanelSiteListingKind.NonWeb],
      [
        RouteData.tab(41, 'chrome://settings/'),
        SidePanelSiteListingKind.NonWeb,
      ],
      [
        RouteData.tab(
          41,
          `chrome-extension://${RouteData.extensionId}/popup/index.html`,
        ),
        SidePanelSiteListingKind.NonWeb,
      ],
      [RouteData.tab(41, 'about:blank'), SidePanelSiteListingKind.NonWeb],
      [
        RouteData.tab(41, 'file:///Users/person/login.html'),
        SidePanelSiteListingKind.NonWeb,
      ],
      [
        RouteData.tab(41, 'https://simple.nokey.sh/'),
        SidePanelSiteListingKind.PageUnavailable,
      ],
      [
        RouteData.tab(41, 'https://simple.nokey.sh./login'),
        SidePanelSiteListingKind.PageUnavailable,
      ],
    ]
    for (const [activeTab, kind] of cases) {
      const fixture = new SidePanelRouteFixture()
      fixture.activeTabs = [activeTab]
      expect(await fixture.list()).toEqual({ kind })
      expect(fixture.sessionMessages).toEqual([])
      fixture.expectNoSideEffects()
    }
  })

  test('an unusable window selector or active tab is page-unavailable', async () => {
    const scenarios: Array<(fixture: SidePanelRouteFixture) => void> = [
      (fixture) => {
        fixture.window = { kind: FixtureWindowKind.Missing }
      },
      (fixture) => {
        fixture.window = RouteData.present({
          ...RouteData.window(),
          type: 'popup',
        })
      },
      (fixture) => {
        fixture.window = RouteData.present({
          ...RouteData.window(),
          incognito: true,
        })
      },
      (fixture) => {
        fixture.activeTabs = []
      },
      (fixture) => {
        fixture.activeTabs = [
          RouteData.tab(41, 'https://a.test/'),
          RouteData.tab(42, 'https://b.test/'),
        ]
      },
      (fixture) => {
        const withoutId = RouteData.tab(41, 'https://a.test/')
        Reflect.deleteProperty(withoutId, 'id')
        fixture.activeTabs = [withoutId]
      },
    ]
    for (const arrange of scenarios) {
      const fixture = new SidePanelRouteFixture()
      arrange(fixture)
      expect(await fixture.list()).toEqual({
        kind: SidePanelSiteListingKind.PageUnavailable,
      })
      expect(fixture.sessionMessages).toEqual([])
    }
  })

  test('a failing tab query or Rust classification is a failure, not a page state', async () => {
    const query = new SidePanelRouteFixture()
    query.tabQueryFails = true
    expect(await query.list()).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })
    expect(await query.fill()).toEqual({
      kind: SidePanelLoginFillKind.FillFailed,
    })
    expect(query.sessionMessages).toEqual([])

    const classification = new SidePanelRouteFixture()
    classification.classifier = new ThrowingTabClassifier()
    expect(await classification.list()).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })
    expect(await classification.fill()).toEqual({
      kind: SidePanelLoginFillKind.FillFailed,
    })
    expect(classification.sessionMessages).toEqual([])
    expect(classification.pageDeliveries).toEqual([])
  })

  test('unpaired and locked answer their state without opening the launcher', async () => {
    const unpaired = new SidePanelRouteFixture()
    unpaired.grants = []
    expect(await unpaired.list()).toEqual({
      kind: SidePanelSiteListingKind.Unpaired,
    })
    expect(unpaired.sessionMessages).toEqual([])
    unpaired.expectNoSideEffects()

    const locked = new SidePanelRouteFixture()
    locked.status = DeviceProtectionStatus.Pin
    expect(await locked.list()).toEqual({
      kind: SidePanelSiteListingKind.Locked,
    })
    expect(locked.sessionTypes()).toEqual([ExtensionSessionMessageType.Status])
    locked.expectNoSideEffects()

    const revoked = new SidePanelRouteFixture()
    revoked.current = false
    expect(await revoked.list()).toEqual({
      kind: SidePanelSiteListingKind.Locked,
    })
    expect(revoked.sessionMessages).toEqual([])

    const lockedDuringListing = new SidePanelRouteFixture()
    lockedDuringListing.revokeAfterListing = true
    expect(await lockedDuringListing.list()).toEqual({
      kind: SidePanelSiteListingKind.Locked,
    })
  })

  test('one failing grant fails the listing instead of showing nothing saved', async () => {
    const transport = new SidePanelRouteFixture()
    transport.siteListings.set(
      'store_workvaultxx',
      err(
        new ExtensionSessionTransportFailure(
          ExtensionSessionTransportFailureKind.DeliveryFailed,
        ),
      ),
    )
    expect(await transport.list()).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })

    const malformed = new SidePanelRouteFixture()
    malformed.siteListings.set(
      'store_workvaultxx',
      ok({ ok: false, reason: 'vault-locked' }),
    )
    expect(await malformed.list()).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })

    const statusUnavailable = new SidePanelRouteFixture()
    statusUnavailable.listings.clear()
    statusUnavailable.status = DeviceProtectionStatus.Unlocked
    const dependencies = await statusUnavailable.dependencies()
    const failingStatus: SidePanelSiteDependencies = {
      ...dependencies,
      sendSessionMessage: async () =>
        err(
          new ExtensionSessionTransportFailure(
            ExtensionSessionTransportFailureKind.Closed,
          ),
        ),
    }
    const operation = new SidePanelSiteListingOperation(failingStatus)
    const message = RouteData.message({
      type: SidePanelSiteMessageType.ListLogins,
      payload: { windowId: 7 },
    })
    expect(
      await operation.run({ message, sender: RouteData.panelSender }),
    ).toEqual({
      kind: SidePanelSiteListingKind.ListFailed,
    })
  })

  test('lists authenticators only as display rows: no code, search or reveal', async () => {
    const fixture = new SidePanelRouteFixture()
    await fixture.list()
    for (const type of [
      ExtensionSessionMessageType.ListAuthenticators,
      ExtensionSessionMessageType.AuthenticatorCode,
      ExtensionSessionMessageType.RevealLogin,
      ExtensionSessionMessageType.ListLogins,
    ]) {
      expect(fixture.sessionTypes()).not.toContain(type)
    }
  })
})

describe('side-panel Fill route (T-3)', () => {
  test('sends one credential-free trigger to frame 0 of the derived tab', async () => {
    const fixture = new SidePanelRouteFixture()

    const outcome = await fixture.fill()

    expect(outcome).toEqual({ kind: SidePanelLoginFillKind.Filled })
    expect(Object.keys(outcome)).toEqual(['kind'])
    // Once to derive the target, once more right before the trigger is sent.
    expect(fixture.tabsQuery).toHaveBeenCalledTimes(2)
    expect(fixture.pageDeliveries).toEqual([
      {
        tabId: 41,
        message: {
          type: SidePanelPageFillMessageType.Fill,
          payload: {
            origin: 'https://www.example.com:8443',
            account: {
              vaultStoreId: 'store_workvaultxx',
              secretId: 'secret_two',
              authorizationGeneration: 'generation-1',
            },
          },
        },
      },
    ])
    expect(JSON.stringify(fixture.pageDeliveries)).not.toContain(
      'work@example.com',
    )
    // Only the vault that holds the item is re-listed; nothing is revealed here.
    expect(fixture.sessionTypes()).toEqual([
      ExtensionSessionMessageType.Status,
      ExtensionSessionMessageType.ListLogins,
    ])
    expect(fixture.sessionTypes()).not.toContain(
      ExtensionSessionMessageType.RevealLogin,
    )
    fixture.expectNoSideEffects()
  })

  test('the production page delivery targets frame 0', async () => {
    const sendMessage = mock(() => Promise.resolve({ kind: 'filled' }))
    Object.assign(globalThis, { chrome: { tabs: { sendMessage } } })
    const { SidePanelSiteRoutes } =
      await import('../src/background/service-worker/side-panel-site-routes')
    const delivery: SidePanelPageDelivery = {
      tabId: 41,
      message: {
        type: SidePanelPageFillMessageType.Fill,
        payload: {
          origin: 'https://www.example.com',
          account: {
            vaultStoreId: 'v',
            secretId: 's',
            authorizationGeneration: 'g',
          },
        },
      },
    }
    await SidePanelSiteRoutes.dependencies.sendPageMessage(delivery)
    expect(sendMessage).toHaveBeenCalledWith(41, delivery.message, {
      frameId: 0,
    })
  })

  test('extra request fields are not admitted and nothing reaches the tab', async () => {
    const fixture = new SidePanelRouteFixture()
    const itemId = { vaultStoreId: 'store_workvaultxx', secretId: 'secret_two' }
    for (const payload of [
      { windowId: 7, itemId, origin: 'https://www.example.com' },
      { windowId: 7, itemId, tabId: 41 },
      { windowId: 7, itemId, username: 'work@example.com' },
      { windowId: 7, itemId: { ...itemId, authorizationGeneration: 'g' } },
    ]) {
      expect(await fixture.fill(itemId, payload)).toEqual({
        kind: SidePanelLoginFillKind.Forbidden,
      })
    }
    expect(fixture.pageDeliveries).toEqual([])
    expect(fixture.sessionMessages).toEqual([])
  })

  test('an item outside the derived origin listing or its granted vaults is not found', async () => {
    const missing = new SidePanelRouteFixture()
    expect(
      await missing.fill({
        vaultStoreId: 'store_workvaultxx',
        secretId: 'secret_elsewhere',
      }),
    ).toEqual({ kind: SidePanelLoginFillKind.ItemNotFound })
    expect(missing.pageDeliveries).toEqual([])

    const ungranted = new SidePanelRouteFixture()
    expect(
      await ungranted.fill({
        vaultStoreId: 'store_unpairedxxx',
        secretId: 'secret_two',
      }),
    ).toEqual({ kind: SidePanelLoginFillKind.ItemNotFound })
    expect(ungranted.sessionMessages).toEqual([])
    expect(ungranted.pageDeliveries).toEqual([])

    const moved = new SidePanelRouteFixture()
    moved.activeTabs = [RouteData.tab(41, 'https://accounts.other.test/login')]
    moved.listings.set('store_workvaultxx', ok({ ok: true, accounts: [] }))
    expect(await moved.fill()).toEqual({
      kind: SidePanelLoginFillKind.ItemNotFound,
    })
    expect(moved.listedOrigins()).toEqual(['https://accounts.other.test'])
    expect(moved.pageDeliveries).toEqual([])
  })

  test('locked, unpaired and non-web tabs send nothing and open no launcher', async () => {
    const locked = new SidePanelRouteFixture()
    locked.status = DeviceProtectionStatus.Passkey
    expect(await locked.fill()).toEqual({ kind: SidePanelLoginFillKind.Locked })
    expect(locked.pageDeliveries).toEqual([])
    locked.expectNoSideEffects()

    const unpaired = new SidePanelRouteFixture()
    unpaired.grants = []
    expect(await unpaired.fill()).toEqual({
      kind: SidePanelLoginFillKind.Unpaired,
    })

    const nonWeb = new SidePanelRouteFixture()
    nonWeb.activeTabs = [RouteData.tab(41, 'chrome://newtab/')]
    expect(await nonWeb.fill()).toEqual({ kind: SidePanelLoginFillKind.NonWeb })
    expect(nonWeb.sessionMessages).toEqual([])

    const vaultApp = new SidePanelRouteFixture()
    vaultApp.activeTabs = [RouteData.tab(41, 'https://simple.nokey.sh/')]
    expect(await vaultApp.fill()).toEqual({
      kind: SidePanelLoginFillKind.PageUnavailable,
    })
    expect(vaultApp.sessionMessages).toEqual([])
  })

  test('a tab switch or navigation before delivery answers tab-changed and sends nothing', async () => {
    const switches: chrome.tabs.Tab[][] = [
      [RouteData.tab(42, 'https://www.example.com:8443/login')],
      [RouteData.tab(41, 'https://accounts.other.test/login')],
      [RouteData.tab(41, 'chrome://newtab/')],
      [RouteData.tab(41, 'https://simple.nokey.sh/')],
    ]
    for (const tabs of switches) {
      const fixture = new SidePanelRouteFixture()
      fixture.tabSwitches = [tabs]
      expect(await fixture.fill()).toEqual({
        kind: SidePanelLoginFillKind.TabChanged,
      })
      expect(fixture.pageDeliveries).toEqual([])
      fixture.expectNoSideEffects()
    }
  })

  test('the same tab on the same origin still receives the trigger after a path change', async () => {
    const fixture = new SidePanelRouteFixture()
    fixture.tabSwitches = [
      [RouteData.tab(41, 'https://www.example.com:8443/account/login?step=2')],
    ]
    expect(await fixture.fill()).toEqual({
      kind: SidePanelLoginFillKind.Filled,
    })
    expect(fixture.pageDeliveries.map((delivery) => delivery.tabId)).toEqual([
      41,
    ])
  })

  test('an unreadable tab before delivery is a failure, not a tab change', async () => {
    const fixture = new SidePanelRouteFixture()
    fixture.classifier = new ThrowingAfterFirstTabClassifier()
    expect(await fixture.fill()).toEqual({
      kind: SidePanelLoginFillKind.FillFailed,
    })
    expect(fixture.pageDeliveries).toEqual([])
  })

  test('a lock between the listing and delivery stops the Fill', async () => {
    const fixture = new SidePanelRouteFixture()
    fixture.revokeAfterListing = true
    expect(await fixture.fill()).toEqual({
      kind: SidePanelLoginFillKind.Locked,
    })
    expect(fixture.pageDeliveries).toEqual([])
  })

  test('maps the page answer to a typed outcome and a missing receiver to page-unavailable', async () => {
    const cases: Array<[PageReply, SidePanelLoginFillKind]> = [
      [
        { kind: PageReplyKind.NoReceiver },
        SidePanelLoginFillKind.PageUnavailable,
      ],
      [
        RouteData.answered({ kind: SidePanelPageFillReplyKind.TabChanged }),
        SidePanelLoginFillKind.TabChanged,
      ],
      [
        RouteData.answered({ kind: SidePanelPageFillReplyKind.NoLoginForm }),
        SidePanelLoginFillKind.NoLoginForm,
      ],
      [
        RouteData.answered({ kind: SidePanelPageFillReplyKind.Locked }),
        SidePanelLoginFillKind.Locked,
      ],
      [
        RouteData.answered({ kind: SidePanelPageFillReplyKind.FillFailed }),
        SidePanelLoginFillKind.FillFailed,
      ],
      [
        RouteData.answered({ kind: 'filled', username: 'work@example.com' }),
        SidePanelLoginFillKind.FillFailed,
      ],
      [RouteData.answered({ ok: true }), SidePanelLoginFillKind.FillFailed],
    ]
    for (const [reply, kind] of cases) {
      const fixture = new SidePanelRouteFixture()
      fixture.pageReply = reply
      expect(await fixture.fill()).toEqual({ kind })
      expect(fixture.pageDeliveries).toHaveLength(1)
    }
  })
})

describe('side-panel Fill code route', () => {
  test("requires the item as an authenticator in Rust's fresh listing, then sends frame 0 a trigger without the code", async () => {
    const fixture = new SidePanelRouteFixture()

    const outcome = await fixture.fillCode()

    expect(outcome).toEqual({ kind: SidePanelCodeFillKind.Filled })
    expect(fixture.tabsQuery).toHaveBeenCalledTimes(2)
    expect(fixture.pageDeliveries).toEqual([
      {
        tabId: 41,
        message: {
          type: SidePanelPageFillMessageType.FillCode,
          payload: {
            origin: 'https://www.example.com:8443',
            account: {
              vaultStoreId: 'store_workvaultxx',
              secretId: 'totp_two',
              authorizationGeneration: 'generation-1',
            },
          },
        },
      },
    ])
    // Only the item's vault is re-listed; the worker reads no code itself.
    expect(fixture.sessionTypes()).toEqual([
      ExtensionSessionMessageType.Status,
      ExtensionSessionMessageType.ListSiteSecrets,
    ])
    fixture.expectNoSideEffects()
  })

  test('a login, an unmatched or an ungranted item is not found and nothing reaches the tab', async () => {
    const itemIds = [
      { vaultStoreId: 'store_workvaultxx', secretId: 'secret_two' },
      { vaultStoreId: 'store_workvaultxx', secretId: 'totp_elsewhere' },
      { vaultStoreId: 'store_personalvlt', secretId: 'totp_two' },
      { vaultStoreId: 'store_unpairedxxx', secretId: 'totp_two' },
    ]
    for (const itemId of itemIds) {
      const fixture = new SidePanelRouteFixture()
      expect(await fixture.fillCode(itemId)).toEqual({
        kind: SidePanelCodeFillKind.ItemNotFound,
      })
      expect(fixture.pageDeliveries).toEqual([])
    }
  })

  test('the same gates as Fill: sender, payload, lock, tab change and listing failure', async () => {
    const extra = new SidePanelRouteFixture()
    const itemId = { vaultStoreId: 'store_workvaultxx', secretId: 'totp_two' }
    expect(
      await extra.fillCode(itemId, { windowId: 7, itemId, tabId: 41 }),
    ).toEqual({ kind: SidePanelCodeFillKind.Forbidden })
    expect(extra.sessionMessages).toEqual([])

    const locked = new SidePanelRouteFixture()
    locked.status = DeviceProtectionStatus.Pin
    expect(await locked.fillCode()).toEqual({
      kind: SidePanelCodeFillKind.Locked,
    })

    const revoked = new SidePanelRouteFixture()
    revoked.revokeAfterListing = true
    expect(await revoked.fillCode()).toEqual({
      kind: SidePanelCodeFillKind.Locked,
    })

    const moved = new SidePanelRouteFixture()
    moved.tabSwitches = [[RouteData.tab(41, 'https://accounts.other.test/')]]
    expect(await moved.fillCode()).toEqual({
      kind: SidePanelCodeFillKind.TabChanged,
    })

    const failing = new SidePanelRouteFixture()
    failing.siteListings.set(
      'store_workvaultxx',
      ok({ ok: false, reason: 'x' }),
    )
    expect(await failing.fillCode()).toEqual({
      kind: SidePanelCodeFillKind.FillFailed,
    })
    for (const fixture of [locked, revoked, moved, failing]) {
      expect(fixture.pageDeliveries).toEqual([])
      fixture.expectNoSideEffects()
    }
  })

  test('maps the page answer to a typed outcome and a missing receiver to page-unavailable', async () => {
    const cases: Array<[PageReply, SidePanelCodeFillKind]> = [
      [
        { kind: PageReplyKind.NoReceiver },
        SidePanelCodeFillKind.PageUnavailable,
      ],
      [
        RouteData.answered({
          kind: SidePanelPageCodeFillReplyKind.NoCodeField,
        }),
        SidePanelCodeFillKind.NoCodeField,
      ],
      [
        RouteData.answered({ kind: SidePanelPageCodeFillReplyKind.Locked }),
        SidePanelCodeFillKind.Locked,
      ],
      [
        RouteData.answered({ kind: 'filled', code: '123456' }),
        SidePanelCodeFillKind.FillFailed,
      ],
    ]
    for (const [reply, kind] of cases) {
      const fixture = new SidePanelRouteFixture()
      fixture.codeReply = reply
      expect(await fixture.fillCode()).toEqual({ kind })
    }
  })
})

describe('website routes stay website-only (T-5)', () => {
  test('a side-panel sender cannot use the content-script reveal route', async () => {
    const storage = new Map<string, string>()
    Object.assign(globalThis, {
      chrome: {
        runtime: { id: RouteData.extensionId, getURL: RouteData.url },
        storage: {
          session: {
            get: async (key: string) =>
              Object.fromEntries(
                [...storage].filter(([stored]) => stored === key),
              ),
            set: async (items: Record<string, string>) => {
              for (const [key, value] of Object.entries(items))
                storage.set(key, value)
            },
          },
        },
      },
    })
    const { accountPickerAuthorizationGeneration } =
      await import('../src/background/service-worker/account-pickers')
    const { websiteLoginFill } =
      await import('../src/background/service-worker/login-operations')
    const authorizationGeneration = await accountPickerAuthorizationGeneration()

    const response = await websiteLoginFill({
      message: {
        payload: {
          origin: 'https://www.example.com',
          vaultStoreId: 'store_workvaultxx',
          secretId: 'secret_two',
          authorizationGeneration,
        },
      },
      sender: RouteData.panelSender,
    })

    expect(response).toEqual({ ok: false, reason: 'login-forbidden-origin' })
  })
})

describe('paired-vault routes answer the side panel instead of the toolbar popup', () => {
  test('admits the side panel and the Nook tab, refuses the former popup and content scripts', async () => {
    new SidePanelRouteFixture().install()
    const { handlePairedVaultsQuery } =
      await import('../src/background/service-worker/paired-vaults')
    const ask = (sender: chrome.runtime.MessageSender) => {
      const responses: BrowserRuntimeMessageValue[] = []
      const sendResponse = (response: BrowserRuntimeMessageValue) => {
        responses.push(response)
      }
      const open = handlePairedVaultsQuery({ sender, sendResponse })
      return { open, responses }
    }
    const forbidden = { ok: false, reason: 'forbidden-sender' }

    expect(ask(RouteData.panelSender).open).toBe(true)
    expect(
      ask({
        id: RouteData.extensionId,
        url: RouteData.url('popup/index.html'),
        tab: RouteData.tab(5, 'x'),
      }).open,
    ).toBe(true)
    const popup = ask({
      id: RouteData.extensionId,
      url: RouteData.url('popup/panel.html'),
    })
    expect(popup).toEqual({ open: false, responses: [forbidden] })
    const content = ask({
      id: RouteData.extensionId,
      url: 'https://example.com/',
      tab: RouteData.tab(5, 'https://example.com/'),
      frameId: 0,
    })
    expect(content).toEqual({ open: false, responses: [forbidden] })
    const panelInTab = ask({
      ...RouteData.panelSender,
      tab: RouteData.tab(5, RouteData.panelUrl),
      frameId: 0,
      documentId: 'D',
    })
    expect(panelInTab).toEqual({ open: false, responses: [forbidden] })
  })
})
