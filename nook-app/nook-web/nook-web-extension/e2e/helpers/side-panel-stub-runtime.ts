import {
  VAULT_REVISION_CHANNEL,
  VaultRevisionAnnouncement,
} from '../../src/lib/vault-revision-signal'
import path from 'node:path'
import { expect, type Page, type Route } from '@playwright/test'
import { OpenCompanionLauncherMessageType } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import type { ExtensionConnectStep } from '../../../nook-web-shared/src/extension/extension-connect-progress'
import {
  BeginExtensionPairingMessageType,
  OpenSimpleVaultMessageType,
} from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { DeviceProtectionStatus } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionRuntimeRequestType } from '../../src/lib/extension-runtime-request-type'
import { ExtensionSessionMessageType } from '../../src/lib/extension-session-message-type'
import { PairedVaultsMessageType } from '../../src/lib/paired-vaults'
import { SIDE_PANEL_PAGE_PATH } from '../../src/lib/side-panel-page-path'
import {
  SidePanelCodeFillKind,
  SidePanelSiteMessageType,
  type SidePanelLoginFillKind,
  type SidePanelSiteListing,
} from '../../src/lib/side-panel-site'
import { extensionDir, simpleVaultBaseUrl } from './extension-smoke-runtime'

/**
 * Runs the built side panel page on a stubbed browser runtime, so its
 * behavior runs in the extension suite without a real
 * side panel target (Playwright cannot reach one). The stub answers the
 * panel's requests from a state object the test changes between steps, and
 * fires the tab and visibility changes the panel follows.
 */
export enum SidePanelStubVaults {
  Paired = 'paired',
  /** Paired, plus the vault the connect page just created. */
  PairedWithNew = 'paired-with-new',
  /** Paired, plus a second identity of this extension with its own key. */
  TwoIdentities = 'two-identities',
  None = 'none',
  Unavailable = 'unavailable',
}

export enum SidePanelStubAnswer {
  Accept = 'accept',
  Refuse = 'refuse',
}

/** Whether a Fill answer comes back at once or waits for release. */
export enum SidePanelStubFillDelivery {
  Immediate = 'immediate',
  Held = 'held',
}

type SidePanelStubFillAnswer = { readonly kind: SidePanelLoginFillKind }
type SidePanelStubCodeFillAnswer = { readonly kind: SidePanelCodeFillKind }

type SidePanelStubActivatedListener = Parameters<
  typeof chrome.tabs.onActivated.addListener
>[0]
type SidePanelStubUpdatedListener = Parameters<
  typeof chrome.tabs.onUpdated.addListener
>[0]

type SidePanelStubTabUpdate = {
  readonly tabId: number
  readonly change: chrome.tabs.OnUpdatedInfo
  readonly tab: chrome.tabs.Tab
}

/** Which key Rust picks to connect the next identity. */
export enum SidePanelStubConnectKey {
  Current = 'current-key',
  NewStaged = 'new-key-staged',
}

export type SidePanelStubState = {
  status: DeviceProtectionStatus
  connectKey: SidePanelStubConnectKey
  /** The window each pairing the panel asked to open named. */
  pairings: number[]
  /** The connect id each pairing the panel asked to open named. */
  connectIds: string[]
  /** Tabs the panel brought to the front. */
  focusedTabs: number[]
  connects: Array<(port: SidePanelStubPagePort) => void>
  removals: Array<(tabId: number) => void>
  /** Ports pages opened to the panel, newest last. */
  pagePorts: SidePanelStubPagePort[]
  /** The vault new logins are saved to. */
  defaultStore: string
  makeDefault: SidePanelStubAnswer
  /** The app keys the panel asked to switch to. */
  activatedIdentities: string[]
  vaults: SidePanelStubVaults
  listing: SidePanelSiteListing
  fill: SidePanelStubFillAnswer
  codeFill: SidePanelStubCodeFillAnswer
  fillDelivery: SidePanelStubFillDelivery
  heldFills: Array<() => void>
  openVault: SidePanelStubAnswer
  lock: SidePanelStubAnswer
  pinUnlock: SidePanelStubAnswer
  sent: string[]
  activated: SidePanelStubActivatedListener[]
  updated: SidePanelStubUpdatedListener[]
}

