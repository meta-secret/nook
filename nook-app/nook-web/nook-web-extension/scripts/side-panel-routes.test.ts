import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
} from '../src/background/service-worker/session-document'
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
  SidePanelPageFillMessageType,
  SidePanelPageFillReplyKind,
} from '../src/lib/side-panel-page-fill'
import {
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
          itemId: { vaultStoreId: 'store_work', secretId: 'secret_two' },
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
  test('lists Rust-matched logins for the active tab the worker read itself', async () => {
    const fixture = new SidePanelRouteFixture()

    const listing = await fixture.list()

    expect(listing).toEqual({
      kind: SidePanelSiteListingKind.Ready,
      display_host: 'www.example.com',
      items: [
        {
          itemId: { vaultStoreId: 'store_personal', secretId: 'secret_one' },
          username: 'person@example.com',
          vaultLabel: 'Personal',
        },
        {
          itemId: { vaultStoreId: 'store_work', secretId: 'secret_two' },
          username: 'work@example.com',
          vaultLabel: 'Work',
        },
      ],
      passkeys: [],
    })
    expect(fixture.tabsQuery).toHaveBeenCalledWith({
      active: true,
      windowId: 7,
    })
    expect(fixture.listedOrigins()).toEqual([
      'https://www.example.com:8443',
      'https://www.example.com:8443',
    ])
    expect(fixture.sessionTypes()).toEqual([
      ExtensionSessionMessageType.Status,
      ExtensionSessionMessageType.ListLogins,
      ExtensionSessionMessageType.ListLogins,
    ])
    if (listing.kind !== SidePanelSiteListingKind.Ready)
      throw new Error('expected a ready listing')
    for (const item of listing.items) {
      expect(Object.keys(item).sort()).toEqual([
        'itemId',
        'username',
        'vaultLabel',
      ])
      expect(Object.keys(item.itemId).sort()).toEqual([
        'secretId',
        'vaultStoreId',
      ])
    }

    const wire = JSON.stringify(listing)
    for (const leaked of [
      'password',
      'websiteUrl',
      'token',
      'user:pass',
      'generation',
      'device',
    ]) {
      expect(wire).not.toContain(leaked)
    }
    fixture.expectNoSideEffects()
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

  test('one failing grant fails the listing instead of showing no saved logins', async () => {
    const transport = new SidePanelRouteFixture()
    transport.listings.set(
      'store_work',
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
    malformed.listings.set(
      'store_work',
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

  test('lists the passkeys the page can use, read-only, from passkey vaults', async () => {
    const fixture = new SidePanelRouteFixture()
    fixture.passkeyGrants = [RouteData.grant('store_personal', 'Personal')]
    fixture.passkeyListings.set(
      'store_personal|example.com',
      ok({
        ok: true,
        accounts: [
          {
            credentialId: 'credential-personal',
            userName: 'person@example.com',
            userDisplayName: 'Person',
          },
        ],
      }),
    )

    const listing = await fixture.list()

    if (listing.kind !== SidePanelSiteListingKind.Ready)
      throw new Error('expected a ready listing')
    expect(listing.passkeys).toEqual([
      {
        userName: 'person@example.com',
        userDisplayName: 'Person',
        vaultLabel: 'Personal',
      },
    ])
    // Rust names every relying party the page may claim, nearest first.
    expect(fixture.passkeyLookups()).toEqual([
      'store_personal|www.example.com',
      'store_personal|example.com',
    ])
    expect(JSON.stringify(listing)).not.toContain('credential-personal')
  })

  test('never asks the session for authenticators', async () => {
    const fixture = new SidePanelRouteFixture()
    await fixture.list()
    expect(fixture.sessionTypes()).not.toContain(
      ExtensionSessionMessageType.ListAuthenticators,
    )
    expect(fixture.sessionTypes()).not.toContain(
      ExtensionSessionMessageType.AuthenticatorCode,
    )
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
              vaultStoreId: 'store_work',
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
    const itemId = { vaultStoreId: 'store_work', secretId: 'secret_two' }
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
        vaultStoreId: 'store_work',
        secretId: 'secret_elsewhere',
      }),
    ).toEqual({ kind: SidePanelLoginFillKind.ItemNotFound })
    expect(missing.pageDeliveries).toEqual([])

    const ungranted = new SidePanelRouteFixture()
    expect(
      await ungranted.fill({
        vaultStoreId: 'store_unpaired',
        secretId: 'secret_two',
      }),
    ).toEqual({ kind: SidePanelLoginFillKind.ItemNotFound })
    expect(ungranted.sessionMessages).toEqual([])
    expect(ungranted.pageDeliveries).toEqual([])

    const moved = new SidePanelRouteFixture()
    moved.activeTabs = [RouteData.tab(41, 'https://accounts.other.test/login')]
    moved.listings.set('store_work', ok({ ok: true, accounts: [] }))
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
          vaultStoreId: 'store_work',
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
