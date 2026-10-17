import { beforeAll, describe, expect, mock, test } from 'bun:test'
import { err, ok } from 'neverthrow'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import {
  ExtensionSessionTransportFailure,
  ExtensionSessionTransportFailureKind,
  type ExtensionSessionTransportResult,
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
import {
  CompanionSidePanelTabClassifier,
  SidePanelTabTargetResolver,
} from '../src/background/service-worker/side-panel-tab-target'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../src/lib/browser-runtime-message'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import type { WebsiteLoginAccountOption } from '../src/lib/login-fill-messages'
import {
  SidePanelPageFillMessageType,
  SidePanelPageFillReplyKind,
} from '../src/lib/side-panel-page-fill'
import {
  SIDE_PANEL_PAGE_PATH,
  SidePanelLoginFillKind,
  SidePanelSiteListingKind,
  SidePanelSiteMessageType,
  type SidePanelSiteListingFailureKind,
} from '../src/lib/side-panel-site'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

/** Builders for the Chrome, grant and listing values the route scenarios use. */
class RouteData {
  static readonly extensionId = 'nook-extension'
  static readonly panelUrl = RouteData.url(SIDE_PANEL_PAGE_PATH)
  static readonly panelSender: chrome.runtime.MessageSender = {
    id: RouteData.extensionId,
    url: RouteData.panelUrl,
    origin: `chrome-extension://${RouteData.extensionId}`,
  }

  static url(path: string): string {
    return `chrome-extension://${RouteData.extensionId}/${path}`
  }

  /** Admits the value the way the service worker's runtime listener does. */
  static message(value: BrowserRuntimeMessageValue): BrowserRuntimeMessage {
    const admission = BrowserRuntimeMessage.from(value)
    if (admission.kind !== BrowserRuntimeMessageAdmissionKind.Accepted)
      throw new Error('fixture must be a runtime message')
    return admission.message
  }

  static grant(
    vaultStoreId: string,
    vaultName: string,
  ): StoredExtensionPairingGrant {
    return {
      vaultType: 'simple',
      vaultStoreId,
      vaultName,
      deviceId: `${vaultStoreId}-device`,
      devicePublicKey: `${vaultStoreId}-public`,
      deviceSigningPublicKey: `${vaultStoreId}-signing`,
      deviceLabel: 'Laptop',
      approvedAt: 1_786_320_000_000,
      scopes: ['password-filling'],
      syncProviderCount: 0,
      eventCount: 1,
      eventLogHeads: [],
      lastLocalSyncAt: '',
    }
  }

  static account(
    vaultStoreId: string,
    secretId: string,
    username: string,
  ): WebsiteLoginAccountOption {
    return {
      vaultStoreId,
      vaultName: vaultStoreId,
      secretId,
      username,
      websiteUrl: 'https://www.example.com/login?session=token',
      websiteHost: 'www.example.com',
    }
  }

  static tab(id: number, url: string | false): chrome.tabs.Tab {
    const base: chrome.tabs.Tab = {
      id,
      index: 0,
      pinned: false,
      highlighted: true,
      windowId: 7,
      active: true,
      incognito: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      lastAccessed: 0,
      groupId: -1,
    }
    return url === false ? base : { ...base, url }
  }

  static window(): chrome.windows.Window {
    return {
      id: 7,
      type: 'normal',
      incognito: false,
      focused: true,
      alwaysOnTop: false,
      state: 'normal',
    }
  }
}

type SessionDelivery = ExtensionSessionTransportResult<ExtensionSessionResponse>
type PageReply = BrowserRuntimeMessageValue | 'no-receiver'

/**
 * A service-worker host with stubbed Chrome windows, tabs and storage, a
 * recording offscreen session, and the real sender predicate, tab resolver,
 * Rust classifier and fail-closed login listing.
 */
class SidePanelRouteFixture {
  readonly sessionMessages: ExtensionSessionTransportRequest[] = []
  readonly pageDeliveries: SidePanelPageDelivery[] = []
  readonly tabsQuery = mock(() => Promise.resolve(this.activeTabs))
  readonly launcher = mock(() => Promise.resolve())
  readonly storageWrite = mock(() => Promise.resolve())
  activeTabs: chrome.tabs.Tab[] = [
    RouteData.tab(
      41,
      'https://user:pass@www.example.com:8443/login?token=secret#f',
    ),
  ]
  window: chrome.windows.Window | 'missing' = RouteData.window()
  grants: StoredExtensionPairingGrant[] = [
    RouteData.grant('store_personal', 'Personal'),
    RouteData.grant('store_work', 'Work'),
  ]
  status: DeviceProtectionStatus = DeviceProtectionStatus.Unlocked
  listings = new Map<string, SessionDelivery>([
    [
      'store_personal',
      ok({
        ok: true,
        accounts: [
          RouteData.account(
            'store_personal',
            'secret_one',
            'person@example.com',
          ),
        ],
      }),
    ],
    [
      'store_work',
      ok({
        ok: true,
        accounts: [
          RouteData.account('store_work', 'secret_two', 'work@example.com'),
        ],
      }),
    ],
  ])
  current = true
  revokeAfterListing = false
  pageReply: PageReply = { kind: SidePanelPageFillReplyKind.Filled }

  install(): void {
    Object.assign(globalThis, {
      chrome: {
        runtime: { id: RouteData.extensionId, getURL: RouteData.url },
        extension: { inIncognitoContext: false },
        windows: {
          get: () =>
            this.window === 'missing'
              ? Promise.reject(new Error('No window with id'))
              : Promise.resolve(this.window),
          create: this.launcher,
        },
        tabs: { query: this.tabsQuery, create: this.launcher },
        storage: {
          local: { set: this.storageWrite },
          session: { set: this.storageWrite },
        },
      },
    })
  }

  async dependencies(): Promise<SidePanelSiteDependencies> {
    this.install()
    const { accountPickerSessions } =
      await import('../src/background/service-worker/account-pickers')
    const resolver = new SidePanelTabTargetResolver({
      classifier: new CompanionSidePanelTabClassifier(),
    })
    return {
      senderAdmission: (sender) => new SidePanelSender(sender).admission(),
      tabTarget: resolver.resolve.bind(resolver),
      authorizationGeneration: async () => 'generation-1',
      authorizationIsCurrent: () => this.current,
      authorizationCleanupPending: async () => false,
      passwordPairingGrants: async () => this.grants,
      sendSessionMessage: async (message) => this.session(message),
      loginAccountAvailabilityForOrigin:
        accountPickerSessions.loginAccountAvailabilityForOrigin.bind(
          accountPickerSessions,
        ),
      sendPageMessage: async (delivery) => {
        this.pageDeliveries.push(delivery)
        if (this.pageReply === 'no-receiver')
          throw new Error('Could not establish connection')
        return this.pageReply
      },
      now: () => 1_000,
    }
  }

  private session(message: ExtensionSessionTransportRequest): SessionDelivery {
    this.sessionMessages.push(message)
    if (message.type === ExtensionSessionMessageType.Status)
      return ok({ ok: true, status: this.status })
    if (message.type !== ExtensionSessionMessageType.ListLogins)
      throw new Error(`unexpected session request ${message.type}`)
    if (this.revokeAfterListing) this.current = false
    const listing = this.listings.get(message.payload.vaultStoreId)
    if (!listing) throw new Error('unexpected vault')
    return listing
  }

  listedOrigins(): string[] {
    return this.sessionMessages.flatMap((message) =>
      message.type === ExtensionSessionMessageType.ListLogins
        ? [message.payload.origin]
        : [],
    )
  }

  sessionTypes(): string[] {
    return this.sessionMessages.map((message) => message.type)
  }

  async list(
    sender: chrome.runtime.MessageSender = RouteData.panelSender,
    payload: BrowserRuntimeMessageValue = { windowId: 7 },
  ) {
    const operation = new SidePanelSiteListingOperation(
      await this.dependencies(),
    )
    const message = RouteData.message({
      type: SidePanelSiteMessageType.ListLogins,
      payload,
    })
    return operation.run({ message, sender })
  }

  async fill(
    itemId = { vaultStoreId: 'store_work', secretId: 'secret_two' },
    payload: BrowserRuntimeMessageValue = { windowId: 7, itemId },
  ) {
    const operation = new SidePanelLoginFillOperation(await this.dependencies())
    const message = RouteData.message({
      type: SidePanelSiteMessageType.FillLogin,
      payload,
    })
    return operation.run({ message, sender: RouteData.panelSender })
  }

  expectNoSideEffects(): void {
    expect(this.launcher).not.toHaveBeenCalled()
    expect(this.storageWrite).not.toHaveBeenCalled()
  }
}

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
    [
      'panel page with a document id',
      { ...RouteData.panelSender, documentId: 'DOC' },
    ],
    ['panel page with a frame id', { ...RouteData.panelSender, frameId: 0 }],
  ]

  test('admits only the side-panel document', () => {
    new SidePanelRouteFixture().install()
    expect(new SidePanelSender(RouteData.panelSender).admission()).toBe(
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
        fixture.window = 'missing'
      },
      (fixture) => {
        fixture.window = { ...RouteData.window(), type: 'popup' }
      },
      (fixture) => {
        fixture.window = { ...RouteData.window(), incognito: true }
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
      ['no-receiver', SidePanelLoginFillKind.PageUnavailable],
      [
        { kind: SidePanelPageFillReplyKind.TabChanged },
        SidePanelLoginFillKind.TabChanged,
      ],
      [
        { kind: SidePanelPageFillReplyKind.NoLoginForm },
        SidePanelLoginFillKind.NoLoginForm,
      ],
      [
        { kind: SidePanelPageFillReplyKind.Locked },
        SidePanelLoginFillKind.Locked,
      ],
      [
        { kind: SidePanelPageFillReplyKind.FillFailed },
        SidePanelLoginFillKind.FillFailed,
      ],
      [
        { kind: 'filled', username: 'work@example.com' },
        SidePanelLoginFillKind.FillFailed,
      ],
      [{ ok: true }, SidePanelLoginFillKind.FillFailed],
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
              storage.has(key) ? { [key]: storage.get(key) } : {},
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