/** A connect page's port, as the panel receives it. */
export type SidePanelStubPagePort = {
  readonly name: string
  readonly sender: chrome.runtime.MessageSender
  disconnected: boolean
  readonly messages: Array<(message: unknown) => void>
  readonly disconnects: Array<() => void>
  readonly postMessage: () => void
  readonly disconnect: () => void
  readonly onMessage: {
    readonly addListener: (listener: (message: unknown) => void) => void
  }
  readonly onDisconnect: {
    readonly addListener: (listener: () => void) => void
  }
}

/** Which connect a stub page's port is named for. */
export enum SidePanelStubPortName {
  /** The connect the panel began last. */
  PanelConnect = 'panel-connect',
  /** A connect this panel did not begin. */
  OtherConnect = 'other-connect',
}

/** Where a stub connect page connects from. */
export type SidePanelStubPageOrigin = {
  readonly name: SidePanelStubPortName
  readonly url: string
  readonly windowId: number
  readonly tabId: number
}

export type SidePanelStubScenario = {
  readonly status: DeviceProtectionStatus
  readonly vaults: SidePanelStubVaults
  readonly listing: SidePanelSiteListing
  readonly fill: SidePanelStubFillAnswer
}

declare global {
  interface Window {
    __nookSidePanelStub: SidePanelStubState
  }
}

const sidePanelStubProtocol = {
  ensureRuntime: ExtensionRuntimeRequestType.EnsureRuntime,
  status: ExtensionSessionMessageType.Status,
  unlockPin: ExtensionSessionMessageType.UnlockPin,
  lock: ExtensionSessionMessageType.Lock,
  pairedVaults: PairedVaultsMessageType.Query,
  refreshIdentity: PairedVaultsMessageType.RefreshIdentity,
  openVault: OpenSimpleVaultMessageType.NookOpenSimpleVault,
  openLauncher: OpenCompanionLauncherMessageType.NookOpenCompanionLauncher,
  beginIdentityConnection: ExtensionSessionMessageType.BeginIdentityConnection,
  cancelIdentityConnection:
    ExtensionSessionMessageType.CancelIdentityConnection,
  beginPairing: BeginExtensionPairingMessageType.NookBeginExtensionPairing,
  currentKey: SidePanelStubConnectKey.Current,
  listLogins: SidePanelSiteMessageType.ListLogins,
  fillLogin: SidePanelSiteMessageType.FillLogin,
  fillCode: SidePanelSiteMessageType.FillCode,
  codeFilled: SidePanelCodeFillKind.Filled,
  unlocked: DeviceProtectionStatus.Unlocked,
  pinLocked: DeviceProtectionStatus.Pin,
  connectTab: 42,
  paired: SidePanelStubVaults.Paired,
  pairedWithNew: SidePanelStubVaults.PairedWithNew,
  twoIdentities: SidePanelStubVaults.TwoIdentities,
  selectDefault: PairedVaultsMessageType.SelectDefault,
  activateIdentity: ExtensionSessionMessageType.ActivateIdentity,
  none: SidePanelStubVaults.None,
  unavailable: SidePanelStubVaults.Unavailable,
  accept: SidePanelStubAnswer.Accept,
  refuse: SidePanelStubAnswer.Refuse,
  immediate: SidePanelStubFillDelivery.Immediate,
  held: SidePanelStubFillDelivery.Held,
} as const

type SidePanelStubInstall = {
  readonly scenario: SidePanelStubScenario
  readonly protocol: typeof sidePanelStubProtocol
}

