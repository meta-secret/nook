import { expect, mock } from 'bun:test'
import { ok } from 'neverthrow'
import type {
  BrowserTabTarget,
  BrowserTabUrlObservation,
} from '../../nook-web-shared/src/extension/nook-companion-wasm/nook_companion_wasm.js'
import { DeviceProtectionStatus } from '../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import type { StoredExtensionPairingGrant } from '../src/background/pairing-grants'
import type { ExtensionSessionTransportResult } from '../src/background/service-worker/session-document'
import { SidePanelSender } from '../src/background/service-worker/side-panel-sender'
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
  type SidePanelTabClassifier,
} from '../src/background/service-worker/side-panel-tab-target'
import {
  BrowserRuntimeMessage,
  BrowserRuntimeMessageAdmissionKind,
  type BrowserRuntimeMessageValue,
} from '../src/lib/browser-runtime-message'
import { ExtensionSessionMessageType } from '../src/lib/extension-session-message-type'
import type { WebsiteLoginAccountOption } from '../src/lib/login-fill-messages'
import { SidePanelPageFillReplyKind } from '../src/lib/side-panel-page-fill'
import {
  SIDE_PANEL_PAGE_PATH,
  SidePanelSiteMessageType,
} from '../src/lib/side-panel-site'
import type { ExtensionSessionResponse } from '../src/offscreen/session'
import type { ExtensionSessionTransportRequest } from '../src/offscreen/session-request-adapter'

Object.assign(globalThis, {
  __NOOK_SIMPLE_VAULT_URL__: 'https://simple.example.test/',
})

/** Builders for the Chrome, grant and listing values the route scenarios use. */
export class RouteData {
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
    switch (url) {
      case false:
        return base
      default:
        return { ...base, url }
    }
  }

  static present(window: chrome.windows.Window): FixtureWindow {
    return { kind: FixtureWindowKind.Present, window }
  }

  static answered(reply: BrowserRuntimeMessageValue): PageReply {
    return { kind: PageReplyKind.Answered, reply }
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

/** A classifier whose Rust call fails, as a malformed observation would. */
export class ThrowingTabClassifier implements SidePanelTabClassifier {
  classify(): Promise<BrowserTabTarget> {
    return Promise.reject(new Error('Invalid browser tab observation.'))
  }
}

/** Classifies the first tab with Rust, then fails: the re-check before delivery cannot read the tab. */
export class ThrowingAfterFirstTabClassifier implements SidePanelTabClassifier {
  private readonly rust = new CompanionSidePanelTabClassifier()
  private calls = 0

  classify(observation: BrowserTabUrlObservation): Promise<BrowserTabTarget> {
    this.calls += 1
    switch (this.calls) {
      case 1:
        return this.rust.classify(observation)
      default:
        return Promise.reject(new Error('Invalid browser tab observation.'))
    }
  }
}

type SessionDelivery = ExtensionSessionTransportResult<ExtensionSessionResponse>
/** What the tab answers the Fill trigger with, or that no content script received it. */
export enum PageReplyKind {
  Answered = 'answered',
  NoReceiver = 'no-receiver',
}

export type PageReply =
  | {
      readonly kind: PageReplyKind.Answered
      readonly reply: BrowserRuntimeMessageValue
    }
  | { readonly kind: PageReplyKind.NoReceiver }

/** The window the panel names, or no window with that id. */
export enum FixtureWindowKind {
  Present = 'present',
  Missing = 'missing',
}

export type FixtureWindow =
  | {
      readonly kind: FixtureWindowKind.Present
      readonly window: chrome.windows.Window
    }
  | { readonly kind: FixtureWindowKind.Missing }

/**
 * Shared fixture of the side-panel route suite: a service-worker host with stubbed Chrome windows, tabs and storage, a
 * recording offscreen session, and the real sender predicate, tab resolver,
 * Rust classifier and fail-closed login listing.
 */
export class SidePanelRouteFixture {
  readonly sessionMessages: ExtensionSessionTransportRequest[] = []
  readonly pageDeliveries: SidePanelPageDelivery[] = []
  readonly tabsQuery = mock(() => this.queryTabs())
  tabQueryFails = false
  /** Active tabs the window shows after each query, as when the person switches tabs. */
  tabSwitches: chrome.tabs.Tab[][] = []
  classifier: SidePanelTabClassifier = new CompanionSidePanelTabClassifier()
  readonly launcher = mock(() => Promise.resolve())
  readonly storageWrite = mock(() => Promise.resolve())
  activeTabs: chrome.tabs.Tab[] = [
    RouteData.tab(
      41,
      'https://user:pass@www.example.com:8443/login?token=secret#f',
    ),
  ]
  window: FixtureWindow = RouteData.present(RouteData.window())
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
  pageReply: PageReply = RouteData.answered({
    kind: SidePanelPageFillReplyKind.Filled,
  })

  install(): void {
    Object.assign(globalThis, {
      chrome: {
        runtime: { id: RouteData.extensionId, getURL: RouteData.url },
        extension: { inIncognitoContext: false },
        windows: {
          get: () => this.getWindow(),
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
      classifier: this.classifier,
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
        return this.answer()
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
    return this.sessionMessages.flatMap((message) => {
      switch (true) {
        case message.type === ExtensionSessionMessageType.ListLogins:
          return [message.payload.origin]
        case true:
        default:
          return []
      }
    })
  }

  private queryTabs(): Promise<chrome.tabs.Tab[]> {
    switch (this.tabQueryFails) {
      case true:
        return Promise.reject(new Error('Tabs cannot be queried'))
      case false:
        break
    }
    const answered = this.activeTabs
    const next = this.tabSwitches.shift()
    switch (true) {
      case !!next:
        this.activeTabs = next
        break
      case true:
      default:
        break
    }
    return Promise.resolve(answered)
  }

  private getWindow(): Promise<chrome.windows.Window> {
    switch (this.window.kind) {
      case FixtureWindowKind.Missing:
        return Promise.reject(new Error('No window with id'))
      case FixtureWindowKind.Present:
        return Promise.resolve(this.window.window)
    }
  }

  /** Chrome rejects a tab message that no content script receives. */
  private answer(): Promise<BrowserRuntimeMessageValue> {
    switch (this.pageReply.kind) {
      case PageReplyKind.NoReceiver:
        return Promise.reject(new Error('Could not establish connection'))
      case PageReplyKind.Answered:
        return Promise.resolve(this.pageReply.reply)
    }
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
