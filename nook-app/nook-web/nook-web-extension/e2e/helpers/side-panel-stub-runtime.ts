import path from 'node:path'
import { expect, type Page, type Route } from '@playwright/test'
import { OpenCompanionLauncherMessageType } from '../../../nook-web-shared/src/extension/companion-launcher-message'
import { OpenSimpleVaultMessageType } from '../../../nook-web-shared/src/extension/lifecycle-runtime-messages'
import { DeviceProtectionStatus } from '../../../nook-web-shared/src/vault-app/lib/nook-wasm/nook_wasm'
import { ExtensionRuntimeRequestType } from '../../src/lib/extension-runtime-request-type'
import { ExtensionSessionMessageType } from '../../src/lib/extension-session-message-type'
import { PairedVaultsMessageType } from '../../src/lib/paired-vaults'
import {
  SIDE_PANEL_PAGE_PATH,
  SidePanelSiteMessageType,
  type SidePanelLoginFillKind,
  type SidePanelSiteListing,
} from '../../src/lib/side-panel-site'
import { extensionDir } from './extension-smoke-runtime'

/**
 * Runs the built side panel page on a stubbed browser runtime, the way the
 * UI demo does, so its behavior runs in the extension suite without a real
 * side panel target (Playwright cannot reach one). The stub answers the
 * panel's requests from a state object the test changes between steps, and
 * fires the tab and visibility changes the panel follows.
 */
export enum SidePanelStubVaults {
  Paired = 'paired',
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

type SidePanelStubListener = (...change: never[]) => void

export type SidePanelStubState = {
  status: DeviceProtectionStatus
  vaults: SidePanelStubVaults
  listing: SidePanelSiteListing
  fill: SidePanelStubFillAnswer
  fillDelivery: SidePanelStubFillDelivery
  heldFills: Array<() => void>
  openVault: SidePanelStubAnswer
  lock: SidePanelStubAnswer
  pinUnlock: SidePanelStubAnswer
  sent: string[]
  activated: SidePanelStubListener[]
  updated: SidePanelStubListener[]
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
  listLogins: SidePanelSiteMessageType.ListLogins,
  fillLogin: SidePanelSiteMessageType.FillLogin,
  unlocked: DeviceProtectionStatus.Unlocked,
  pinLocked: DeviceProtectionStatus.Pin,
  paired: SidePanelStubVaults.Paired,
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
    vaults: scenario.vaults,
    listing: scenario.listing,
    fill: scenario.fill,
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
  const vaultList = () => {
    switch (state.vaults) {
      case protocol.paired:
        return { ok: true, vaults: pairedVaults }
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
      case protocol.listLogins:
        return state.listing
      default:
        return { ok: false, reason: 'side-panel-stub-unhandled' }
    }
  }
  const deliverFill = (callback: (reply: unknown) => void) => {
    switch (state.fillDelivery) {
      case protocol.immediate:
        queueMicrotask(() => callback(state.fill))
        return
      case protocol.held:
        state.heldFills.push(() => callback(state.fill))
    }
  }
  const listeners = (list: SidePanelStubListener[]) => ({
    addListener: (listener: SidePanelStubListener) => list.push(listener),
    // Chrome ignores removing a listener it never added.
    removeListener: (listener: SidePanelStubListener) => {
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
      getURL: (resource: string) =>
        `${globalThis.location.origin}/__side-panel-stub/${resource}`,
      sendMessage: (
        message: { readonly type: string },
        callback: (reply: unknown) => void,
      ) => {
        state.sent.push(message.type)
        switch (message.type) {
          case protocol.fillLogin:
            deliverFill(callback)
            return
          default:
            queueMicrotask(() => callback(answer(message.type)))
        }
      },
    },
    tabs: {
      onActivated: listeners(state.activated),
      onUpdated: listeners(state.updated),
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
  }
  const descriptor: PropertyDescriptor = { value: chromeStub }
  Object.defineProperty(globalThis, 'chrome', descriptor)
}

type SidePanelStubVisibility = 'visible' | 'hidden'

/** A side panel page on the stubbed runtime, and the changes it follows. */
export class SidePanelStubPage {
  private static readonly ROUTE_PREFIX = '/__side-panel-stub/'
  private static readonly ORIGIN = 'https://side-panel.stub'

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

  async sent(type: string): Promise<number> {
    return this.page.evaluate(
      (wanted) =>
        window.__nookSidePanelStub.sent.filter((sent) => sent === wanted)
          .length,
      type,
    )
  }

  /** Another tab of the panel's window became active. */
  async activateTab(): Promise<void> {
    await this.page.evaluate(() => {
      const info = { tabId: 2, windowId: 1 }
      for (const listener of window.__nookSidePanelStub.activated)
        Reflect.apply(listener, undefined, [info])
    })
  }

  /** The active tab of the panel's window went to another address. */
  async navigateTab(): Promise<void> {
    await this.page.evaluate(() => {
      const change = { url: 'https://accounts.example.test/next' }
      const tab = { id: 2, windowId: 1, active: true }
      for (const listener of window.__nookSidePanelStub.updated)
        Reflect.apply(listener, undefined, [2, change, tab])
    })
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