/** Runs inside the page: module imports do not exist there. */
function installSidePanelStub(install: SidePanelStubInstall): void {
  const { scenario, protocol } = install
  const device = {
    deviceId: 'side-panel-stub-device',
    devicePublicKey: 'side-panel-stub-public-key',
    deviceSigningPublicKey: 'side-panel-stub-signing-key',
  }
  const pairedVaults = [
    {
      vaultStoreId: 'store-personal',
      vaultName: 'Personal',
      identityLabel: 'Alice Martin',
      deviceId: device.deviceId,
      isDefault: true,
      fillsPasswords: true,
      managesPasskeys: false,
    },
  ]
  const state: SidePanelStubState = {
    status: scenario.status,
    connectKey: protocol.currentKey,
    pairings: [],
    connectIds: [],
    focusedTabs: [],
    connects: [],
    removals: [],
    pagePorts: [],
    defaultStore: 'store-personal',
    makeDefault: protocol.accept,
    activatedIdentities: [],
    vaults: scenario.vaults,
    listing: scenario.listing,
    fill: scenario.fill,
    codeFill: { kind: protocol.codeFilled },
    fillDelivery: protocol.immediate,
    heldFills: [],
    openVault: protocol.accept,
    lock: protocol.accept,
    pinUnlock: protocol.accept,
    sent: [],
    activated: [],
    updated: [],
  }
  window.__nookSidePanelStub = state
  const acknowledged = (answer: SidePanelStubAnswer) => {
    switch (answer) {
      case protocol.accept:
        return { ok: true }
      case protocol.refuse:
        return { ok: false, reason: 'side-panel-stub-refused' }
    }
  }
  const otherIdentityVault = {
    vaultStoreId: 'store-office',
    vaultName: 'Office',
    identityLabel: 'Alice at Work',
    deviceId: 'side-panel-stub-other-device',
    isDefault: false,
    fillsPasswords: true,
    managesPasskeys: true,
  }
  const withDefault = <Vault extends { readonly vaultStoreId: string }>(
    vaults: Vault[],
  ) =>
    vaults.map((vault) => ({
      ...vault,
      isDefault: vault.vaultStoreId === state.defaultStore,
    }))
  const vaultList = () => {
    switch (state.vaults) {
      case protocol.paired:
        return { ok: true, vaults: withDefault(pairedVaults) }
      case protocol.twoIdentities:
        return {
          ok: true,
          vaults: withDefault([...pairedVaults, otherIdentityVault]),
        }
      case protocol.pairedWithNew:
        return {
          ok: true,
          vaults: [
            ...pairedVaults,
            {
              ...pairedVaults[0],
              vaultStoreId: 'store-work',
              vaultName: 'Work',
              isDefault: false,
            },
          ],
        }
      case protocol.none:
        return { ok: true, vaults: [] }
      case protocol.unavailable:
        return { ok: false, reason: 'paired-vaults-read-failed' }
    }
  }
  const unlockPin = () => {
    switch (state.pinUnlock) {
      case protocol.accept:
        state.status = protocol.unlocked
        return { ok: true, device }
      case protocol.refuse:
        return { ok: false, reason: 'pin-rejected' }
    }
  }
  const lock = () => {
    switch (state.lock) {
      case protocol.accept:
        state.status = protocol.pinLocked
        return { ok: true }
      case protocol.refuse:
        return { ok: false, reason: 'lock-failed' }
    }
  }
  const answer = (type: string): unknown => {
    switch (type) {
      case protocol.ensureRuntime:
        return { ok: true }
      case protocol.status:
        return { ok: true, status: state.status, device }
      case protocol.unlockPin:
        return unlockPin()
      case protocol.lock:
        return lock()
      case protocol.pairedVaults:
        return vaultList()
      case protocol.refreshIdentity:
        return { ok: true, paired: 0, awaitingGrant: 0 }
      case protocol.openVault:
        return acknowledged(state.openVault)
      case protocol.openLauncher:
        return { ok: true }
      case protocol.beginIdentityConnection:
        return { ok: true, start: state.connectKey }
      case protocol.cancelIdentityConnection:
        return { ok: true }
      case protocol.beginPairing:
        return { ok: true, tabId: protocol.connectTab }
      case protocol.selectDefault:
        return acknowledged(state.makeDefault)
      case protocol.listLogins:
        return state.listing
      default:
        return { ok: false, reason: 'side-panel-stub-unhandled' }
    }
  }
  const deliverFill = (
    callback: (reply: unknown) => void,
    reply: () => unknown,
  ) => {
    switch (state.fillDelivery) {
      case protocol.immediate:
        queueMicrotask(() => callback(reply()))
        return
      case protocol.held:
        state.heldFills.push(() => callback(reply()))
    }
  }
  const listeners = <Listener>(list: Listener[]) => ({
    addListener: (listener: Listener) => list.push(listener),
    // Chrome ignores removing a listener it never added.
    removeListener: (listener: Listener) => {
      const index = list.indexOf(listener)
      switch (index) {
        case -1:
          return
        default:
          list.splice(index, 1)
      }
    },
  })
  const chromeStub = {
    i18n: { getUILanguage: () => 'en' },
    runtime: {
      id: 'side-panel-stub',
      onConnectExternal: listeners(state.connects),
      getURL: (resource: string) =>
        `${globalThis.location.origin}/__side-panel-stub/${resource}`,
      sendMessage: (
        message: {
          readonly type: string
          readonly vaultStoreId?: string
          readonly payload?: {
            readonly windowId?: number
            readonly connectId?: string
            readonly appId?: string
          }
        },
        callback: (reply: unknown) => void,
      ) => {
        state.sent.push(message.type)
        switch (message.type) {
          case protocol.beginPairing: {
            const windowId = message.payload?.windowId
            if (typeof windowId === 'number') state.pairings.push(windowId)
            const connectId = message.payload?.connectId
            if (typeof connectId === 'string') state.connectIds.push(connectId)
            queueMicrotask(() => callback(answer(message.type)))
            return
          }
          case protocol.selectDefault: {
            const reply = answer(message.type)
            if (message.vaultStoreId && state.makeDefault === protocol.accept)
              state.defaultStore = message.vaultStoreId
            queueMicrotask(() => callback(reply))
            return
          }
          case protocol.activateIdentity: {
            // The other identity opens with its own PIN.
            if (message.payload?.appId)
              state.activatedIdentities.push(message.payload.appId)
            state.status = protocol.pinLocked
            queueMicrotask(() => callback({ ok: true }))
            return
          }
          case protocol.fillLogin:
            deliverFill(callback, () => state.fill)
            return
          case protocol.fillCode:
            deliverFill(callback, () => state.codeFill)
            return
          default:
            queueMicrotask(() => callback(answer(message.type)))
        }
      },
    },
    tabs: {
      onActivated: listeners(state.activated),
      onUpdated: listeners(state.updated),
      onRemoved: listeners(state.removals),
      update: (tabId: number) => {
        state.focusedTabs.push(tabId)
        return Promise.resolve({ id: tabId })
      },
    },
    windows: {
      getCurrent: () =>
        Promise.resolve({
          id: 1,
          focused: true,
          alwaysOnTop: false,
          incognito: false,
        }),
    },
    // Docked on the right edge, as Chrome docks it by default.
    sidePanel: {
      getLayout: () => Promise.resolve({ side: 'right' }),
    },
  }
  const descriptor: PropertyDescriptor = { value: chromeStub }
  Object.defineProperty(globalThis, 'chrome', descriptor)
}

export type SidePanelStubPageMessage = {
  readonly port: number
  readonly message: ExtensionConnectStep | { readonly kind: string }
}

/** The document visibility states the stub page can be put in. */
export enum SidePanelStubVisibility {
  Visible = 'visible',
  Hidden = 'hidden',
}

/** A side panel page on the stubbed runtime, and the changes it follows. */
export class SidePanelStubPage {
  private static readonly ROUTE_PREFIX = '/__side-panel-stub/'
  private static readonly ORIGIN = 'https://side-panel.stub'
  /** The stub's window is 1; the panel follows its active tab, 2. */
  private static readonly WINDOW_ID = 1
  private static readonly TAB_ID = 2
  /** The Nook tab the stub service worker opens or reuses. */
  static readonly CONNECT_TAB_ID = sidePanelStubProtocol.connectTab
  static readonly CONNECT_URL = new URL(
    'extension-connect?connect_id=stub',
    simpleVaultBaseUrl,
  ).toString()

  constructor(private readonly page: Page) {}

  async open(scenario: SidePanelStubScenario): Promise<void> {
    await this.page.route(
      `${SidePanelStubPage.ORIGIN}/**`,
      async (route: Route) => {
        const requestPath = new URL(route.request().url()).pathname
        const relative = requestPath.slice(
          SidePanelStubPage.ROUTE_PREFIX.length,
        )
        await route.fulfill({ path: path.join(extensionDir, relative) })
      },
    )
    const install: SidePanelStubInstall = {
      scenario,
      protocol: sidePanelStubProtocol,
    }
    await this.page.addInitScript(installSidePanelStub, install)
    // Chrome docks the side panel at the browser edge, 320-600px wide.
    await this.page.setViewportSize({ width: 360, height: 720 })
    await this.page.goto(
      `${SidePanelStubPage.ORIGIN}${SidePanelStubPage.ROUTE_PREFIX}${SIDE_PANEL_PAGE_PATH}`,
    )
    await expect(this.page.getByTestId('side-panel')).toBeVisible()
  }

  /** The service worker announces that the extension took a vault change. */
  async announceVaultChange(): Promise<void> {
    await this.page.evaluate(
      ({ channel, announcement }) => {
        const serviceWorker = new BroadcastChannel(channel)
        serviceWorker.postMessage(announcement)
        serviceWorker.close()
      },
      {
        channel: VAULT_REVISION_CHANNEL,
        announcement: VaultRevisionAnnouncement.Changed,
      },
    )
  }

  async update(change: Partial<SidePanelStubState>): Promise<void> {
    await this.page.evaluate((next) => {
      Object.assign(window.__nookSidePanelStub, next)
    }, change)
  }

  async releaseFills(): Promise<void> {
    await this.page.evaluate(() => {
      const held = window.__nookSidePanelStub.heldFills.splice(0)
      for (const release of held) release()
    })
  }

  async activatedIdentities(): Promise<string[]> {
    return this.page.evaluate(
      () => window.__nookSidePanelStub.activatedIdentities,
    )
  }

  /** The window each begin-pairing request named. */
  async pairings(): Promise<number[]> {
    return this.page.evaluate(() => window.__nookSidePanelStub.pairings)
  }

  async focusedTabs(): Promise<number[]> {
    return this.page.evaluate(() => window.__nookSidePanelStub.focusedTabs)
  }

  /** A page connects to the extension, by default the Nook connect tab of
   * the panel's window; answers the index of its port. */
  async connectPage(
    origin: Partial<SidePanelStubPageOrigin> = {},
  ): Promise<number> {
    const from: SidePanelStubPageOrigin = {
      name: SidePanelStubPortName.PanelConnect,
      url: SidePanelStubPage.CONNECT_URL,
      windowId: SidePanelStubPage.WINDOW_ID,
      tabId: SidePanelStubPage.CONNECT_TAB_ID,
      ...origin,
    }
    return this.page.evaluate((pageOrigin) => {
      const state = window.__nookSidePanelStub
      // The enum does not reach the page, so its value is compared.
      const latest = state.connectIds.at(-1)
      if (typeof latest !== 'string')
        throw new Error('the panel began no connect')
      const port: SidePanelStubPagePort = {
        name:
          pageOrigin.name === 'panel-connect' ? latest : 'another-connect-id',
        sender: {
          url: pageOrigin.url,
          origin: new URL(pageOrigin.url).origin,
          frameId: 0,
          tab: {
            id: pageOrigin.tabId,
            windowId: pageOrigin.windowId,
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
          },
        },
        disconnected: false,
        messages: [],
        disconnects: [],
        postMessage: () => {},
        disconnect: () => {
          port.disconnected = true
        },
        onMessage: { addListener: (listener) => port.messages.push(listener) },
        onDisconnect: {
          addListener: (listener) => port.disconnects.push(listener),
        },
      }
      state.pagePorts.push(port)
      for (const listener of [...state.connects]) listener(port)
      return state.pagePorts.length - 1
    }, from)
  }

  /** The connect page at that port reports a step, or any message. */
  async pageSends(request: SidePanelStubPageMessage): Promise<void> {
    await this.page.evaluate((next) => {
      const ports = window.__nookSidePanelStub.pagePorts.slice(
        next.port,
        next.port + 1,
      )
      for (const port of ports)
        for (const listener of port.messages) listener(next.message)
    }, request)
  }

  /** The connect page at that port closed, reloaded or navigated away. */
  async pageCloses(port: number): Promise<void> {
    await this.page.evaluate((index) => {
      const ports = window.__nookSidePanelStub.pagePorts.slice(index, index + 1)
      for (const closing of ports)
        for (const listener of closing.disconnects) listener()
    }, port)
  }

  async pageDisconnected(port: number): Promise<boolean> {
    return this.page.evaluate(
      (index) =>
        window.__nookSidePanelStub.pagePorts[index]?.disconnected === true,
      port,
    )
  }

  async sent(type: string): Promise<number> {
    return this.page.evaluate(
      (wanted) =>
        window.__nookSidePanelStub.sent.filter((sent) => sent === wanted)
          .length,
      type,
    )
  }

  /** A tab of the panel's window became active, by default the page tab. */
  async activateTab(tabId: number = SidePanelStubPage.TAB_ID): Promise<void> {
    const info: chrome.tabs.OnActivatedInfo = {
      tabId,
      windowId: SidePanelStubPage.WINDOW_ID,
    }
    await this.page.evaluate((activated) => {
      for (const listener of window.__nookSidePanelStub.activated)
        listener(activated)
    }, info)
  }

  /** The active tab of the panel's window went to another address. */
  async navigateTab(): Promise<void> {
    const url = 'https://accounts.example.test/next'
    const tab: chrome.tabs.Tab = {
      id: SidePanelStubPage.TAB_ID,
      url,
      index: 0,
      pinned: false,
      highlighted: false,
      windowId: SidePanelStubPage.WINDOW_ID,
      active: true,
      incognito: false,
      selected: true,
      discarded: false,
      autoDiscardable: true,
      frozen: false,
      lastAccessed: 0,
      groupId: -1,
    }
    const update: SidePanelStubTabUpdate = {
      tabId: SidePanelStubPage.TAB_ID,
      change: { url },
      tab,
    }
    await this.page.evaluate((next) => {
      for (const listener of window.__nookSidePanelStub.updated)
        listener(next.tabId, next.change, next.tab)
    }, update)
  }

  async setVisibility(visibility: SidePanelStubVisibility): Promise<void> {
    await this.page.evaluate((state) => {
      const descriptor: PropertyDescriptor = {
        configurable: true,
        get: () => state,
      }
      Object.defineProperty(document, 'visibilityState', descriptor)
      document.dispatchEvent(new Event('visibilitychange'))
    }, visibility)
  }

  /** A click into the panel from the page focuses its window. */
  async focus(): Promise<void> {
    await this.page.evaluate(() => window.dispatchEvent(new Event('focus')))
  }
}
